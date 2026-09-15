import Foundation
import Network
import SMBClient

enum TransferError: LocalizedError {
    case paused, stagingLimit, lowSpace, contentMismatch(String)
    var errorDescription: String? {
        switch self {
        case .paused: "Transfer paused. Resume to continue."
        case .stagingLimit: "The staging budget is full. Free space by finishing or deleting paused runs, or increase the staging limit in Transfer Settings."
        case .lowSpace: "PicSync paused to preserve 2 GB of free space on this iPhone. Free up storage before resuming."
        case .contentMismatch(let path): "Content verification failed for \(path). The existing file was preserved."
        }
    }
}

/// Shared with synchronous PhotoKit/SMB callbacks; never writes progress to the journal.
final class TransferRuntime: @unchecked Sendable {
    struct Item: Identifiable, Sendable {
        let id: UUID
        var filename: String
        var phase: String
        var bytes: Int64 = 0
        var total: Int64 = 0
    }
    struct Snapshot: Sendable {
        var items: [Item]
        var bytesPerSecond: Double
    }
    private let lock = NSLock()
    private var paused = false
    private var items = [UUID: Item]()
    private var sent: Int64 = 0
    private var sampledBytes: Int64 = 0
    private var sampledAt = Date()
    private var speed = 0.0
    private var pauseHandlers = [UUID: @Sendable () -> Void]()

    func pause() {
        let handlers = lock.withLock {
            paused = true
            let handlers = Array(pauseHandlers.values)
            pauseHandlers.removeAll()
            return handlers
        }
        handlers.forEach { $0() }
    }
    func onPause(_ handler: @escaping @Sendable () -> Void) -> UUID {
        let id = UUID()
        let invoke = lock.withLock {
            if paused { return true }
            pauseHandlers[id] = handler
            return false
        }
        if invoke { handler() }
        return id
    }
    func removePauseHandler(_ id: UUID) { _ = lock.withLock { pauseHandlers.removeValue(forKey: id) } }
    func check() throws { if lock.withLock({ paused }) || Task.isCancelled { throw TransferError.paused } }
    func update(_ id: UUID, filename: String, phase: String, bytes: Int64 = 0, total: Int64 = 0) {
        lock.withLock {
            if phase == "Uploading", let previous = items[id], previous.phase == phase, previous.filename == filename {
                sent += max(0, bytes - previous.bytes)
            }
            items[id] = Item(id: id, filename: filename, phase: phase, bytes: bytes, total: total)
        }
    }
    func remove(_ id: UUID) { _ = lock.withLock { items.removeValue(forKey: id) } }
    func snapshot() -> Snapshot {
        lock.withLock {
            let now = Date(), seconds = now.timeIntervalSince(sampledAt)
            if seconds >= 0.5 {
                speed = Double(sent - sampledBytes) / seconds
                sampledBytes = sent
                sampledAt = now
            }
            return Snapshot(items: items.values.sorted { $0.id.uuidString < $1.id.uuidString }, bytesPerSecond: speed)
        }
    }
}

/// Counts actual staged bytes, including failed runs; reservations occur before every write.
final class StagingBudget: @unchecked Sendable {
    static let reserveBytes: Int64 = 2 * 1_024 * 1_024 * 1_024
    private let lock = NSCondition()
    let root: URL
    let limit: Int64
    private var used: Int64
    private let available: @Sendable () throws -> Int64
    private var draining = Set<UUID>()

    init(root: URL, limit: Int64, available: (@Sendable () throws -> Int64)? = nil) throws {
        self.root = root
        self.limit = limit
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var excluded = root
        try excluded.setResourceValues(values)
        used = Self.byteCount(root)
        self.available = available ?? {
            let attributes = try FileManager.default.attributesOfFileSystem(forPath: root.path)
            return (attributes[.systemFreeSize] as? NSNumber)?.int64Value ?? 0
        }
    }

    func beginDraining(_ id: UUID) { _ = lock.withLock { draining.insert(id) } }
    func endDraining(_ id: UUID) { lock.withLock { draining.remove(id); lock.broadcast() } }

    func reserve(_ bytes: Int64, runtime: TransferRuntime? = nil) throws {
        try lock.withLock {
            guard bytes >= 0, bytes <= limit else { throw TransferError.stagingLimit }
            while true {
                try runtime?.check()
                let capacityOK = used <= limit - bytes
                let freeOK = try available() - bytes >= Self.reserveBytes
                if capacityOK && freeOK { break }
                // One exporter runs at a time. Existing uploads can drain while it waits.
                // If nothing can free space, pause instead of waiting forever.
                guard runtime != nil, !draining.isEmpty else { throw capacityOK ? TransferError.lowSpace : TransferError.stagingLimit }
                _ = lock.wait(until: Date().addingTimeInterval(0.25))
            }
            used += bytes
        }
    }
    func release(_ bytes: Int64) { lock.withLock { used = max(0, used - bytes); lock.broadcast() } }
    func remove(_ directory: URL) throws {
        try lock.withLock {
            guard FileManager.default.fileExists(atPath: directory.path) else { return }
            let bytes = Self.byteCount(directory)
            try FileManager.default.removeItem(at: directory)
            used = max(0, used - bytes)
            lock.broadcast()
        }
    }
    private static func byteCount(_ root: URL) -> Int64 {
        let files = FileManager.default.enumerator(at: root, includingPropertiesForKeys: [.fileSizeKey, .isRegularFileKey])
        var bytes: Int64 = 0
        while let url = files?.nextObject() as? URL {
            if let values = try? url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey]), values.isRegularFile == true {
                bytes += Int64(values.fileSize ?? 0)
            }
        }
        return bytes
    }
}

enum TransferFailurePolicy {
    static func isDestinationWide(_ error: Error) -> Bool {
        if let error = error as? ErrorResponse {
            // Disk/quota full, access denied, invalid credentials, missing/disconnected share.
            return [0xC000007F, 0xC0000044, 0xC0000022, 0xC000006D, 0xC000006A, 0xC00000CC, 0xC00000C9].contains(error.header.status)
        }
        return error is TransferError || (error as NSError).domain == "PicSync.SQLite" || (error as NSError).code == NSFileWriteOutOfSpaceError
    }
    static func isTransient(_ error: Error) -> Bool {
        if error is ConnectionError || error is NWError { return true }
        let ns = error as NSError
        if [NSURLErrorDomain, NSPOSIXErrorDomain, "NWError"].contains(ns.domain) { return true }
        if let error = error as? ErrorResponse {
            return [0xC00000B5, 0xC000020C, 0xC000020D, 0xC00000C4, 0xC00000C9].contains(error.header.status)
        }
        return false
    }
}
