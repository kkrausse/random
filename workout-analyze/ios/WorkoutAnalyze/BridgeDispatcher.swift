import Foundation

@MainActor
final class BridgeDispatcher {
    let builds: BuildManager
    let diagnostics: DiagnosticsService
    let sensors: SensorService
    let recording: RecordingService
    let log: DiagnosticLog
    var presentShare: ((URL) -> Bool)?
    var reloadUI: (() -> Void)?
    var emitEvent: ((String, [String: Any]) -> Void)?

    private var mutationCache: [String: (method: String, reply: [String: Any])] = [:]

    init(builds: BuildManager, diagnostics: DiagnosticsService, sensors: SensorService, recording: RecordingService, log: DiagnosticLog) {
        self.builds = builds; self.diagnostics = diagnostics; self.sensors = sensors; self.recording = recording; self.log = log
    }

    func dispatch(_ body: Any) async -> [String: Any] {
        var requestId = "invalid"
        do {
            let command = try ContractValidation.validateCommand(body)
            requestId = command.requestId
            if ["workout.start", "workout.pause", "workout.resume", "workout.finish", "workout.recover"].contains(command.method) {
                let reply = recording.handleMutation(requestId: requestId, method: command.method, params: command.params)
                if reply["ok"] as? Bool == true { synchronizeRecordingSensors(reply: reply) }
                diagnostics.noteBridgeRoundTrip()
                return reply
            }
            if let cached = mutationCache[requestId] {
                guard cached.method == command.method else { throw ShellError.invalidRequest("Request ID was already used for another method") }
                return cached.reply
            }
            let result = try await execute(method: command.method, params: command.params)
            let reply: [String: Any] = ["protocolVersion": 1, "requestId": requestId, "ok": true, "result": result]
            if isMutation(command.method) {
                mutationCache[requestId] = (command.method, reply)
                if mutationCache.count > 100 { mutationCache.removeValue(forKey: mutationCache.keys.sorted().first!) }
            }
            diagnostics.noteBridgeRoundTrip()
            return reply
        } catch {
            let shell = error as? ShellError ?? ShellError.internalFailure(error.localizedDescription)
            log.append(subsystem: "bridge", message: "Command rejected", metadata: ["requestId": requestId, "reason": shell.localizedDescription])
            return ["protocolVersion": 1, "requestId": requestId, "ok": false,
                    "error": ["code": shell.bridgeCode, "message": shell.localizedDescription, "retryable": shell.bridgeCode == "downloadFailure" || shell.bridgeCode == "storageFailure", "details": [:]]]
        }
    }

    private func execute(method: String, params: [String: Any]) async throws -> [String: Any] {
        switch method {
        case "bridge.hello":
            return [
                "shellVersion": "0.1.0", "protocolVersion": 1, "engineApiVersion": 1, "checkpointSchemaVersion": 1,
                "capabilities": phase1Capabilities + sensorCapabilities + (recording.available ? recordingCapabilities + archiveCapabilities + journalCapabilities : []),
                "unavailableCapabilities": recording.available ? [] : [
                    ["capability": "workout.recorder", "reason": "Recording engine or durable storage is unavailable"]
                ]
            ]
        case "bridge.ping":
            let received = ISOTime.now()
            return ["nonce": params["nonce"]!, "nativeReceivedAt": received, "nativeSentAt": ISOTime.now()]
        case "session.snapshot": return diagnostics.sessionSnapshot()
        case "permissions.status": return diagnostics.permissionStatus()
        case "permissions.request":
            sensors.requestPermission(params["permission"] as! String)
            let status = diagnostics.permissionStatus()
            emitEvent?("permissions.updated", status)
            return status
        case "bridge.snapshot":
            let sequence = diagnostics.eventSequence
            return ["sequence": sequence, "session": diagnostics.sessionSnapshot(), "permissions": diagnostics.permissionStatus(),
                    "location": sensors.locationStatus(), "heartRate": sensors.heartRateStatus(),
                    "diagnostics": diagnostics.snapshot(), "appBuild": builds.statusDictionary()]
        case "location.status": return sensors.locationStatus()
        case "location.start":
            return try sensors.startLocation(desiredAccuracy: params["desiredAccuracy"] as! String,
                                             distanceFilter: (params["distanceFilterM"] as! NSNumber).doubleValue,
                                             backgroundMode: params["backgroundMode"] as! String,
                                             duration: (params["maxDurationSeconds"] as! NSNumber).intValue)
        case "location.stop": return try sensors.stopLocation(id: params["probeId"] as! String)
        case "location.read":
            return try sensors.readLocations(id: params["probeId"] as! String,
                                             after: params["afterCursor"] is NSNull ? nil : (params["afterCursor"] as! NSNumber).intValue,
                                             limit: (params["limit"] as! NSNumber).intValue)
        case "heartRate.status": return sensors.heartRateStatus()
        case "heartRate.scan": return try sensors.startScan(duration: (params["durationSeconds"] as! NSNumber).intValue)
        case "heartRate.stopScan": return sensors.stopScan()
        case "heartRate.connect": return try sensors.connect(deviceId: params["deviceId"] as! String)
        case "heartRate.disconnect": return try sensors.disconnect(id: params["connectionId"] as! String)
        case "heartRate.read":
            return try sensors.readHeartRate(id: params["connectionId"] as! String,
                                             after: params["afterCursor"] is NSNull ? nil : (params["afterCursor"] as! NSNumber).intValue,
                                              limit: (params["limit"] as! NSNumber).intValue)
        case "workout.export":
            let export = try recording.export(sessionId: params["sessionId"] as! String, format: params["format"] as! String)
            return ["exportId": export.id, "presented": presentShare?(export.url) ?? false, "format": params["format"]!]
        case "observations.subscribe":
            return try recording.subscribe(sessionId: params["sessionId"] as! String,
                after: params["afterSequence"] is NSNull ? nil : (params["afterSequence"] as! NSNumber).intValue,
                limit: (params["maxBatchSize"] as! NSNumber).intValue)
        case "observations.unsubscribe": return try recording.unsubscribe(params["subscriptionId"] as! String)
        case "observations.read":
            return try recording.readObservations(sessionId: params["sessionId"] as! String,
                after: params["afterSequence"] is NSNull ? nil : (params["afterSequence"] as! NSNumber).intValue,
                limit: (params["limit"] as! NSNumber).intValue)
        case "archive.list":
            return try recording.listArchive(
                after: params["afterCursor"] is NSNull ? nil : params["afterCursor"] as? String,
                limit: (params["limit"] as! NSNumber).intValue)
        case "archive.detail":
            return try recording.archiveDetail(
                savedWorkoutId: params["savedWorkoutId"] as! String,
                after: params["afterSequence"] is NSNull ? nil : (params["afterSequence"] as! NSNumber).intValue,
                limit: (params["limit"] as! NSNumber).intValue)
        case "journal.read":
            return try recording.readJournal(
                sessionId: params["sessionId"] as! String,
                after: params["afterJournalSequence"] is NSNull ? nil : (params["afterJournalSequence"] as! NSNumber).intValue,
                limit: (params["limit"] as! NSNumber).intValue)
        case "diagnostics.snapshot": return diagnostics.snapshot()
        case "diagnostics.runChecks":
            let requested = params["checks"] is NSNull ? nil : params["checks"] as? [String]
            let value: [String: Any] = ["results": diagnostics.runChecks(requested: requested), "workoutStateUnchanged": true]
            emitEvent?("diagnostics.updated", diagnostics.snapshot())
            return value
        case "diagnostics.export":
            let export = try diagnostics.exportData(includeWorkoutObservations: params["includeWorkoutObservations"] as! Bool)
            return ["presented": presentShare?(export.url) ?? false, "exportId": export.id]
        case "appBuild.status": return builds.statusDictionary()
        case "appBuild.download":
            let summary = try await builds.download(manifestURL: URL(string: params["manifestUrl"] as! String)!)
            emitEvent?("appBuild.updated", builds.statusDictionary())
            return ["build": summary.dictionary, "activated": false]
        case "appBuild.activate":
            let summary = try builds.activate(buildId: params["buildId"] as! String)
            emitEvent?("appBuild.updated", builds.statusDictionary())
            return ["active": summary.dictionary, "reloadRequired": true]
        case "appBuild.rollback":
            let summary = try builds.rollback(target: params["target"] as! String)
            emitEvent?("appBuild.updated", builds.statusDictionary())
            return ["active": summary.dictionary, "reloadRequired": true]
        case "devSource.configure":
            let result = try builds.configureDevelopmentSource(params["url"] is NSNull ? nil : params["url"] as? String)
            Task { @MainActor in try? await Task.sleep(for: .milliseconds(150)); reloadUI?() }
            return result
        case "ui.reload":
            Task { @MainActor in try? await Task.sleep(for: .milliseconds(150)); reloadUI?() }
            return ["accepted": true]
        default: throw ShellError.unsupportedMethod
        }
    }

    private func isMutation(_ method: String) -> Bool {
        ["permissions.request", "location.start", "location.stop", "heartRate.scan", "heartRate.stopScan", "heartRate.connect", "heartRate.disconnect", "diagnostics.runChecks", "diagnostics.export", "appBuild.download", "appBuild.activate", "appBuild.rollback", "devSource.configure", "ui.reload"].contains(method)
    }

    private func synchronizeRecordingSensors(reply: [String: Any]) {
        guard let result = reply["result"] as? [String: Any] else { return }
        let session = result["session"] as? [String: Any] ?? result
        switch session["state"] as? String {
        case "recording", "paused":
            do { try sensors.startRecordingLocation() }
            catch { log.append(subsystem: "recording", message: "Workout persisted but continuous location could not start", metadata: ["reason": error.localizedDescription]) }
        case "finished": sensors.stopRecordingLocation()
        default: break
        }
    }
}
