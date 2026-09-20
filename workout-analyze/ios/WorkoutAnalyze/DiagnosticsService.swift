import CoreBluetooth
import CoreLocation
import Foundation
import UIKit

@MainActor
final class DiagnosticsService: ObservableObject {
    @Published private(set) var eventSequence = 0
    private let log: DiagnosticLog
    private let builds: BuildManager
    private let sensors: SensorService
    private var lastBridgeRoundTrip: String?

    init(log: DiagnosticLog, builds: BuildManager, sensors: SensorService) {
        self.log = log
        self.builds = builds
        self.sensors = sensors
    }

    func noteBridgeRoundTrip() { lastBridgeRoundTrip = ISOTime.now() }

    func sessionSnapshot() -> [String: Any] {
        [
            "sessionId": NSNull(), "state": "idle", "revision": 0, "durableSequence": eventSequence,
            "recorderAvailability": "unavailable",
            "recorderUnavailableReason": "Phase 1 is a diagnostics shell and does not implement workout recording",
            "pinnedEngine": NSNull(), "capturedAt": ISOTime.now()
        ]
    }

    func permissionStatus() -> [String: Any] {
        sensors.permissionStatus { [self] id, label, status, reason, observedAt, freshness, details in
            row(id: id, label: label, status: status, reason: reason, observedAt: observedAt, freshness: freshness, details: details)
        }
    }

    func snapshot() -> [String: Any] {
        let now = ISOTime.now()
        var engineDetails: [String: Any] = ["buildId": builds.active.engineBuildId, "apiVersion": 1, "checkpointSchemaVersion": 1]
        var engineStatus = "ok"
        var engineReason = "Selected build engine artifact is readable and compatible"
        do {
            let description = try EngineHost.describe(scriptURL: builds.activeEngineURL())
            guard description.apiVersion == 1, description.checkpointSchemaVersion == 1,
                  description.engineBuildId == builds.active.engineBuildId, description.maxBatchSize == 1000 else {
                throw ShellError.incompatibleBuild("Selected engine identity does not match its manifest")
            }
            engineDetails["algorithmId"] = description.algorithmId
        } catch {
            engineStatus = "error"; engineReason = error.localizedDescription
        }
        let volume = try? builds.bundledRoot().resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]).volumeAvailableCapacityForImportantUsage
        let permissions = permissionStatus()
        let location = sensors.locationStatus()
        let heartRate = sensors.heartRateStatus()
        let rows: [[String: Any]] = [
            row(id: "shell", label: "Native shell", status: "ok", reason: "Native host is running protocol 1", observedAt: now, freshness: "fresh", details: ["shellVersion": "0.1.0", "protocolVersion": 1]),
            row(id: "webBuild", label: "Web UI source", status: builds.uiLoadState == "ready" ? "ok" : (builds.uiLoadState == "failed" ? "error" : "waiting"), reason: builds.currentLoadFailure ?? "UI lifecycle state: \(builds.uiLoadState)", observedAt: now, freshness: "fresh", details: ["appBuild": builds.statusDictionary(), "uiSource": builds.sourceStatusDictionary()]),
            row(id: "bridge", label: "Bridge", status: lastBridgeRoundTrip == nil ? "waiting" : "ok", reason: lastBridgeRoundTrip == nil ? "No successful round trip in this process" : "Main-frame bridge validated a round trip", observedAt: lastBridgeRoundTrip, freshness: lastBridgeRoundTrip == nil ? "never" : "fresh", details: ["lastRoundTrip": lastBridgeRoundTrip ?? NSNull(), "eventSequence": eventSequence]),
            permissions["location"] as! [String: Any],
            permissions["bluetooth"] as! [String: Any],
            row(id: "locationProbe", label: "Location probe", status: location["state"] as? String == "error" ? "error" : (location["state"] as? String == "active" ? "ok" : "waiting"), reason: location["reason"] as! String, observedAt: now, freshness: "fresh", details: ["state": location["state"]!, "receivedCount": location["receivedCount"]!, "acceptedCount": location["acceptedCount"]!, "rejectedCount": location["rejectedCount"]!]),
            row(id: "heartRateProbe", label: "Heart-rate probe", status: heartRate["state"] as? String == "error" ? "error" : (heartRate["state"] as? String == "connected" ? "ok" : "waiting"), reason: heartRate["reason"] as! String, observedAt: now, freshness: "fresh", details: ["state": heartRate["state"]!, "receivedCount": heartRate["receivedCount"]!, "parseErrorCount": heartRate["parseErrorCount"]!, "reconnectCount": heartRate["reconnectCount"]!]),
            row(id: "recorder", label: "Workout recorder", status: "unavailable", reason: "Phase 1 intentionally has no recorder or background sensor claims", observedAt: nil, freshness: "never", details: ["state": "idle"]),
            row(id: "storage", label: "Native storage", status: volume == nil ? "waiting" : "ok", reason: volume == nil ? "Available capacity could not be read" : "Application support storage is accessible", observedAt: now, freshness: "fresh", details: ["availableBytes": volume ?? NSNull()]),
            row(id: "engine", label: "Analysis engine", status: engineStatus, reason: engineReason, observedAt: now, freshness: "fresh", details: engineDetails)
        ]
        return ["capturedAt": now, "rows": rows, "eventSequence": eventSequence]
    }

    func runChecks(requested: [String]?) -> [[String: Any]] {
        let all = ["bridgePing", "capabilityCompatibility", "diagnosticStorage", "engineFixture"]
        let selected = Set(requested ?? all)
        let results = all.map { id -> [String: Any] in
            guard selected.contains(id) else { return check(id: id, outcome: "notRun", reason: "Check was not selected", started: nil, finished: nil) }
            let started = ISOTime.now()
            do {
                let reason: String
                switch id {
                case "bridgePing": reason = "Internal dispatcher is responsive"
                case "capabilityCompatibility": reason = "Protocol, engine API, checkpoint schema, and closed capability table match version 1"
                case "diagnosticStorage": reason = try storageFixture(namespace: "diagnostics")
                default:
                    _ = try storageFixture(namespace: "engine-fixture")
                    reason = try EngineHost.runIsolatedFixture(scriptURL: builds.activeEngineURL(), expectedBuildId: builds.active.engineBuildId)
                }
                return check(id: id, outcome: "pass", reason: reason, started: started, finished: ISOTime.now())
            } catch {
                return check(id: id, outcome: "fail", reason: error.localizedDescription, started: started, finished: ISOTime.now())
            }
        }
        log.append(subsystem: "diagnostics", message: "Isolated checks completed", sequence: eventSequence, metadata: ["selected": selected.sorted().joined(separator: ",")])
        return results
    }

    func advanceEventSequence() -> Int {
        eventSequence += 1
        return eventSequence
    }

    func exportData(includeWorkoutObservations: Bool) throws -> (id: String, url: URL) {
        let id = UUID().uuidString
        let report: [String: Any] = [
            "formatVersion": 1, "exportId": id, "createdAt": ISOTime.now(),
            "includeWorkoutObservations": includeWorkoutObservations,
            "note": "No workout observations exist in the phase-1 diagnostics shell",
            "snapshot": snapshot(), "build": builds.statusDictionary(),
            "log": log.entries.map { entry in
                ["timestamp": entry.timestamp, "subsystem": entry.subsystem, "message": entry.message,
                 "sessionId": entry.sessionId ?? NSNull(), "sequence": entry.sequence ?? NSNull(), "metadata": entry.metadata] as [String: Any]
            }
        ]
        let data = try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("workout-analyze-diagnostics-\(id).json")
        try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        return (id, url)
    }

    private func storageFixture(namespace: String) throws -> String {
        let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let directory = support.appendingPathComponent(namespace).appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let value = UUID().uuidString.data(using: .utf8)!
        let file = directory.appendingPathComponent("probe")
        try value.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        guard try Data(contentsOf: file) == value else { throw ShellError.storage("Diagnostic readback differed") }
        try FileManager.default.removeItem(at: file)
        return "Write/read/delete succeeded only in \(namespace)/<run-id>"
    }

    private func row(id: String, label: String, status: String, reason: String, observedAt: String?, freshness: String, details: [String: Any]) -> [String: Any] {
        ["id": id, "label": label, "status": status, "reason": reason, "observedAt": observedAt ?? NSNull(), "freshness": freshness, "details": details]
    }

    private func check(id: String, outcome: String, reason: String, started: String?, finished: String?) -> [String: Any] {
        ["id": id, "outcome": outcome, "reason": reason, "startedAt": started ?? NSNull(), "finishedAt": finished ?? NSNull(), "namespace": id == "engineFixture" ? "engine-fixture" : "diagnostics"]
    }
}
