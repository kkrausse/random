import Foundation

let protocolVersion = 1
let engineAPIVersion = 1
let checkpointSchemaVersion = 1
let maximumBridgeBytes = 256 * 1024

let phase1Capabilities = [
    "bridge.ping", "session.snapshot", "permissions.status",
    "diagnostics.snapshot", "diagnostics.runChecks", "diagnostics.export",
    "appBuild.status", "appBuild.download", "appBuild.activate",
    "appBuild.rollback", "devSource.configure", "ui.reload"
]
let sensorCapabilities = [
    "permissions.request", "bridge.snapshot",
    "location.status", "location.start", "location.stop", "location.read",
    "heartRate.status", "heartRate.scan", "heartRate.stopScan",
    "heartRate.connect", "heartRate.disconnect", "heartRate.read"
]
let recordingCapabilities = [
    "workout.start", "workout.pause", "workout.resume", "workout.finish", "workout.recover",
    "workout.export", "observations.subscribe", "observations.unsubscribe", "observations.read"
]
let archiveCapabilities = ["archive.list", "archive.detail"]
let journalCapabilities = ["journal.read"]
let databaseCapabilities = ["database.execute", "database.query", "database.queryNext", "database.bulkInsert", "database.begin", "database.commit", "database.rollback"]
let fileCapabilities = ["file.pickArchive", "file.downloadArchive", "file.download", "file.read", "file.close"]

struct BuildFile: Codable, Equatable {
    let path: String
    let role: String
    let sizeBytes: Int
    let sha256: String
}

struct VersionRange: Codable, Equatable {
    let min: Int
    let max: Int
}

struct BuildManifest: Codable, Equatable {
    let formatVersion: Int
    let buildId: String
    let createdAt: String
    let uiEntryPath: String
    let engineEntryPath: String
    let engineBuildId: String
    let bridgeProtocol: VersionRange
    let engineApi: VersionRange
    let checkpointSchemaVersion: Int
    let requiredCapabilities: [String]
    let files: [BuildFile]
}

struct BuildSummary: Codable, Equatable {
    let buildId: String
    let source: String
    let engineBuildId: String

    var dictionary: [String: Any] {
        ["buildId": buildId, "source": source, "engineBuildId": engineBuildId]
    }
}

enum ShellError: Error, LocalizedError {
    case invalidRequest(String)
    case unsupportedVersion
    case unsupportedMethod
    case invalidState(String)
    case permissionDenied(String)
    case sensorUnavailable(String)
    case storage(String)
    case incompatibleBuild(String)
    case download(String)
    case internalFailure(String)

    var errorDescription: String? {
        switch self {
        case .invalidRequest(let message), .invalidState(let message), .permissionDenied(let message), .sensorUnavailable(let message), .storage(let message),
             .incompatibleBuild(let message), .download(let message), .internalFailure(let message): message
        case .unsupportedVersion: "Unsupported protocol version"
        case .unsupportedMethod: "Unsupported bridge method"
        }
    }

    var bridgeCode: String {
        switch self {
        case .invalidRequest: "invalidRequest"
        case .unsupportedVersion: "unsupportedVersion"
        case .unsupportedMethod: "unsupportedMethod"
        case .invalidState: "invalidState"
        case .permissionDenied: "permissionDenied"
        case .sensorUnavailable: "sensorUnavailable"
        case .storage: "storageFailure"
        case .incompatibleBuild: "incompatibleBuild"
        case .download: "downloadFailure"
        case .internalFailure: "internalError"
        }
    }
}

enum ISOTime {
    static func now() -> String {
        ISO8601DateFormatter().string(from: Date())
    }
}
