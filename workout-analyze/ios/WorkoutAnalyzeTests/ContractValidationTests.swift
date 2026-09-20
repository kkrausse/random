import XCTest
@testable import WorkoutAnalyze

final class ContractValidationTests: XCTestCase {
    func testSafeRelativePaths() {
        XCTAssertTrue(ContractValidation.safeRelativePath("ui/assets/main.js"))
        for value in ["", "/absolute", "../escape", "ui/../escape", "ui//x", "ui\\x", "./x", "ui/a%20b.js", "ui/a?b", "ui/a#b", "ui/a\u{7f}b"] {
            XCTAssertFalse(ContractValidation.safeRelativePath(value), value)
        }
    }

    func testDevelopmentOriginValidation() {
        XCTAssertNotNil(ContractValidation.developmentURL("http://192.168.1.8:3001"))
        XCTAssertNotNil(ContractValidation.developmentURL("https://dev.example.test/"))
        for value in ["ftp://example.test", "http://user:pass@example.test", "http://example.test/path", "http://example.test/?token=x", "http://example.test/#x"] {
            XCTAssertNil(ContractValidation.developmentURL(value), value)
        }
    }

    func testOriginUsesNormalizedPorts() {
        XCTAssertTrue(ContractValidation.sameOrigin(URL(string: "https://example.test/x")!, URL(string: "https://example.test:443/")!))
        XCTAssertFalse(ContractValidation.sameOrigin(URL(string: "http://example.test/")!, URL(string: "https://example.test/")!))
        XCTAssertFalse(ContractValidation.sameOrigin(URL(string: "https://other.test/")!, URL(string: "https://example.test/")!))
    }

    func testCommandRejectsUnknownKeysAndSubsets() throws {
        let valid: [String: Any] = ["protocolVersion": 1, "requestId": "web-1", "method": "diagnostics.runChecks", "params": ["checks": ["bridgePing", "engineFixture"]]]
        XCTAssertNoThrow(try ContractValidation.validateCommand(valid))
        var bad = valid; bad["extra"] = true
        XCTAssertThrowsError(try ContractValidation.validateCommand(bad))
        var badCheck = valid; badCheck["params"] = ["checks": ["liveGPS"]]
        XCTAssertThrowsError(try ContractValidation.validateCommand(badCheck))
    }

    func testSensorCommandBounds() {
        let start: [String: Any] = ["protocolVersion": 1, "requestId": "sensor-1", "method": "location.start", "params": ["desiredAccuracy": "best", "distanceFilterM": 2.5, "backgroundMode": "foregroundOnly", "maxDurationSeconds": 60]]
        XCTAssertNoThrow(try ContractValidation.validateCommand(start))
        var tooLong = start
        tooLong["params"] = ["desiredAccuracy": "best", "distanceFilterM": 2.5, "backgroundMode": "foregroundOnly", "maxDurationSeconds": 1801]
        XCTAssertThrowsError(try ContractValidation.validateCommand(tooLong))
        let read: [String: Any] = ["protocolVersion": 1, "requestId": "sensor-2", "method": "heartRate.read", "params": ["connectionId": "hr-1", "afterCursor": NSNull(), "limit": 200]]
        XCTAssertNoThrow(try ContractValidation.validateCommand(read))
        let journal: [String: Any] = ["protocolVersion": 1, "requestId": "journal-1", "method": "journal.read", "params": ["sessionId": "ride-1", "afterJournalSequence": NSNull(), "limit": 200]]
        XCTAssertNoThrow(try ContractValidation.validateCommand(journal))
    }

    func testHeartRatePacketParsing() {
        let uint8 = SensorService.parseHeartRatePacket(Data([0x00, 72]))
        XCTAssertEqual(uint8?["bpm"] as? Int, 72)
        XCTAssertEqual(uint8?["valueFormat"] as? String, "uint8")
        let rich = SensorService.parseHeartRatePacket(Data([0x1F, 0x2C, 0x01, 0x34, 0x12, 0x00, 0x04]))
        XCTAssertEqual(rich?["bpm"] as? Int, 300)
        XCTAssertEqual(rich?["energyExpendedKJ"] as? Int, 0x1234)
        XCTAssertEqual((rich?["rrIntervalsSeconds"] as? [Double])?.first, 1.0)
        XCTAssertNil(SensorService.parseHeartRatePacket(Data([0x01, 0x2C])))
    }

    func testPrivateRawLineageNeverEntersPublicSensorValues() {
        let parsed = SensorService.parseHeartRatePacket(Data([0x00, 147]))!
        let heartRate = SensorService.recordingLinkedCopies(publicValue: parsed, rawEventId: "event-hr-1")
        XCTAssertNil(heartRate.publicValue["_rawEventId"])
        XCTAssertEqual(heartRate.recorderValue["_rawEventId"] as? String, "event-hr-1")

        let location = SensorService.recordingLinkedCopies(publicValue: ["cursor": 1, "horizontalAccuracyM": 5.0], rawEventId: "event-gps-1")
        XCTAssertNil(location.publicValue["_rawEventId"])
        XCTAssertEqual(location.recorderValue["_rawEventId"] as? String, "event-gps-1")
    }

    func testBundledManifestAndHashes() throws {
        let resources = Bundle(for: Self.self).resourceURL!.appendingPathComponent("BundledBuild")
        let data = try Data(contentsOf: resources.appendingPathComponent("manifest.json"))
        let manifest = try ContractValidation.validateManifest(data: data)
        XCTAssertEqual(manifest.buildId, "bundled-1")
        XCTAssertEqual(manifest.files.count, 2)
    }

    func testManifestRejectsTraversalAndUnknownKeys() throws {
        let validHash = String(repeating: "a", count: 64)
        let base: [String: Any] = [
            "formatVersion": 1, "buildId": "test-1", "createdAt": "2026-09-19T12:00:00Z",
            "uiEntryPath": "../index.html", "engineEntryPath": "engine/e.js", "engineBuildId": "phase1-engine-v1",
            "bridgeProtocol": ["min": 1, "max": 1], "engineApi": ["min": 1, "max": 1], "checkpointSchemaVersion": 1,
            "requiredCapabilities": ["bridge.ping"],
            "files": [["path": "../index.html", "role": "ui", "sizeBytes": 1, "sha256": validHash], ["path": "engine/e.js", "role": "engine", "sizeBytes": 1, "sha256": validHash]]
        ]
        XCTAssertThrowsError(try ContractValidation.validateManifest(data: JSONSerialization.data(withJSONObject: base)))
        var unknown = base; unknown["surprise"] = true
        XCTAssertThrowsError(try ContractValidation.validateManifest(data: JSONSerialization.data(withJSONObject: unknown)))
    }

    func testHandshakeDeadlinesAreScopedToNavigationGeneration() {
        var tracker = StartupHandshakeTracker()
        let stale = tracker.beginNavigation()
        tracker.navigationCommitted(generation: stale)
        let current = tracker.beginNavigation()

        XCTAssertEqual(tracker.hello(generation: stale), .ignored)
        XCTAssertFalse(tracker.navigationTimedOut(generation: stale))
        tracker.navigationCommitted(generation: current)
        XCTAssertTrue(tracker.navigationFinished(generation: current))
        XCTAssertEqual(tracker.hello(generation: current), .completed)
        XCTAssertFalse(tracker.handshakeTimedOut(generation: current))
    }

    func testLateHelloRecoversOnlyCurrentFailedGeneration() {
        var tracker = StartupHandshakeTracker()
        let generation = tracker.beginNavigation()
        tracker.navigationCommitted(generation: generation)
        XCTAssertTrue(tracker.navigationFinished(generation: generation))
        XCTAssertTrue(tracker.handshakeTimedOut(generation: generation))
        XCTAssertEqual(tracker.hello(generation: generation), .recovered)

        let replacement = tracker.beginNavigation()
        tracker.navigationCommitted(generation: replacement)
        XCTAssertEqual(tracker.hello(generation: generation), .ignored)
        XCTAssertEqual(tracker.hello(generation: replacement), .completed)
    }

    @MainActor
    func testNativeSourceLifecycleDistinguishesConfiguredTargetAndLoaded() throws {
        let builds = BuildManager(log: DiagnosticLog())
        defer { _ = try? builds.configureDevelopmentSource(nil) }
        let configured = URL(string: "http://100.86.29.19:4317/")!
        _ = try builds.configureDevelopmentSource(configured.absoluteString)

        builds.noteUILoadStarted(url: configured, generation: 4)
        XCTAssertEqual(builds.uiLoadState, "navigating")
        XCTAssertNil(builds.loadedUIURL)
        builds.noteUINavigationFinished(url: configured, generation: 4)
        XCTAssertEqual(builds.uiLoadState, "awaitingHello")
        builds.noteUIHandshakeSucceeded(url: configured, generation: 3)
        XCTAssertEqual(builds.uiLoadState, "awaitingHello", "A stale generation must not become loaded")
        builds.noteUIHandshakeSucceeded(url: configured, generation: 4)
        XCTAssertEqual(builds.uiLoadState, "ready")
        XCTAssertEqual(builds.loadedUIURL, configured)
        XCTAssertNil(builds.currentLoadFailure)

        let status = builds.sourceStatusDictionary()
        XCTAssertEqual((status["configured"] as? [String: String])?["url"], configured.absoluteString)
        XCTAssertEqual(status["loadedUrl"] as? String, configured.absoluteString)
    }

    @MainActor
    func testRecorderPersistsIdempotentLifecycleRawDeliveriesAndRecovery() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let database = directory.appendingPathComponent("recording.sqlite")
        let builds = BuildManager(log: DiagnosticLog())
        var recorder: RecordingService? = RecordingService(builds: builds, log: DiagnosticLog(), databaseURL: database)
        XCTAssertTrue(recorder!.available)

        let startParams: [String: Any] = ["expectedRevision": 0, "sport": "cycling", "startPolicy": "immediate"]
        let first = recorder!.handleMutation(requestId: "start-fixture", method: "workout.start", params: startParams)
        let duplicate = recorder!.handleMutation(requestId: "start-fixture", method: "workout.start", params: startParams)
        XCTAssertEqual(canonical(first), canonical(duplicate))
        let started = first["result"] as! [String: Any]
        let sessionId = started["sessionId"] as! String

        let locationEvent = recorder!.appendJournalEvent(kind: "locationDelivery", provenance: "fixture", payload: ["sourceTimestamp": "2026-09-20T00:00:01Z", "receivedAt": "2026-09-20T00:00:30Z", "horizontalAccuracyM": 250.0, "latitudeDegrees": 1.0, "longitudeDegrees": 2.0])
        let heartRateEvent = recorder!.appendJournalEvent(kind: "heartRateCharacteristicDelivery", provenance: "fixture", payload: ["receivedAt": "2026-09-20T00:00:02Z", "rawCharacteristicBase64": Data([1, 2, 3]).base64EncodedString(), "rawFlags": 31])
        XCTAssertNotNil(locationEvent); XCTAssertNotNil(heartRateEvent)
        _ = recorder!.appendJournalEvent(kind: "locationDelivery", provenance: "fixture", payload: ["sourceTimestamp": "2026-09-20T00:00:00Z", "receivedAt": "2026-09-20T00:00:31Z", "callbackBatchId": "batch-1", "callbackBatchIndex": 1, "callbackBatchCount": 2])
        let rawBeforeDecode = try recorder!.readJournal(sessionId: sessionId, after: nil, limit: 20)
        let rawItems = rawBeforeDecode["items"] as! [[String: Any]]
        XCTAssertEqual(rawItems.map { $0["journalSequence"] as! Int }, Array(1...rawItems.count), "Raw delivery order must not be source-time sorted")
        XCTAssertEqual(((rawItems.last?["batch"] as? [String: Any])?["index"] as? Int), 1)
        let reorderedLocation = rawItems.first { item in
            (((item["payload"] as? [String: Any])?["value"] as? [String: Any])?["sourceTimestamp"] as? String) == "2026-09-20T00:00:00Z"
        }
        XCTAssertEqual(reorderedLocation?["journalSequence"] as? Int, rawItems.count)
        XCTAssertNil(SensorService.parseHeartRatePacket(Data([0x01, 0x2C])))
        let bytes = rawItems.compactMap { (($0["payload"] as? [String: Any])?["value"] as? [String: Any])?["rawCharacteristicBase64"] as? String }.first
        XCTAssertEqual(bytes, "AQID", "Malformed/decode-independent bytes must remain exact")
        recorder!.ingestLocation(["cursor": 1, "source": "coreLocation", "sourceTimestamp": "2026-09-20T00:00:01Z", "receivedAt": "2026-09-20T00:00:30Z", "latitudeDegrees": 1.0, "longitudeDegrees": 2.0, "horizontalAccuracyM": 250.0, "altitudeM": NSNull(), "verticalAccuracyM": NSNull(), "speedMps": NSNull(), "speedAccuracyMps": NSNull(), "courseDegrees": NSNull(), "courseAccuracyDegrees": NSNull(), "floorLevel": NSNull(), "isSimulatedBySoftware": false, "isProducedByAccessory": false])
        recorder!.ingestHeartRate(["cursor": 1, "connectionId": "hr-fixture", "deviceId": "device-fixture", "receivedAt": "2026-09-20T00:00:02Z", "bpm": 147, "valueFormat": "uint8", "sensorContact": "detected", "energyExpendedKJ": 12, "rrIntervalsSeconds": [0.8], "rawFlags": 31])
        let observations = try recorder!.readObservations(sessionId: sessionId, after: nil, limit: 20)["items"] as! [[String: Any]]
        XCTAssertTrue(observations.contains { $0["kind"] as? String == "location" && $0["horizontalAccuracyM"] as? Double == 250 })
        XCTAssertTrue(observations.contains { $0["kind"] as? String == "heartRate" && $0["rawFlags"] as? Int == 31 })
        let pause = recorder!.handleMutation(requestId: "pause-fixture", method: "workout.pause", params: ["sessionId": sessionId, "expectedRevision": 1])
        XCTAssertEqual((pause["result"] as? [String: Any])?["revision"] as? Int, 2)
        recorder!.shutdownForTesting(); recorder = nil

        let reopened = RecordingService(builds: builds, log: DiagnosticLog(), databaseURL: database)
        let recovered = reopened.sessionSnapshot()
        XCTAssertEqual(recovered["state"] as? String, "interrupted")
        XCTAssertEqual(recovered["revision"] as? Int, 3)
        XCTAssertEqual((recovered["recovery"] as? [String: Any])?["required"] as? Bool, true)
        let finish = reopened.handleMutation(requestId: "recover-finish", method: "workout.recover", params: ["sessionId": sessionId, "expectedRevision": 3, "action": "finish"])
        XCTAssertEqual(((finish["result"] as? [String: Any])?["session"] as? [String: Any])?["state"] as? String, "finished")
        let archivePage = try reopened.listArchive(after: nil, limit: 10)
        let summaries = archivePage["items"] as! [[String: Any]]
        XCTAssertEqual(summaries.first?["sessionId"] as? String, sessionId)
        let reopenedJournal = try reopened.readJournal(sessionId: sessionId, after: nil, limit: 200)
        XCTAssertEqual(summaries.first?["rawEventCount"] as? Int, reopenedJournal["latestJournalSequence"] as? Int)
        let detail = try reopened.archiveDetail(savedWorkoutId: sessionId, after: nil, limit: 200)
        XCTAssertEqual((detail["recordingFormatVersion"] as? Int), 1)
        XCTAssertEqual(((detail["summary"] as? [String: Any])?["sessionId"] as? String), sessionId)
        let exported = try reopened.export(sessionId: sessionId, format: "workoutBundleV1")
        let archive = try Data(contentsOf: exported.url)
        XCTAssertNotNil(archive.range(of: Data("journal-events.json".utf8)))
        XCTAssertNotNil(archive.range(of: Data("AQID".utf8)))
        XCTAssertNotNil(archive.range(of: Data("journalSequence".utf8)), "Bundle journal must use the frozen RawWorkoutEvent field name")
        reopened.shutdownForTesting()
    }

    @MainActor
    func testRawJournalStorageFailureRetainsSQLiteCauseAndOperation() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let log = DiagnosticLog()
        let recorder = RecordingService(builds: BuildManager(log: log), log: log, databaseURL: directory.appendingPathComponent("recording.sqlite"))
        let start = recorder.handleMutation(requestId: "storage-failure-start", method: "workout.start", params: ["expectedRevision": 0, "sport": "cycling", "startPolicy": "immediate"])
        let sessionId = (start["result"] as! [String: Any])["sessionId"] as! String

        try recorder.setQueryOnlyForTesting(true)
        let rawEvent = recorder.appendJournalEvent(kind: "locationDelivery", provenance: "storage-failure-fixture", payload: ["receivedAt": "2026-09-20T00:00:00Z", "sourceTimestamp": "2026-09-20T00:00:00Z"])

        XCTAssertNil(rawEvent, "A failed raw append must not claim a durable event ID")
        let failure = recorder.storageFailureDetails
        XCTAssertEqual(failure?["domain"] as? String, "SQLite")
        XCTAssertNotEqual(failure?["code"] as? Int, 0)
        XCTAssertTrue((failure?["operation"] as? String)?.contains("sqlite.") == true)
        XCTAssertEqual(failure?["contextOperation"] as? String, "journal.append.locationDelivery")
        XCTAssertEqual(failure?["sessionId"] as? String, sessionId)
        XCTAssertNotNil(failure?["message"] as? String)
        let failureEntry = log.entries.last { $0.subsystem == "recording.storage" }
        XCTAssertEqual(failureEntry?.metadata["sessionId"], sessionId)
        XCTAssertEqual(failureEntry?.metadata["contextOperation"], "journal.append.locationDelivery")
        XCTAssertNotEqual(failureEntry?.message, "Recording storage failed")
        try recorder.setQueryOnlyForTesting(false)
        recorder.shutdownForTesting()
    }

    private func canonical(_ value: Any) -> String {
        String(decoding: try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]), as: UTF8.self)
    }
}
