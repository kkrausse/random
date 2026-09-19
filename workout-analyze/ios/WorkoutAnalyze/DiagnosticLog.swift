import Foundation

struct LogEntry: Codable {
    let timestamp: String
    let subsystem: String
    let message: String
    let sessionId: String?
    let sequence: Int?
    let metadata: [String: String]
}

@MainActor
final class DiagnosticLog {
    private(set) var entries: [LogEntry] = []
    private let url: URL
    private let maximumEntries = 250
    private let maximumFileBytes = 512 * 1024

    init() {
        let support = try! FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        url = support.appendingPathComponent("diagnostic-log.json")
        if let data = try? Data(contentsOf: url), let decoded = try? JSONDecoder().decode([LogEntry].self, from: data) {
            entries = Array(decoded.suffix(maximumEntries))
        }
    }

    func append(subsystem: String, message: String, sessionId: String? = nil, sequence: Int? = nil, metadata: [String: String] = [:]) {
        let safeMetadata = metadata.mapValues(Self.redact)
        entries.append(LogEntry(timestamp: ISOTime.now(), subsystem: String(subsystem.prefix(64)), message: Self.redact(message), sessionId: sessionId, sequence: sequence, metadata: safeMetadata))
        entries = Array(entries.suffix(maximumEntries))
        persistBounded()
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
