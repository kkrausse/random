import CryptoKit
import Foundation
import SQLite3

private let sqliteTransient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

@MainActor
final class RecordingService: ObservableObject {
    private let builds: BuildManager
    private let log: DiagnosticLog
    private var database: OpaquePointer?
    private var subscription: (id: String, sessionId: String, after: Int, limit: Int)?
    private(set) var engineFailure: String?
    private(set) var storageFailure: String?
    private(set) var storageFailureDetails: [String: Any]?
    private var lastJournalSequence = 0
    private var lastJournalWriteAt: String?
    private var journalQueuedCount = 0
    private var rawLocationReceivedCount = 0
    private var rawHeartRateReceivedCount = 0
    private var lastHealthEmissionUptime = -Double.infinity
    var emitEvent: ((String, [String: Any]) -> Void)?
    var presentShare: ((URL) -> Bool)?

    init(builds: BuildManager, log: DiagnosticLog, databaseURL: URL? = nil) {
        self.builds = builds
        self.log = log
        do {
            let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            try? FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: support.path)
            let url = databaseURL ?? support.appendingPathComponent("recording-v1.sqlite")
            let openResult = sqlite3_open_v2(url.path, &database, SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX, nil)
            guard openResult == SQLITE_OK else {
                throw sqliteFailure(operation: "database.open", resultCode: openResult)
            }
            try execute("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;")
            try? FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: url.path)
            try migrate()
            try recoverInterruptedSession()
        } catch {
            recordStorageFailure(error, operation: "database.initialize", sessionId: nil, durableSequence: 0)
        }
    }

    var available: Bool {
        guard storageFailure == nil,
              let description = try? RecordingEngineHost.describe(scriptURL: builds.recordingEngineURL()) else { return false }
        return description.apiVersion == 1 && description.checkpointSchemaVersion == 1
            && description.engineBuildId == "recording-engine-v1" && description.algorithmId == "ride-metrics-v1"
    }

    func shutdownForTesting() {
        if let database { sqlite3_close(database); self.database = nil }
    }

    func setQueryOnlyForTesting(_ enabled: Bool) throws {
        try execute("PRAGMA query_only=\(enabled ? "ON" : "OFF")")
    }

    func sessionSnapshot() -> [String: Any] {
        guard let row = try? currentSessionRow() else { return idleSnapshot() }
        return snapshot(row)
    }

    func handleMutation(requestId: String, method: String, params: [String: Any]) -> [String: Any] {
        let canonical = canonicalJSON(params)
        do {
            if let stored = try storedOutcome(requestId: requestId) {
                guard stored.method == method, stored.params == canonical else {
                    return errorReply(requestId: requestId, code: "invalidRequest", message: "Request ID was already used with different method or parameters")
                }
                return stored.reply
            }
            try execute("BEGIN IMMEDIATE")
            let result: [String: Any]
            do {
                result = try mutate(method: method, params: params)
                let reply: [String: Any] = ["protocolVersion": 1, "requestId": requestId, "ok": true, "result": result]
                try storeOutcome(requestId: requestId, method: method, params: canonical, reply: reply)
                try execute("COMMIT")
                logLifecycleCommit(method: method, result: result)
                processEngineBacklog()
                emitEvent?("session.updated", sessionSnapshot())
                return reply
            } catch let failure as RecorderFailure {
                let reply = errorReply(requestId: requestId, code: failure.code, message: failure.message, details: failure.details)
                try storeOutcome(requestId: requestId, method: method, params: canonical, reply: reply)
                try execute("COMMIT")
                logLifecycleFailure(method: method, sessionId: params["sessionId"] as? String, error: failure)
                return reply
            } catch {
                try? execute("ROLLBACK")
                throw error
            }
        } catch {
            let session = ((try? currentOrLatestSessionRow()) ?? nil)?["id"] as? String
            let details = recordStorageFailure(error, operation: "mutation.\(method)", sessionId: session, durableSequence: session.flatMap { try? observationSequence($0) } ?? 0)
            logLifecycleFailure(method: method, sessionId: session, error: error)
            return errorReply(requestId: requestId, code: "storageFailure", message: error.localizedDescription, retryable: true, details: details)
        }
    }

    func subscribe(sessionId: String, after: Int?, limit: Int) throws -> [String: Any] {
        guard try sessionExists(sessionId) else { throw ShellError.invalidState("Unknown workout session") }
        let latest = try observationSequence(sessionId)
        let id = "sub-\(UUID().uuidString)"
        subscription = (id, sessionId, after ?? 0, limit)
        return ["subscriptionId": id, "afterSequence": after ?? 0, "latestDurableSequence": latest]
    }

    func unsubscribe(_ id: String) throws -> [String: Any] {
        guard subscription?.id == id else { throw ShellError.invalidState("Unknown observation subscription") }
        subscription = nil
        return ["removed": true]
    }

    func readObservations(sessionId: String, after: Int?, limit: Int) throws -> [String: Any] {
        guard try sessionExists(sessionId) else { throw ShellError.invalidState("Unknown workout session") }
        let requested = after ?? 0
        let rows = try query("SELECT sequence,json FROM observations WHERE session_id=? AND sequence>? ORDER BY sequence LIMIT ?", [.text(sessionId), .int(requested), .int(limit + 1)])
        let selected = Array(rows.prefix(limit))
        let items = selected.compactMap { decodeObject($0["json"] as? String) }
        let oldest = try scalarInt("SELECT MIN(sequence) FROM observations WHERE session_id=?", [.text(sessionId)])
        let latest = try observationSequence(sessionId)
        return [
            "items": items, "nextSequence": (selected.last?["sequence"] as? Int) ?? NSNull(),
            "oldestAvailableSequence": oldest == 0 ? NSNull() : oldest, "latestDurableSequence": latest,
            "hasMore": rows.count > limit, "droppedBeforeSequence": oldest > 0 && oldest > requested + 1
        ]
    }

    func readJournal(sessionId: String, after: Int?, limit: Int) throws -> [String: Any] {
        guard try sessionExists(sessionId) else { throw ShellError.invalidState("Unknown workout session") }
        let requested = after ?? 0
        let rows = try query("SELECT * FROM journal_events WHERE session_id=? AND journal_sequence>? ORDER BY journal_sequence LIMIT ?", [.text(sessionId), .int(requested), .int(limit + 1)])
        let selected = Array(rows.prefix(limit))
        let latest = try scalarInt("SELECT COALESCE(MAX(journal_sequence),0) FROM journal_events WHERE session_id=?", [.text(sessionId)])
        return [
            "afterJournalSequence": after ?? NSNull(), "items": selected.map { journalObject($0, sessionId: sessionId) },
            "nextJournalSequence": selected.last?["journal_sequence"] ?? NSNull(),
            "oldestAvailableJournalSequence": latest == 0 ? NSNull() : 1, "latestJournalSequence": latest,
            "hasMore": rows.count > limit, "droppedBeforeJournalSequence": false
        ]
    }

    func listArchive(after: String?, limit: Int) throws -> [String: Any] {
        let cursor = try after.map(decodeArchiveCursor)
        let snapshotAt = cursor?.snapshotAt ?? ISOTime.now()
        var sql = "SELECT * FROM sessions WHERE state='finished' AND finished_at<=?"
        var binds: [Bind] = [.text(snapshotAt)]
        if let cursor {
            sql += " AND (finished_at<? OR (finished_at=? AND id<?))"
            binds += [.text(cursor.finishedAt), .text(cursor.finishedAt), .text(cursor.id)]
        }
        sql += " ORDER BY finished_at DESC,id DESC LIMIT ?"; binds.append(.int(limit + 1))
        let rows = try query(sql, binds); let selected = Array(rows.prefix(limit))
        let next = rows.count > limit ? selected.last.map { encodeArchiveCursor(snapshotAt: snapshotAt, row: $0) } : nil
        return ["afterCursor": after ?? NSNull(), "items": try selected.map(savedSummary), "nextCursor": next ?? NSNull(), "hasMore": next != nil, "snapshotAt": snapshotAt]
    }

    func archiveDetail(savedWorkoutId: String, after: Int?, limit: Int) throws -> [String: Any] {
        guard let row = try sessionRow(id: savedWorkoutId), row["state"] as? String == "finished" else { throw ShellError.invalidState("Unknown saved workout") }
        var observations = try readObservations(sessionId: savedWorkoutId, after: after, limit: limit)
        observations["afterSequence"] = after ?? NSNull()
        let latest = row["observation_sequence"] as! Int
        return [
            "summary": try savedSummary(row),
            "pinnedEngine": ["buildId": row["engine_build_id"]!, "apiVersion": row["engine_api"]!, "checkpointSchemaVersion": row["checkpoint_schema"]!],
            "recordingFormatVersion": 1, "units": "SI",
            "derivation": ["algorithmId": row["algorithm_id"]!, "engineBuildId": row["engine_build_id"]!, "configId": "default-v1", "firstInputSequence": latest == 0 ? NSNull() : 1, "lastInputSequence": row["checkpoint_sequence"]!],
            "observations": observations
        ]
    }

    func ingestLocation(_ source: [String: Any]) {
        guard let session = try? currentSessionRow(), let state = session["state"] as? String,
              ["recording", "paused"].contains(state), let sessionId = session["id"] as? String else { return }
        var observation = source
        let rawEventId = observation.removeValue(forKey: "_rawEventId") as? String
        observation.removeValue(forKey: "cursor")
        observation["kind"] = "location"; observation["sessionId"] = sessionId
        observation["monotonicTimestampMs"] = monotonicMilliseconds()
        let key = "location:\(source["sourceTimestamp"] ?? ""):\(source["latitudeDegrees"] ?? ""):\(source["longitudeDegrees"] ?? "")"
        ingest(observation, sessionId: sessionId, dedupeKey: key, rawEventId: rawEventId)
    }

    @discardableResult
    func appendJournalEvent(kind: String, provenance: String, payload: [String: Any]) -> String? {
        guard let session = try? currentSessionRow(), let id = session["id"] as? String,
              let state = session["state"] as? String, ["recording", "paused"].contains(state) else { return nil }
        do {
            if kind == "locationDelivery" { rawLocationReceivedCount += 1 }
            if kind == "heartRateCharacteristicDelivery" { rawHeartRateReceivedCount += 1 }
            journalQueuedCount += 1
            defer { journalQueuedCount = max(0, journalQueuedCount - 1) }
            let eventId = "event-\(UUID().uuidString)"
            let receivedAt = payload["receivedAt"] as? String ?? ISOTime.now()
            let sourceTimestamp = payload["sourceTimestamp"] as? String
            let monotonic = monotonicMilliseconds()
            try execute("BEGIN IMMEDIATE")
            try insertJournalEvent(eventId: eventId, sessionId: id, kind: kind, sourceTimestamp: sourceTimestamp, receivedAt: receivedAt, monotonic: monotonic, provenance: provenance, payload: payload)
            try execute("COMMIT")
            return eventId
        } catch {
            try? execute("ROLLBACK")
            _ = recordStorageFailure(error, operation: "journal.append.\(kind)", sessionId: id, durableSequence: (try? observationSequence(id)) ?? 0)
            emitIssue(code: "storageFailure", severity: "fatal", message: error.localizedDescription, sequence: (try? observationSequence(id)) ?? 0)
            return nil
        }
    }

    func ingestHostEvent(type: String, payload: [String: Any]) {
        guard let session = try? currentSessionRow(), let id = session["id"] as? String else { return }
        do {
            _ = appendJournalEvent(kind: "host.\(type)", provenance: "WorkoutAnalyze.native", payload: payload)
            try run("INSERT INTO host_events(session_id,type,source_timestamp,json) VALUES(?,?,?,?)", [.text(id), .text(type), .text(payload["sourceTimestamp"] as? String ?? ISOTime.now()), .text(canonicalJSON(payload))])
        } catch {
            _ = recordStorageFailure(error, operation: "hostEvent.append.\(type)", sessionId: id, durableSequence: (try? observationSequence(id)) ?? 0)
        }
    }

    func ingestHeartRate(_ source: [String: Any]) {
        guard let session = try? currentSessionRow(), let state = session["state"] as? String,
              ["recording", "paused"].contains(state), let sessionId = session["id"] as? String else { return }
        var observation = source
        let rawEventId = observation.removeValue(forKey: "_rawEventId") as? String
        observation.removeValue(forKey: "cursor")
        observation["kind"] = "heartRate"; observation["sessionId"] = sessionId
        observation["sourceTimestamp"] = source["receivedAt"]
        observation["monotonicTimestampMs"] = monotonicMilliseconds()
        let key = "heartRate:\(source["connectionId"] ?? ""):\(source["receivedAt"] ?? ""):\(source["rawFlags"] ?? "")"
        ingest(observation, sessionId: sessionId, dedupeKey: key, rawEventId: rawEventId)
    }

    func export(sessionId: String, format: String) throws -> (id: String, url: URL) {
        guard let session = try sessionRow(id: sessionId), session["state"] as? String == "finished" else { throw ShellError.invalidState("Only a finished workout can be exported") }
        let id = UUID().uuidString
        let observations = try allObservationObjects(sessionId)
        let url: URL
        if format == "gpx" {
            url = FileManager.default.temporaryDirectory.appendingPathComponent("workout-\(sessionId).gpx")
            try gpx(session: session, observations: observations).data(using: .utf8)!.write(to: url, options: .atomic)
        } else {
            url = FileManager.default.temporaryDirectory.appendingPathComponent("workout-\(sessionId).workoutBundleV1.zip")
            let files = try bundleFiles(session: session, observations: observations)
            try StoredZip.write(files: files, to: url)
        }
        return (id, url)
    }

    func diagnostics() -> [String: Any] {
        let snapshot = sessionSnapshot()
        let backlog: Int
        if let id = snapshot["sessionId"] as? String {
            let latest = (snapshot["observationSequence"] as? Int) ?? 0
            let checkpoint = (try? scalarInt("SELECT checkpoint_sequence FROM sessions WHERE id=?", [.text(id)])) ?? 0
            backlog = max(0, latest - checkpoint)
        } else { backlog = 0 }
        let sessionId = snapshot["sessionId"] as? String
        let journalSequence = sessionId.flatMap { try? scalarInt("SELECT COALESCE(MAX(journal_sequence),0) FROM journal_events WHERE session_id=?", [.text($0)]) } ?? lastJournalSequence
        let checkpoint = sessionId.flatMap { try? scalarInt("SELECT checkpoint_sequence FROM sessions WHERE id=?", [.text($0)]) } ?? 0
        return ["available": available, "database": storageFailure == nil ? "ready" : "failed", "engineBacklog": backlog,
                "engineFailure": engineFailure ?? NSNull(), "storageFailure": storageFailure ?? NSNull(),
                "storageFailureDetails": storageFailureDetails ?? NSNull(), "session": snapshot,
                "journal": ["latestDurableSequence": journalSequence, "lastSuccessfulWriteAt": (lastJournalWriteAt as Any?) ?? NSNull(), "queuedCount": journalQueuedCount,
                            "rawLocationReceivedCount": rawLocationReceivedCount, "rawHeartRateReceivedCount": rawHeartRateReceivedCount],
                "normalization": ["durableSequence": snapshot["durableSequence"] ?? 0, "engineCheckpointSequence": checkpoint, "backlogCount": backlog]]
    }

    func recordHealth(sensor: [String: Any], force: Bool = false) {
        let uptime = ProcessInfo.processInfo.systemUptime
        guard force || uptime - lastHealthEmissionUptime >= 12 else { return }
        let session = sessionSnapshot()
        guard let sessionId = session["sessionId"] as? String, ["recording", "paused"].contains(session["state"] as? String ?? "") else { return }
        lastHealthEmissionUptime = uptime
        let details = diagnostics()
        let journal = details["journal"] as? [String: Any] ?? [:]
        let normalization = details["normalization"] as? [String: Any] ?? [:]
        var metadata = stringMetadata(sensor)
        for (key, value) in stringMetadata(journal) { metadata["journal.\(key)"] = value }
        for (key, value) in stringMetadata(normalization) { metadata["normalization.\(key)"] = value }
        metadata["event"] = "recording.health"
        metadata["sessionId"] = sessionId
        metadata["state"] = session["state"] as? String ?? "unknown"
        metadata["storageFailure"] = storageFailure ?? ""
        metadata["engineFailure"] = engineFailure ?? ""
        log.append(subsystem: "recording.telemetry", message: "Recording health", sessionId: sessionId, sequence: session["durableSequence"] as? Int, metadata: metadata)
    }

    private func mutate(method: String, params: [String: Any]) throws -> [String: Any] {
        switch method {
        case "workout.start": return try start(params)
        case "workout.pause": return try transition(params, expectedState: "recording", target: "paused", cause: "user")
        case "workout.resume": return try transition(params, expectedState: "paused", target: "recording", cause: "user")
        case "workout.finish":
            let session = try transition(params, expectedState: nil, target: "finished", cause: "user")
            return ["session": session, "savedWorkoutId": params["sessionId"]!]
        case "workout.recover":
            let action = params["action"] as! String
            let session = try transition(params, expectedState: "interrupted", target: action == "resume" ? "recording" : "finished", cause: "recovery")
            return action == "finish" ? ["session": session, "savedWorkoutId": params["sessionId"]!] : session
        default: throw RecorderFailure(code: "unsupportedMethod", message: "Unsupported recording mutation")
        }
    }

    private func start(_ params: [String: Any]) throws -> [String: Any] {
        guard available else { throw RecorderFailure(code: "incompatibleBuild", message: "Pinned recording engine is unavailable or incompatible") }
        guard (params["expectedRevision"] as! NSNumber).intValue == 0 else { throw revisionConflict() }
        if let existing = try currentSessionRow() { throw RecorderFailure(code: "invalidState", message: "Finish or recover workout \(existing["id"]!) before starting another") }
        let description = try RecordingEngineHost.describe(scriptURL: builds.recordingEngineURL())
        let pinnedArtifact = try pinEngineArtifact(builds.recordingEngineURL())
        let id = "ride-\(UUID().uuidString)"; let now = ISOTime.now(); let sequence = 1
        let metrics = defaultMetrics()
        try run("INSERT INTO sessions(id,state,revision,sport,start_policy,started_at,finished_at,last_transition_at,observation_sequence,engine_build_id,engine_api,checkpoint_schema,algorithm_id,checkpoint_sequence,metrics_json,engine_artifact_path,engine_artifact_sha256,recovery_required,interruption_started_at,recovery_reason) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [
            .text(id), .text("recording"), .int(1), .text("cycling"), .text(params["startPolicy"] as! String), .text(now), .null, .text(now), .int(sequence),
            .text(description.engineBuildId), .int(description.apiVersion), .int(description.checkpointSchemaVersion), .text(description.algorithmId), .int(0), .text(canonicalJSON(metrics)), .text(pinnedArtifact.url.path), .text(pinnedArtifact.sha256), .int(0), .null, .null
        ])
        let transition = transitionObservation(sessionId: id, sequence: sequence, from: "idle", to: "recording", at: now, cause: "user", monotonic: monotonicMilliseconds())
        try insertJournalEvent(eventId: "event-\(UUID().uuidString)", sessionId: id, kind: "lifecycle.start", sourceTimestamp: now, receivedAt: now, monotonic: monotonicMilliseconds(), provenance: "bridge.workout.start", payload: ["expectedRevision": params["expectedRevision"]!, "sport": "cycling", "startPolicy": params["startPolicy"]!])
        try insertObservation(sessionId: id, sequence: sequence, kind: "transition", timestamp: now, dedupeKey: "transition:start", object: transition)
        try run("INSERT INTO host_events(session_id,type,source_timestamp,json) VALUES(?,?,?,?)", [.text(id), .text("recordingStarted"), .text(now), .text(canonicalJSON([
            "sourceTimestamp": now, "shellVersion": "0.1.0", "selectedUiSource": builds.sourceDescription,
            "packageBuildId": builds.active.buildId, "packageEngineBuildId": builds.active.engineBuildId,
            "recordingEngineBuildId": description.engineBuildId, "algorithmId": description.algorithmId,
            "startPolicy": params["startPolicy"]!
        ]))])
        return snapshot(try sessionRow(id: id)!)
    }

    private func transition(_ params: [String: Any], expectedState: String?, target: String, cause: String) throws -> [String: Any] {
        let id = params["sessionId"] as! String
        guard let row = try sessionRow(id: id) else { throw RecorderFailure(code: "invalidState", message: "Unknown workout session") }
        let state = row["state"] as! String; let revision = row["revision"] as! Int
        guard revision == (params["expectedRevision"] as! NSNumber).intValue else { throw revisionConflict(row) }
        if state == "interrupted" && cause != "recovery" { throw RecorderFailure(code: "invalidState", message: "Interrupted workout requires workout.recover") }
        if let expectedState { guard state == expectedState else { throw RecorderFailure(code: "invalidState", message: "Cannot transition workout from \(state) to \(target)") } }
        else { guard ["recording", "paused"].contains(state) else { throw RecorderFailure(code: "invalidState", message: "Cannot finish workout from \(state)") } }
        let now = ISOTime.now(); let sequence = (row["observation_sequence"] as! Int) + 1
        let observation = transitionObservation(sessionId: id, sequence: sequence, from: state, to: target, at: now, cause: cause, monotonic: monotonicMilliseconds())
        try insertJournalEvent(eventId: "event-\(UUID().uuidString)", sessionId: id, kind: "lifecycle.\(target)", sourceTimestamp: now, receivedAt: now, monotonic: monotonicMilliseconds(), provenance: "bridge.workout.\(cause == "recovery" ? "recover" : target)", payload: ["from": state, "to": target, "revision": revision + 1, "cause": cause])
        try insertObservation(sessionId: id, sequence: sequence, kind: "transition", timestamp: now, dedupeKey: "transition:\(revision + 1)", object: observation)
        try run("UPDATE sessions SET state=?,revision=?,last_transition_at=?,observation_sequence=?,finished_at=?,recovery_required=0,recovery_reason=NULL WHERE id=?", [
            .text(target), .int(revision + 1), .text(now), .int(sequence), target == "finished" ? .text(now) : .null, .text(id)
        ])
        return snapshot(try sessionRow(id: id)!)
    }

    private func ingest(_ object: [String: Any], sessionId: String, dedupeKey: String, rawEventId: String?) {
        do {
            try execute("BEGIN IMMEDIATE")
            if try scalarInt("SELECT COUNT(*) FROM observations WHERE session_id=? AND dedupe_key=?", [.text(sessionId), .text(dedupeKey)]) > 0 { try execute("COMMIT"); return }
            let sequence = try observationSequence(sessionId) + 1
            var value = object; value["sequence"] = sequence
            try insertObservation(sessionId: sessionId, sequence: sequence, kind: value["kind"] as! String, timestamp: value["sourceTimestamp"] as! String, dedupeKey: dedupeKey, rawEventId: rawEventId, object: value)
            try run("UPDATE sessions SET observation_sequence=? WHERE id=?", [.int(sequence), .text(sessionId)])
            try execute("COMMIT")
            processEngineBacklog()
            notifyObservation(sessionId: sessionId, sequence: sequence)
        } catch {
            try? execute("ROLLBACK")
            _ = recordStorageFailure(error, operation: "observation.append.\(object["kind"] as? String ?? "unknown")", sessionId: sessionId, durableSequence: (try? observationSequence(sessionId)) ?? 0)
            emitIssue(code: "storageFailure", severity: "fatal", message: error.localizedDescription, sequence: (try? observationSequence(sessionId)) ?? 0)
        }
    }

    private func processEngineBacklog() {
        guard let row = try? currentOrLatestSessionRow(), let id = row["id"] as? String else { return }
        do {
            let checkpointSequence = row["checkpoint_sequence"] as! Int
            let rows = try query("SELECT json FROM observations WHERE session_id=? AND sequence>? ORDER BY sequence LIMIT 1000", [.text(id), .int(checkpointSequence)])
            guard !rows.isEmpty else { return }
            let observations = rows.compactMap { decodeObject($0["json"] as? String) }
            let checkpoint = decodeObject(row["checkpoint_json"] as? String)
            guard let enginePath = row["engine_artifact_path"] as? String else { throw ShellError.incompatibleBuild("Pinned recording engine path is missing") }
            let result = try RecordingEngineHost.process(scriptURL: URL(fileURLWithPath: enginePath), checkpoint: checkpoint, observations: observations, wallTimestamp: ISOTime.now(), monotonicTimestampMs: monotonicMilliseconds())
            guard let last = result["lastSequence"] as? Int, let metrics = result["metrics"] as? [String: Any], let nextCheckpoint = result["checkpoint"] as? [String: Any] else { throw ShellError.internalFailure("Recording engine returned invalid result") }
            try execute("BEGIN IMMEDIATE")
            let prior = try scalarInt("SELECT checkpoint_sequence FROM sessions WHERE id=?", [.text(id)])
            guard prior == checkpointSequence else { try execute("ROLLBACK"); return }
            try run("UPDATE sessions SET checkpoint_sequence=?,checkpoint_json=?,metrics_json=? WHERE id=? AND engine_build_id=? AND algorithm_id=?", [
                .int(last), .text(canonicalJSON(nextCheckpoint)), .text(canonicalJSON(metrics)), .text(id), .text(row["engine_build_id"] as! String), .text(row["algorithm_id"] as! String)
            ])
            try execute("COMMIT")
            engineFailure = nil
            emitEvent?("metrics.updated", metrics)
            if last < (row["observation_sequence"] as! Int) { processEngineBacklog() }
        } catch {
            try? execute("ROLLBACK")
            engineFailure = error.localizedDescription
            emitIssue(code: "engineFailure", severity: "warning", message: error.localizedDescription, sequence: row["observation_sequence"] as? Int ?? 0)
        }
    }

    private func recoverInterruptedSession() throws {
        guard var row = try currentSessionRow(), let id = row["id"] as? String,
              let oldState = row["state"] as? String, ["recording", "paused"].contains(oldState) else { return }
        try execute("BEGIN IMMEDIATE")
        let now = ISOTime.now(); let started = row["last_transition_at"] as! String
        var sequence = row["observation_sequence"] as! Int
        sequence += 1
        let gap: [String: Any] = ["kind": "gap", "sessionId": id, "sequence": sequence, "sourceTimestamp": now,
            "monotonicTimestampMs": NSNull(), "startedAt": started, "endedAt": now, "reason": "processRestart"]
        try insertJournalEvent(eventId: "event-\(UUID().uuidString)", sessionId: id, kind: "lifecycle.gap", sourceTimestamp: now, receivedAt: now, monotonic: nil, provenance: "native.launchRecovery", payload: ["startedAt": started, "endedAt": now, "reason": "processRestart"])
        try insertObservation(sessionId: id, sequence: sequence, kind: "gap", timestamp: now, dedupeKey: "gap:\(row["revision"]!)", object: gap)
        sequence += 1
        let transition = transitionObservation(sessionId: id, sequence: sequence, from: oldState, to: "interrupted", at: now, cause: "systemInterruption", monotonic: nil)
        try insertJournalEvent(eventId: "event-\(UUID().uuidString)", sessionId: id, kind: "lifecycle.interrupted", sourceTimestamp: now, receivedAt: now, monotonic: nil, provenance: "native.launchRecovery", payload: ["from": oldState, "to": "interrupted", "cause": "systemInterruption"])
        try insertObservation(sessionId: id, sequence: sequence, kind: "transition", timestamp: now, dedupeKey: "transition:interrupted:\(row["revision"]!)", object: transition)
        try run("UPDATE sessions SET state='interrupted',revision=revision+1,last_transition_at=?,observation_sequence=?,recovery_required=1,interruption_started_at=?,recovery_reason='Recorder process restarted' WHERE id=?", [.text(now), .int(sequence), .text(started), .text(id)])
        try execute("COMMIT")
        row["observation_sequence"] = sequence
        log.append(subsystem: "recording", message: "Interrupted workout recovered for user decision", metadata: ["sessionId": id])
        processEngineBacklog()
    }

    private func notifyObservation(sessionId: String, sequence: Int) {
        guard var subscription, subscription.sessionId == sessionId, sequence > subscription.after,
              let page = try? readObservations(sessionId: sessionId, after: subscription.after, limit: subscription.limit) else { return }
        if let next = page["nextSequence"] as? Int { subscription.after = next; self.subscription = subscription }
        emitEvent?("observations.appended", page)
    }

    private func emitIssue(code: String, severity: String, message: String, sequence: Int) {
        let issue: [String: Any] = ["issueId": "issue-\(UUID().uuidString)", "severity": severity, "code": code,
            "message": String(message.prefix(2048)), "observedAt": ISOTime.now(), "durableSequence": sequence]
        if let session = try? currentOrLatestSessionRow(), let id = session["id"] as? String {
            try? run("INSERT INTO issues(session_id,issue_id,severity,code,observed_at,durable_sequence,message) VALUES(?,?,?,?,?,?,?)", [
                .text(id), .text(issue["issueId"] as! String), .text(severity), .text(code), .text(issue["observedAt"] as! String), .int(sequence), .text(issue["message"] as! String)
            ])
        }
        emitEvent?("recording.issue", issue)
    }

    private func snapshot(_ row: [String: Any]) -> [String: Any] {
        ["sessionId": row["id"]!, "state": row["state"]!, "revision": row["revision"]!,
         "durableSequence": row["observation_sequence"]!, "recorderAvailability": "available", "recorderUnavailableReason": "",
         "pinnedEngine": ["buildId": row["engine_build_id"]!, "apiVersion": row["engine_api"]!, "checkpointSchemaVersion": row["checkpoint_schema"]!],
         "capturedAt": ISOTime.now(), "sport": row["sport"]!, "startedAt": row["started_at"]!,
         "finishedAt": row["finished_at"] ?? NSNull(), "lastTransitionAt": row["last_transition_at"]!,
         "observationSequence": row["observation_sequence"]!,
         "recovery": ["required": (row["recovery_required"] as! Int) != 0, "interruptionStartedAt": row["interruption_started_at"] ?? NSNull(), "reason": row["recovery_reason"] ?? NSNull()],
         "metrics": decodeObject(row["metrics_json"] as? String) ?? defaultMetrics()]
    }

    private func idleSnapshot() -> [String: Any] {
        if !available {
            return ["sessionId": NSNull(), "state": "idle", "revision": 0, "durableSequence": 0, "recorderAvailability": "unavailable",
                    "recorderUnavailableReason": storageFailure ?? engineFailure ?? "Recording engine unavailable", "pinnedEngine": NSNull(), "capturedAt": ISOTime.now()]
        }
        return ["sessionId": NSNull(), "state": "idle", "revision": 0, "durableSequence": 0, "recorderAvailability": "available",
                "recorderUnavailableReason": "", "pinnedEngine": NSNull(), "capturedAt": ISOTime.now(), "sport": NSNull(), "startedAt": NSNull(),
                "finishedAt": NSNull(), "lastTransitionAt": NSNull(), "observationSequence": 0,
                "recovery": ["required": false, "interruptionStartedAt": NSNull(), "reason": NSNull()], "metrics": defaultMetrics()]
    }

    private func defaultMetrics() -> [String: Any] {
        ["activeDurationMs": 0, "elapsedDurationMs": 0, "distanceM": 0.0, "averageSpeedMps": NSNull(), "currentSpeedMps": NSNull(),
         "currentSpeedObservedAt": NSNull(), "altitudeM": NSNull(), "elevationGainM": 0.0, "heartRateBpm": NSNull(), "heartRateObservedAt": NSNull(),
         "locationQuality": "waiting", "heartRateQuality": "unconfigured"]
    }

    private func transitionObservation(sessionId: String, sequence: Int, from: String, to: String, at: String, cause: String, monotonic: Double?) -> [String: Any] {
        ["kind": "transition", "sessionId": sessionId, "sequence": sequence, "transitionId": "transition-\(UUID().uuidString)",
         "from": from, "to": to, "sourceTimestamp": at, "monotonicTimestampMs": monotonic ?? NSNull(), "cause": cause]
    }

    private func revisionConflict(_ row: [String: Any]? = nil) -> RecorderFailure {
        let current = row.map(snapshot) ?? sessionSnapshot()
        return RecorderFailure(code: "revisionConflict", message: "Expected revision does not match current workout", details: ["currentRevision": current["revision"]!, "session": current])
    }

    private func errorReply(requestId: String, code: String, message: String, retryable: Bool = false, details: [String: Any]? = nil) -> [String: Any] {
        ["protocolVersion": 1, "requestId": requestId, "ok": false,
         "error": ["code": code, "message": message, "retryable": retryable, "details": details ?? [:]]]
    }

    @discardableResult
    private func recordStorageFailure(_ error: Error, operation contextOperation: String, sessionId: String?, durableSequence: Int) -> [String: Any] {
        let storage = error as? RecordingStorageError
        let nsError = error as NSError
        let details: [String: Any] = [
            "domain": storage?.domain ?? nsError.domain,
            "code": Int(storage?.code ?? Int32(nsError.code)),
            "extendedCode": Int(storage?.extendedCode ?? Int32(nsError.code)),
            "message": String((storage?.message ?? error.localizedDescription).prefix(2048)),
            "operation": storage?.operation ?? contextOperation,
            "contextOperation": contextOperation,
            "sessionId": sessionId ?? NSNull(),
            "durableSequence": durableSequence,
            "journalDurableSequence": lastJournalSequence,
            "lastSuccessfulJournalWriteAt": lastJournalWriteAt ?? NSNull(),
            "journalQueuedCount": journalQueuedCount,
            "observedAt": ISOTime.now()
        ]
        storageFailure = details["message"] as? String
        storageFailureDetails = details
        log.append(subsystem: "recording.storage", message: "Recording storage failure", sessionId: sessionId, sequence: durableSequence, metadata: stringMetadata(details))
        return details
    }

    private func logLifecycleCommit(method: String, result: [String: Any]) {
        let session = result["session"] as? [String: Any] ?? result
        guard let sessionId = session["sessionId"] as? String else { return }
        let state = session["state"] as? String ?? "unknown"
        let event: String
        switch method {
        case "workout.start": event = "recording.started"
        case "workout.pause": event = "recording.paused"
        case "workout.resume": event = "recording.resumed"
        case "workout.finish": event = "recording.finished"
        case "workout.recover": event = state == "finished" ? "recording.finished" : "recording.recovered"
        default: event = "recording.lifecycle"
        }
        let metadata = ["event": event, "operation": method, "state": state, "commit": "success", "sessionId": sessionId]
        if event == "recording.finished" {
            log.append(subsystem: "recording.telemetry", message: "Recording stopped committed", sessionId: sessionId, sequence: session["durableSequence"] as? Int, metadata: ["event": "recording.stopped", "operation": method, "state": state, "commit": "success", "sessionId": sessionId])
        }
        log.append(subsystem: "recording.telemetry", message: "\(event) committed", sessionId: sessionId, sequence: session["durableSequence"] as? Int, metadata: metadata)
    }

    private func logLifecycleFailure(method: String, sessionId: String?, error: Error) {
        log.append(subsystem: "recording.telemetry", message: "Recording lifecycle commit failed", sessionId: sessionId, metadata: [
            "event": "recording.lifecycle.failure", "operation": method, "sessionId": sessionId ?? "none", "commit": "failure", "reason": error.localizedDescription
        ])
    }

    private func stringMetadata(_ values: [String: Any]) -> [String: String] {
        var result: [String: String] = [:]
        for (key, value) in values {
            if value is NSNull { result[key] = "null" }
            else if let string = value as? String { result[key] = string }
            else if let number = value as? NSNumber { result[key] = number.stringValue }
            else if let boolean = value as? Bool { result[key] = String(boolean) }
        }
        return result
    }

    private func migrate() throws {
        try execute("""
        CREATE TABLE IF NOT EXISTS sessions(
          id TEXT PRIMARY KEY,state TEXT NOT NULL,revision INTEGER NOT NULL,sport TEXT NOT NULL,start_policy TEXT NOT NULL,
          started_at TEXT NOT NULL,finished_at TEXT,last_transition_at TEXT NOT NULL,observation_sequence INTEGER NOT NULL,
          engine_build_id TEXT NOT NULL,engine_api INTEGER NOT NULL,checkpoint_schema INTEGER NOT NULL,algorithm_id TEXT NOT NULL,
          checkpoint_sequence INTEGER NOT NULL DEFAULT 0,checkpoint_json TEXT,metrics_json TEXT NOT NULL,
          engine_artifact_path TEXT NOT NULL,engine_artifact_sha256 TEXT NOT NULL,
          recovery_required INTEGER NOT NULL DEFAULT 0,interruption_started_at TEXT,recovery_reason TEXT);
        CREATE UNIQUE INDEX IF NOT EXISTS one_unfinished_session ON sessions((1)) WHERE state!='finished';
        CREATE TABLE IF NOT EXISTS observations(session_id TEXT NOT NULL,sequence INTEGER NOT NULL,kind TEXT NOT NULL,source_timestamp TEXT NOT NULL,dedupe_key TEXT NOT NULL,raw_event_id TEXT,json TEXT NOT NULL,
          PRIMARY KEY(session_id,sequence),UNIQUE(session_id,dedupe_key),FOREIGN KEY(session_id) REFERENCES sessions(id));
        CREATE TABLE IF NOT EXISTS outcomes(request_id TEXT PRIMARY KEY,method TEXT NOT NULL,params_json TEXT NOT NULL,reply_json TEXT NOT NULL,created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS raw_deliveries(id INTEGER PRIMARY KEY AUTOINCREMENT,session_id TEXT NOT NULL,kind TEXT NOT NULL,received_at TEXT NOT NULL,json TEXT NOT NULL,FOREIGN KEY(session_id) REFERENCES sessions(id));
        CREATE TABLE IF NOT EXISTS host_events(id INTEGER PRIMARY KEY AUTOINCREMENT,session_id TEXT NOT NULL,type TEXT NOT NULL,source_timestamp TEXT NOT NULL,json TEXT NOT NULL,FOREIGN KEY(session_id) REFERENCES sessions(id));
        CREATE TABLE IF NOT EXISTS issues(id INTEGER PRIMARY KEY AUTOINCREMENT,session_id TEXT NOT NULL,issue_id TEXT NOT NULL UNIQUE,severity TEXT NOT NULL,code TEXT NOT NULL,observed_at TEXT NOT NULL,durable_sequence INTEGER NOT NULL,message TEXT NOT NULL,FOREIGN KEY(session_id) REFERENCES sessions(id));
        CREATE TABLE IF NOT EXISTS journal_events(event_id TEXT PRIMARY KEY,session_id TEXT NOT NULL,journal_sequence INTEGER NOT NULL,kind TEXT NOT NULL,source_timestamp TEXT,received_at TEXT NOT NULL,monotonic_timestamp_ms REAL,clock_domain TEXT NOT NULL,raw_encoding TEXT NOT NULL,provenance TEXT NOT NULL,payload TEXT NOT NULL,
          UNIQUE(session_id,journal_sequence),FOREIGN KEY(session_id) REFERENCES sessions(id));
        """)
        try? execute("ALTER TABLE observations ADD COLUMN raw_event_id TEXT")
        try? execute("ALTER TABLE sessions ADD COLUMN engine_artifact_path TEXT NOT NULL DEFAULT ''")
        try? execute("ALTER TABLE sessions ADD COLUMN engine_artifact_sha256 TEXT NOT NULL DEFAULT ''")
        try? execute("ALTER TABLE journal_events ADD COLUMN batch_id TEXT")
        try? execute("ALTER TABLE journal_events ADD COLUMN batch_index INTEGER")
        try? execute("ALTER TABLE journal_events ADD COLUMN batch_size INTEGER")
    }

    private func insertObservation(sessionId: String, sequence: Int, kind: String, timestamp: String, dedupeKey: String, rawEventId: String? = nil, object: [String: Any]) throws {
        try run("INSERT INTO observations(session_id,sequence,kind,source_timestamp,dedupe_key,raw_event_id,json) VALUES(?,?,?,?,?,?,?)", [.text(sessionId), .int(sequence), .text(kind), .text(timestamp), .text(dedupeKey), rawEventId.map(Bind.text) ?? .null, .text(canonicalJSON(object))])
    }

    private func insertJournalEvent(eventId: String, sessionId: String, kind: String, sourceTimestamp: String?, receivedAt: String, monotonic: Double?, provenance: String, payload: [String: Any]) throws {
        let sequence = try scalarInt("SELECT COALESCE(MAX(journal_sequence),0)+1 FROM journal_events WHERE session_id=?", [.text(sessionId)])
        let batchId = payload["callbackBatchId"] as? String
        let batchIndex = (payload["callbackBatchIndex"] as? NSNumber)?.intValue
        let batchSize = (payload["callbackBatchCount"] as? NSNumber)?.intValue
        try run("INSERT INTO journal_events(event_id,session_id,journal_sequence,kind,source_timestamp,received_at,monotonic_timestamp_ms,clock_domain,raw_encoding,provenance,payload,batch_id,batch_index,batch_size) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [
            .text(eventId), .text(sessionId), .int(sequence), .text(kind), sourceTimestamp.map(Bind.text) ?? .null, .text(receivedAt), monotonic.map(Bind.double) ?? .null,
            .text("processUptimeMilliseconds"), .text("json"), .text(provenance), .text(canonicalJSON(payload)), batchId.map(Bind.text) ?? .null, batchIndex.map(Bind.int) ?? .null, batchSize.map(Bind.int) ?? .null
        ])
        lastJournalSequence = sequence
        lastJournalWriteAt = ISOTime.now()
    }

    private func currentSessionRow() throws -> [String: Any]? { try query("SELECT * FROM sessions WHERE state!='finished' ORDER BY started_at DESC LIMIT 1").first }
    private func currentOrLatestSessionRow() throws -> [String: Any]? { try query("SELECT * FROM sessions ORDER BY started_at DESC LIMIT 1").first }
    private func sessionRow(id: String) throws -> [String: Any]? { try query("SELECT * FROM sessions WHERE id=?", [.text(id)]).first }
    private func sessionExists(_ id: String) throws -> Bool { try scalarInt("SELECT COUNT(*) FROM sessions WHERE id=?", [.text(id)]) > 0 }
    private func observationSequence(_ id: String) throws -> Int { try scalarInt("SELECT observation_sequence FROM sessions WHERE id=?", [.text(id)]) }
    private func allObservationObjects(_ id: String) throws -> [[String: Any]] { try query("SELECT json FROM observations WHERE session_id=? ORDER BY sequence", [.text(id)]).compactMap { decodeObject($0["json"] as? String) } }

    private func journalObject(_ row: [String: Any], sessionId: String) -> [String: Any] {
        let payload = decodeObject(row["payload"] as? String) ?? [:]
        let batch: Any
        if let id = row["batch_id"] as? String, let index = row["batch_index"] as? Int, let size = row["batch_size"] as? Int {
            batch = ["batchId": id, "index": index, "size": size]
        } else { batch = NSNull() }
        let sourceId: Any = payload["deviceId"] as? String ?? NSNull()
        return [
            "formatVersion": 1, "eventId": row["event_id"]!, "sessionId": sessionId, "journalSequence": row["journal_sequence"]!,
            "kind": row["kind"]!, "sourceTimestamp": row["source_timestamp"] ?? NSNull(), "receivedAt": row["received_at"]!,
            "monotonicTimestampMs": row["monotonic_timestamp_ms"] ?? NSNull(),
            "provenance": ["origin": "liveNative", "sourceId": sourceId, "monotonicClockId": row["clock_domain"] ?? NSNull(), "lineage": NSNull()],
            "batch": batch, "payload": ["encoding": "json", "value": payload]
        ]
    }

    private func savedSummary(_ row: [String: Any]) throws -> [String: Any] {
        let id = row["id"] as! String; let started = row["started_at"] as! String; let finished = row["finished_at"] as! String
        let count = row["observation_sequence"] as! Int
        let rawCount = try scalarInt("SELECT COUNT(*) FROM journal_events WHERE session_id=?", [.text(id)])
        let fatal = try scalarInt("SELECT COUNT(*) FROM issues WHERE session_id=? AND severity='fatal'", [.text(id)]) > 0
        let duration = max(0, Int(((ISO8601DateFormatter().date(from: finished)?.timeIntervalSince(ISO8601DateFormatter().date(from: started) ?? Date())) ?? 0) * 1000))
        return ["savedWorkoutId": id, "sessionId": id, "sport": row["sport"]!, "startedAt": started, "finishedAt": finished, "durationMs": duration,
                "observationCount": count, "latestSequence": count, "metrics": decodeObject(row["metrics_json"] as? String) ?? defaultMetrics(), "hasFatalIssue": fatal,
                "rawEventCount": rawCount, "lastJournalSequence": rawCount]
    }

    private func encodeArchiveCursor(snapshotAt: String, row: [String: Any]) -> String {
        Data(canonicalJSON(["snapshotAt": snapshotAt, "finishedAt": row["finished_at"]!, "id": row["id"]!]).utf8).base64EncodedString()
    }

    private func decodeArchiveCursor(_ value: String) throws -> (snapshotAt: String, finishedAt: String, id: String) {
        guard let data = Data(base64Encoded: value), let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let snapshotAt = object["snapshotAt"] as? String, let finishedAt = object["finishedAt"] as? String, let id = object["id"] as? String else {
            throw ShellError.invalidRequest("Invalid archive cursor")
        }
        return (snapshotAt, finishedAt, id)
    }

    private func storedOutcome(requestId: String) throws -> (method: String, params: String, reply: [String: Any])? {
        guard let row = try query("SELECT method,params_json,reply_json FROM outcomes WHERE request_id=?", [.text(requestId)]).first,
              let method = row["method"] as? String, let params = row["params_json"] as? String,
              let reply = decodeObject(row["reply_json"] as? String) else { return nil }
        return (method, params, reply)
    }

    private func storeOutcome(requestId: String, method: String, params: String, reply: [String: Any]) throws {
        try run("INSERT INTO outcomes(request_id,method,params_json,reply_json,created_at) VALUES(?,?,?,?,?)", [.text(requestId), .text(method), .text(params), .text(canonicalJSON(reply)), .text(ISOTime.now())])
    }

    private enum Bind { case text(String), int(Int), double(Double), null }
    private func execute(_ sql: String) throws {
        var error: UnsafeMutablePointer<CChar>?
        let result = sqlite3_exec(database, sql, nil, nil, &error)
        guard result == SQLITE_OK else {
            let message = error.map { String(cString: $0) }; sqlite3_free(error)
            throw sqliteFailure(operation: "sqlite.exec.\(sqlOperation(sql))", resultCode: result, message: message)
        }
    }
    private func run(_ sql: String, _ binds: [Bind] = []) throws {
        var statement: OpaquePointer?; let prepared = sqlite3_prepare_v2(database, sql, -1, &statement, nil); guard prepared == SQLITE_OK else { throw sqliteFailure(operation: "sqlite.prepare.\(sqlOperation(sql))", resultCode: prepared) }
        defer { sqlite3_finalize(statement) }; bind(binds, to: statement)
        let stepped = sqlite3_step(statement); guard stepped == SQLITE_DONE else { throw sqliteFailure(operation: "sqlite.step.\(sqlOperation(sql))", resultCode: stepped) }
    }
    private func query(_ sql: String, _ binds: [Bind] = []) throws -> [[String: Any]] {
        var statement: OpaquePointer?; let prepared = sqlite3_prepare_v2(database, sql, -1, &statement, nil); guard prepared == SQLITE_OK else { throw sqliteFailure(operation: "sqlite.prepare.\(sqlOperation(sql))", resultCode: prepared) }
        defer { sqlite3_finalize(statement) }; bind(binds, to: statement); var rows: [[String: Any]] = []
        var result = sqlite3_step(statement)
        while result == SQLITE_ROW {
            var row: [String: Any] = [:]
            for index in 0..<sqlite3_column_count(statement) {
                let name = String(cString: sqlite3_column_name(statement, index))
                switch sqlite3_column_type(statement, index) {
                case SQLITE_INTEGER: row[name] = Int(sqlite3_column_int64(statement, index))
                case SQLITE_FLOAT: row[name] = sqlite3_column_double(statement, index)
                case SQLITE_TEXT: row[name] = String(cString: sqlite3_column_text(statement, index))
                default: break
                }
            }
            rows.append(row)
            result = sqlite3_step(statement)
        }
        guard result == SQLITE_DONE else { throw sqliteFailure(operation: "sqlite.step.\(sqlOperation(sql))", resultCode: result) }
        return rows
    }
    private func scalarInt(_ sql: String, _ binds: [Bind] = []) throws -> Int { try query(sql, binds).first?.values.first as? Int ?? 0 }
    private func bind(_ values: [Bind], to statement: OpaquePointer?) {
        for (offset, value) in values.enumerated() { let index = Int32(offset + 1); switch value {
        case .text(let text): sqlite3_bind_text(statement, index, text, -1, sqliteTransient)
        case .int(let integer): sqlite3_bind_int64(statement, index, sqlite3_int64(integer))
        case .double(let double): sqlite3_bind_double(statement, index, double)
        case .null: sqlite3_bind_null(statement, index)
        } }
    }
    private func sqliteFailure(operation: String, resultCode: Int32? = nil, message: String? = nil) -> RecordingStorageError {
        let code = resultCode ?? database.map(sqlite3_errcode) ?? SQLITE_MISUSE
        let extended = database.map(sqlite3_extended_errcode) ?? code
        let detail = message ?? database.map { String(cString: sqlite3_errmsg($0)) } ?? "SQLite unavailable"
        return RecordingStorageError(operation: operation, code: code, extendedCode: extended, message: detail)
    }

    private func sqlOperation(_ sql: String) -> String {
        sql.trimmingCharacters(in: .whitespacesAndNewlines).split(whereSeparator: { $0.isWhitespace || $0 == ";" }).first.map(String.init)?.uppercased() ?? "UNKNOWN"
    }

    private func canonicalJSON(_ object: Any) -> String {
        let data = try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes])
        return String(decoding: data, as: UTF8.self)
    }
    private func decodeObject(_ value: String?) -> [String: Any]? {
        guard let value, let data = value.data(using: .utf8) else { return nil }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }
    private func monotonicMilliseconds() -> Double { ProcessInfo.processInfo.systemUptime * 1000 }

    private func pinEngineArtifact(_ source: URL) throws -> (url: URL, sha256: String) {
        let data = try Data(contentsOf: source)
        let hash = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let directory = support.appendingPathComponent("PinnedRecordingEngines", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let destination = directory.appendingPathComponent("\(hash).js")
        if !FileManager.default.fileExists(atPath: destination.path) { try data.write(to: destination, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]) }
        return (destination, hash)
    }

    private func bundleFiles(session: [String: Any], observations: [[String: Any]]) throws -> [String: Data] {
        let sessionData = try JSONSerialization.data(withJSONObject: snapshot(session), options: [.prettyPrinted, .sortedKeys])
        let observationsData = try JSONSerialization.data(withJSONObject: observations, options: [.prettyPrinted, .sortedKeys])
        let metrics = try JSONSerialization.data(withJSONObject: decodeObject(session["metrics_json"] as? String) ?? defaultMetrics(), options: [.prettyPrinted, .sortedKeys])
        let journal = try query("SELECT * FROM journal_events WHERE session_id=? ORDER BY journal_sequence", [.text(session["id"] as! String)])
        let host = try query("SELECT id,type,source_timestamp,json FROM host_events WHERE session_id=? ORDER BY id", [.text(session["id"] as! String)])
        let issues = try query("SELECT issue_id,severity,code,observed_at,durable_sequence,message FROM issues WHERE session_id=? ORDER BY id", [.text(session["id"] as! String)])
        let journalData = try JSONSerialization.data(withJSONObject: journal.map { journalObject($0, sessionId: session["id"] as! String) }, options: [.prettyPrinted, .sortedKeys])
        let hostData = try JSONSerialization.data(withJSONObject: host.map { ["eventId": $0["id"]!, "type": $0["type"]!, "sourceTimestamp": $0["source_timestamp"]!, "payload": decodeObject($0["json"] as? String) ?? [:]] }, options: [.prettyPrinted, .sortedKeys])
        let issueData = try JSONSerialization.data(withJSONObject: issues, options: [.prettyPrinted, .sortedKeys])
        var files = ["session.json": sessionData, "observations.json": observationsData, "journal-events.json": journalData, "host-events.json": hostData, "issues.json": issueData, "metrics.json": metrics]
        let listed = files.keys.sorted().map { name in ["path": name, "sha256": SHA256.hash(data: files[name]!).map { String(format: "%02x", $0) }.joined()] }
        files["manifest.json"] = try JSONSerialization.data(withJSONObject: ["formatVersion": 1, "kind": "workoutBundleV1", "sessionId": session["id"]!, "engineBuildId": session["engine_build_id"]!, "engineArtifactSha256": session["engine_artifact_sha256"]!, "algorithmId": session["algorithm_id"]!, "files": listed], options: [.prettyPrinted, .sortedKeys])
        return files
    }

    private func gpx(session: [String: Any], observations: [[String: Any]]) -> String {
        let points = observations.filter { $0["kind"] as? String == "location" && ($0["horizontalAccuracyM"] as? Double ?? 999) <= 50 }.map { item -> String in
            let ele = (item["altitudeM"] as? Double).map { "<ele>\($0)</ele>" } ?? ""
            return "<trkpt lat=\"\(item["latitudeDegrees"]!)\" lon=\"\(item["longitudeDegrees"]!)\">\(ele)<time>\(item["sourceTimestamp"]!)</time></trkpt>"
        }.joined()
        return "<?xml version=\"1.0\" encoding=\"UTF-8\"?><gpx version=\"1.1\" creator=\"Workout Analyze\" xmlns=\"http://www.topografix.com/GPX/1/1\"><trk><name>Workout \(session["id"]!)</name><trkseg>\(points)</trkseg></trk></gpx>"
    }
}

private struct RecordingStorageError: Error, LocalizedError, @unchecked Sendable {
    let operation: String
    let code: Int32
    let extendedCode: Int32
    let message: String
    let domain = "SQLite"

    var errorDescription: String? { "SQLite \(operation) failed (\(code)/\(extendedCode)): \(message)" }
}

private struct RecorderFailure: Error, LocalizedError, @unchecked Sendable {
    let code: String
    let message: String
    var details: [String: Any] = [:]
    var errorDescription: String? { message }
}

private enum StoredZip {
    static func write(files: [String: Data], to url: URL) throws {
        var archive = Data(); var central = Data(); var offset: UInt32 = 0
        for name in files.keys.sorted() {
            let data = files[name]!; let nameData = Data(name.utf8); let crc = crc32(data)
            var local = Data(); local.u32(0x04034b50); local.u16(20); local.u16(0); local.u16(0); local.u16(0); local.u16(0); local.u32(crc); local.u32(UInt32(data.count)); local.u32(UInt32(data.count)); local.u16(UInt16(nameData.count)); local.u16(0); local.append(nameData); local.append(data)
            var entry = Data(); entry.u32(0x02014b50); entry.u16(20); entry.u16(20); entry.u16(0); entry.u16(0); entry.u16(0); entry.u16(0); entry.u32(crc); entry.u32(UInt32(data.count)); entry.u32(UInt32(data.count)); entry.u16(UInt16(nameData.count)); entry.u16(0); entry.u16(0); entry.u16(0); entry.u16(0); entry.u32(0); entry.u32(offset); entry.append(nameData)
            archive.append(local); central.append(entry); offset = UInt32(archive.count)
        }
        let centralOffset = UInt32(archive.count); archive.append(central); archive.u32(0x06054b50); archive.u16(0); archive.u16(0); archive.u16(UInt16(files.count)); archive.u16(UInt16(files.count)); archive.u32(UInt32(central.count)); archive.u32(centralOffset); archive.u16(0)
        try archive.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    private static func crc32(_ data: Data) -> UInt32 { data.reduce(UInt32(0xffffffff)) { crc, byte in (0..<8).reduce(crc ^ UInt32(byte)) { value, _ in value & 1 == 1 ? 0xedb88320 ^ (value >> 1) : value >> 1 } } ^ 0xffffffff }
}

private extension Data {
    mutating func u16(_ value: UInt16) { var little = value.littleEndian; append(Data(bytes: &little, count: 2)) }
    mutating func u32(_ value: UInt32) { var little = value.littleEndian; append(Data(bytes: &little, count: 4)) }
}
