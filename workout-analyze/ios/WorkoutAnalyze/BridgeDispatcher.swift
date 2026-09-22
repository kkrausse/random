import Foundation
import CryptoKit
import UIKit
import UniformTypeIdentifiers

@MainActor
final class ArchiveFileService: NSObject, UIDocumentPickerDelegate {
    private final class OpenFile {
        var handle: FileHandle; let url: URL; let scoped: Bool; let removeOnClose: Bool; let size: Int
        let expectedSHA256: String?; var written: Int; var finalized: Bool
        init(handle: FileHandle, url: URL, scoped: Bool, removeOnClose: Bool, size: Int, expectedSHA256: String? = nil, written: Int? = nil, finalized: Bool = true) {
            self.handle = handle; self.url = url; self.scoped = scoped; self.removeOnClose = removeOnClose; self.size = size
            self.expectedSHA256 = expectedSHA256; self.written = written ?? size; self.finalized = finalized
        }
    }
    private var files: [String: OpenFile] = [:]
    private var pickerContinuation: CheckedContinuation<[String: Any], Error>?

    func pick() async throws -> [String: Any] {
        guard pickerContinuation == nil else { throw ShellError.invalidState("A Files picker is already open") }
        guard let controller = UIApplication.shared.topViewController else { throw ShellError.invalidState("The Files picker cannot be presented") }
        return try await withCheckedThrowingContinuation { continuation in
            pickerContinuation = continuation
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.zip, .data], asCopy: false)
            picker.allowsMultipleSelection = false
            picker.delegate = self
            controller.present(picker, animated: true)
        }
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let continuation = pickerContinuation else { return }
        pickerContinuation = nil
        do {
            guard let url = urls.first else { throw ShellError.invalidRequest("No archive was selected") }
            let scoped = url.startAccessingSecurityScopedResource()
            let values = try url.resourceValues(forKeys: [.fileSizeKey, .nameKey])
            let size = values.fileSize ?? 0
            guard (1...(128 * 1024 * 1024)).contains(size) else { if scoped { url.stopAccessingSecurityScopedResource() }; throw ShellError.invalidRequest("Archive must be between 1 byte and 128 MiB") }
            let handle = try FileHandle(forReadingFrom: url)
            let id = "file-\(UUID().uuidString.lowercased())"
            files[id] = OpenFile(handle: handle, url: url, scoped: scoped, removeOnClose: false, size: size)
            continuation.resume(returning: ["fileId": id, "name": values.name ?? url.lastPathComponent, "sizeBytes": size])
        } catch { continuation.resume(throwing: error) }
    }

    func create(name: String, size: Int, sha256: String) throws -> [String: Any] {
        let suffix = name.hasSuffix(".parquet") ? ".parquet" : ".bin"
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("workout-analyze-\(UUID().uuidString.lowercased())\(suffix)")
        guard FileManager.default.createFile(atPath: url.path, contents: nil) else { throw ShellError.storage("Native temporary file could not be created") }
        do {
            let id = "file-\(UUID().uuidString.lowercased())"
            files[id] = OpenFile(handle: try FileHandle(forWritingTo: url), url: url, scoped: false, removeOnClose: true, size: size, expectedSHA256: sha256, written: 0, finalized: false)
            return ["fileId": id, "name": name, "sizeBytes": size]
        } catch { try? FileManager.default.removeItem(at: url); throw error }
    }

    func write(id: String, offset: Int, dataBase64: String) throws -> [String: Any] {
        guard let file = files[id], !file.finalized else { throw ShellError.invalidState("Writable host file is closed, missing, or finalized") }
        guard offset == file.written, let data = Data(base64Encoded: dataBase64), !data.isEmpty, data.count <= 96 * 1024,
              file.written + data.count <= file.size else { throw ShellError.invalidRequest("Host file write offset or bytes are invalid") }
        try file.handle.write(contentsOf: data); file.written += data.count
        return ["nextOffset": file.written, "sizeBytes": file.size]
    }

    func finalize(id: String) throws -> [String: Any] {
        guard let file = files[id], !file.finalized, file.written == file.size, let expected = file.expectedSHA256 else { throw ShellError.invalidState("Host file is incomplete, missing, or already finalized") }
        try file.handle.synchronize(); try file.handle.close()
        let input = try FileHandle(forReadingFrom: file.url)
        var digest = SHA256()
        while true { let chunk = try input.read(upToCount: 1024 * 1024) ?? Data(); if chunk.isEmpty { break }; digest.update(data: chunk) }
        try input.close()
        let actual = digest.finalize().map { String(format: "%02x", $0) }.joined()
        guard actual == expected else { files.removeValue(forKey: id); try? FileManager.default.removeItem(at: file.url); throw ShellError.storage("Host file hash did not match its manifest") }
        file.handle = try FileHandle(forReadingFrom: file.url); file.finalized = true
        return ["finalized": true, "sizeBytes": file.size, "sha256": actual]
    }

    func databaseParameters(_ values: [Any]) throws -> [Any] {
        try values.map { value in
            guard let reference = value as? [String: Any], Set(reference.keys) == Set(["type", "id"]), reference["type"] as? String == "hostFile",
                  let id = reference["id"] as? String else { return value }
            guard let file = files[id] else { throw ShellError.invalidState("Database file handle is closed or missing") }
            guard file.finalized else { throw ShellError.invalidState("Database file handle is not finalized") }
            return file.url.path
        }
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pickerContinuation?.resume(throwing: ShellError.invalidState("Archive selection was cancelled"))
        pickerContinuation = nil
    }

    func read(id: String, offset: Int, length: Int) throws -> [String: Any] {
        guard let file = files[id] else { throw ShellError.invalidState("Archive file is closed or missing") }
        guard file.finalized else { throw ShellError.invalidState("Archive file is not finalized") }
        guard offset <= file.size else { throw ShellError.invalidRequest("Archive read offset exceeds file size") }
        try file.handle.seek(toOffset: UInt64(offset))
        let data = try file.handle.read(upToCount: min(length, file.size - offset)) ?? Data()
        let next = offset + data.count
        return ["dataBase64": data.base64EncodedString(), "offset": offset, "nextOffset": next, "sizeBytes": file.size, "done": next == file.size]
    }

    func close(id: String) throws {
        guard let file = files.removeValue(forKey: id) else { throw ShellError.invalidState("Archive file is closed or missing") }
        try file.handle.close()
        if file.scoped { file.url.stopAccessingSecurityScopedResource() }
        if file.removeOnClose { try? FileManager.default.removeItem(at: file.url) }
    }
}

@MainActor
final class BridgeDispatcher {
    let builds: BuildManager
    let diagnostics: DiagnosticsService
    let sensors: SensorService
    let recording: RecordingService
    let database: DuckDBService?
    let log: DiagnosticLog
    let archiveFiles = ArchiveFileService()
    var presentShare: ((URL) -> Bool)?
    var reloadUI: (() -> Void)?
    var emitEvent: ((String, [String: Any]) -> Void)?

    private var mutationCache: [String: (method: String, reply: [String: Any])] = [:]

    init(builds: BuildManager, diagnostics: DiagnosticsService, sensors: SensorService, recording: RecordingService, database: DuckDBService?, log: DiagnosticLog) {
        self.builds = builds; self.diagnostics = diagnostics; self.sensors = sensors; self.recording = recording; self.database = database; self.log = log
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
            var capabilities = phase1Capabilities + sensorCapabilities
            if recording.available { capabilities += recordingCapabilities + archiveCapabilities + journalCapabilities }
            if database != nil { capabilities += databaseCapabilities }
            capabilities += fileCapabilities
            var unavailable: [[String: String]] = []
            if !recording.available { unavailable.append(["capability": "workout.recorder", "reason": "Recording engine or durable storage is unavailable"]) }
            if database == nil { unavailable.append(["capability": "database.duckdb", "reason": "Native DuckDB could not open its durable store"]) }
            return [
                "shellVersion": "0.1.0", "protocolVersion": 1, "engineApiVersion": 1, "checkpointSchemaVersion": 1,
                "capabilities": capabilities, "unavailableCapabilities": unavailable
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
        case "database.execute":
            guard let database else { throw ShellError.invalidState("Native DuckDB is unavailable") }
            let parameters = try JSONSerialization.data(withJSONObject: archiveFiles.databaseParameters(params["parameters"] as! [Any]))
            try await database.executeBridge(sql: params["sql"] as! String, parametersJSON: parameters, transactionId: params["transactionId"] is NSNull ? nil : params["transactionId"] as? String)
            return ["completed": true]
        case "database.query":
            guard let database else { throw ShellError.invalidState("Native DuckDB is unavailable") }
            let parameters = try JSONSerialization.data(withJSONObject: archiveFiles.databaseParameters(params["parameters"] as! [Any]))
            return try Self.dictionary(await database.queryBridge(sql: params["sql"] as! String, parametersJSON: parameters, transactionId: params["transactionId"] is NSNull ? nil : params["transactionId"] as? String))
        case "database.queryNext":
            guard let database else { throw ShellError.invalidState("Native DuckDB is unavailable") }
            return try Self.dictionary(await database.nextResultBridge(params["resultId"] as! String))
        case "database.bulkInsert":
            guard let database else { throw ShellError.invalidState("Native DuckDB is unavailable") }
            let rows = params["rows"] as! [[Any]]
            let rowsJSON = try JSONSerialization.data(withJSONObject: rows)
            try await database.bulkInsertBridge(table: params["table"] as! String, columns: params["columns"] as! [String], rowsJSON: rowsJSON, transactionId: params["transactionId"] is NSNull ? nil : params["transactionId"] as? String)
            return ["inserted": rows.count]
        case "database.begin":
            guard let database else { throw ShellError.invalidState("Native DuckDB is unavailable") }
            return ["transactionId": try await database.begin()]
        case "database.commit":
            guard let database else { throw ShellError.invalidState("Native DuckDB is unavailable") }
            try await database.commit(params["transactionId"] as! String); return ["committed": true]
        case "database.rollback":
            guard let database else { throw ShellError.invalidState("Native DuckDB is unavailable") }
            try await database.rollback(params["transactionId"] as! String); return ["rolledBack": true]
        case "file.pickArchive": return try await archiveFiles.pick()
        case "file.create": return try archiveFiles.create(name: params["name"] as! String, size: (params["sizeBytes"] as! NSNumber).intValue, sha256: params["sha256"] as! String)
        case "file.write": return try archiveFiles.write(id: params["fileId"] as! String, offset: (params["offset"] as! NSNumber).intValue, dataBase64: params["dataBase64"] as! String)
        case "file.finalize": return try archiveFiles.finalize(id: params["fileId"] as! String)
        case "file.read":
            return try archiveFiles.read(id: params["fileId"] as! String, offset: (params["offset"] as! NSNumber).intValue, length: (params["length"] as! NSNumber).intValue)
        case "file.close":
            try archiveFiles.close(id: params["fileId"] as! String); return ["closed": true]
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
        ["permissions.request", "location.start", "location.stop", "heartRate.scan", "heartRate.stopScan", "heartRate.connect", "heartRate.disconnect", "diagnostics.runChecks", "diagnostics.export", "appBuild.download", "appBuild.activate", "appBuild.rollback", "devSource.configure", "ui.reload", "database.execute", "database.bulkInsert", "database.begin", "database.commit", "database.rollback", "file.pickArchive", "file.create", "file.write", "file.finalize", "file.close"].contains(method)
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

    private static func dictionary(_ data: Data) throws -> [String: Any] {
        guard let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw ShellError.internalFailure("Native database returned an invalid page") }
        return value
    }
}
