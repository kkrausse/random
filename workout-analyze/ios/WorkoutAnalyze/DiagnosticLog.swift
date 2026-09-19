import Foundation
import OSLog

struct LogEntry: Codable {
    let timestamp: String
    let subsystem: String
    let message: String
    let sessionId: String?
    let sequence: Int?
    let metadata: [String: String]
}

private struct UploadEvent: Codable {
    let id: String
    let timestamp: String
    let subsystem: String
    let level: String
    let message: String
    let metadata: [String: String]?
}

private struct UploadEnvelope: Codable {
    let formatVersion: Int
    let uploadId: String
    let events: [UploadEvent]
}

private struct UploadResponse: Decodable {
    let accepted: Bool
    let uploadId: String
}

@MainActor
final class DiagnosticLog {
    private static let systemLog = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.kkrausse.workoutanalyze", category: "native-diagnostics")
    private(set) var entries: [LogEntry] = []
    private let url: URL
    private let maximumEntries = 250
    private let maximumFileBytes = 512 * 1024
    private var uploadURL: URL?
    private var uploadQueue: [UploadEvent] = []
    private var uploadTask: Task<Void, Never>?
    private var uploadBackoffSeconds = 1

    init() {
        let support = try! FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        url = support.appendingPathComponent("diagnostic-log.json")
        if let data = try? Data(contentsOf: url), let decoded = try? JSONDecoder().decode([LogEntry].self, from: data) {
            entries = Array(decoded.suffix(maximumEntries))
        }
    }

    func append(subsystem: String, message: String, sessionId: String? = nil, sequence: Int? = nil, metadata: [String: String] = [:]) {
        let safeMetadata = metadata.mapValues(Self.redact)
        let safeMessage = Self.redact(message)
        entries.append(LogEntry(timestamp: ISOTime.now(), subsystem: String(subsystem.prefix(64)), message: safeMessage, sessionId: sessionId, sequence: sequence, metadata: safeMetadata))
        Self.systemLog.notice("[\(subsystem, privacy: .public)] \(safeMessage, privacy: .public) \(String(describing: safeMetadata), privacy: .public)")
        enqueueUpload(timestamp: entries.last!.timestamp, subsystem: subsystem, message: safeMessage, metadata: safeMetadata)
        entries = Array(entries.suffix(maximumEntries))
        persistBounded()
    }

    func configureDevelopmentUpload(origin: URL?) {
        uploadTask?.cancel()
        uploadTask = nil
        uploadURL = origin?.appendingPathComponent("__workout/diagnostics")
        uploadBackoffSeconds = 1
        guard uploadURL != nil else { uploadQueue.removeAll(); return }
        uploadQueue = entries.suffix(32).map {
            UploadEvent(id: UUID().uuidString, timestamp: $0.timestamp, subsystem: $0.subsystem, level: Self.level(for: $0.message), message: $0.message, metadata: $0.metadata.isEmpty ? nil : $0.metadata)
        }
        scheduleUpload(after: .seconds(1))
    }

    private func enqueueUpload(timestamp: String, subsystem: String, message: String, metadata: [String: String]) {
        guard uploadURL != nil else { return }
        uploadQueue.append(UploadEvent(id: UUID().uuidString, timestamp: timestamp, subsystem: String(subsystem.prefix(64)), level: Self.level(for: message), message: message, metadata: metadata.isEmpty ? nil : metadata))
        uploadQueue = Array(uploadQueue.suffix(256))
        scheduleUpload(after: .seconds(1))
    }

    private func scheduleUpload(after delay: Duration) {
        guard uploadTask == nil, uploadURL != nil, !uploadQueue.isEmpty else { return }
        uploadTask = Task { [weak self] in
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled, let self else { return }
            await self.flushUpload()
        }
    }

    private func flushUpload() async {
        uploadTask = nil
        guard let uploadURL, !uploadQueue.isEmpty else { return }
        let uploadId = UUID().uuidString
        var count = min(64, uploadQueue.count)
        var body = Data()
        while count > 0 {
            guard let encoded = try? JSONEncoder().encode(UploadEnvelope(formatVersion: 1, uploadId: uploadId, events: Array(uploadQueue.prefix(count)))) else { return }
            if encoded.count <= 128 * 1024 { body = encoded; break }
            count -= 1
        }
        guard count > 0 else { uploadQueue.removeFirst(); scheduleUpload(after: .seconds(1)); return }
        var request = URLRequest(url: uploadURL, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 10)
        request.httpMethod = "POST"
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200,
                  let reply = try? JSONDecoder().decode(UploadResponse.self, from: data),
                  reply.accepted, reply.uploadId == uploadId else { throw URLError(.badServerResponse) }
            uploadQueue.removeFirst(min(count, uploadQueue.count))
            uploadBackoffSeconds = 1
        } catch {
            uploadBackoffSeconds = min(uploadBackoffSeconds * 2, 30)
        }
        scheduleUpload(after: .seconds(uploadQueue.isEmpty ? 1 : uploadBackoffSeconds))
    }

    private static func level(for message: String) -> String {
        let lower = message.lowercased()
        if lower.contains("failed") || lower.contains("failure") { return "error" }
        if lower.contains("warning") { return "warning" }
        return "info"
    }

    private func persistBounded() {
        while !entries.isEmpty {
            guard let data = try? JSONEncoder().encode(entries) else { return }
            if data.count <= maximumFileBytes {
                try? data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
                return
            }
            entries.removeFirst()
        }
    }

    static func redact(_ value: String) -> String {
        var result = value
        if let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) {
            let range = NSRange(result.startIndex..., in: result)
            for match in detector.matches(in: result, range: range).reversed() {
                guard let swiftRange = Range(match.range, in: result), var components = match.url.flatMap({ URLComponents(url: $0, resolvingAgainstBaseURL: false) }) else { continue }
                components.user = nil; components.password = nil; components.query = nil; components.fragment = nil
                result.replaceSubrange(swiftRange, with: components.string ?? "[redacted-url]")
            }
        }
        let patterns = ["(?i)(token|password|secret|authorization)=([^&\\s]+)", "(?i)bearer\\s+[A-Za-z0-9._~+/-]+"]
        for pattern in patterns {
            guard let regex = try? NSRegularExpression(pattern: pattern) else { continue }
            let range = NSRange(result.startIndex..., in: result)
            result = regex.stringByReplacingMatches(in: result, range: range, withTemplate: "[redacted]")
        }
        return String(result.prefix(4096))
    }
}
