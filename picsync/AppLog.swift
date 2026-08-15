import Foundation

enum AppLog {
    private static let lock = NSLock()
    private static let maximumBytes = 1_000_000

    static let fileURL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("picsync.log")

    static func write(_ message: String) {
        let timestamp = ISO8601DateFormatter().string(from: Date())
        let data = Data("\(timestamp) \(message)\n".utf8)

        lock.lock()
        defer { lock.unlock() }

        if (try? FileManager.default.attributesOfItem(atPath: fileURL.path)[.size] as? Int) ?? 0 > maximumBytes {
            try? FileManager.default.removeItem(at: fileURL)
        }
        if !FileManager.default.fileExists(atPath: fileURL.path) {
            FileManager.default.createFile(atPath: fileURL.path, contents: nil)
        }
        guard let handle = try? FileHandle(forWritingTo: fileURL) else { return }
        defer { try? handle.close() }
        do {
            try handle.seekToEnd()
            try handle.write(contentsOf: data)
        } catch {}

        #if DEBUG
        print(message)
        #endif
    }

    static func contents() -> String {
        lock.lock()
        defer { lock.unlock() }
        return (try? String(contentsOf: fileURL, encoding: .utf8)) ?? "No log entries yet."
    }

    static func clear() {
        lock.lock()
        defer { lock.unlock() }
        try? FileManager.default.removeItem(at: fileURL)
    }
}
