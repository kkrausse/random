import Foundation
import SQLite3

/// Owned by SyncStore's actor. Statements never escape a synchronous operation.
final class SQLiteDatabase {
    enum Value {
        case text(String), integer(Int64), blob(Data)
    }
    private var handle: OpaquePointer?
    private let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

    init(url: URL) throws {
        guard sqlite3_open_v2(url.path, &handle, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK else {
            let error = failure()
            sqlite3_close(handle)
            handle = nil
            throw error
        }
        sqlite3_busy_timeout(handle, 5_000)
        try execute("PRAGMA journal_mode=WAL")
        try execute("PRAGMA synchronous=FULL")
        try execute("PRAGMA foreign_keys=ON")
    }

    deinit { sqlite3_close(handle) }

    func execute(_ sql: String, _ values: [Value] = []) throws {
        let _: [Int] = try query(sql, values) { _ in 0 }
    }

    func query<T>(_ sql: String, _ values: [Value] = [], map: (OpaquePointer) throws -> T) throws -> [T] {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &statement, nil) == SQLITE_OK, let statement else { throw failure() }
        defer { sqlite3_finalize(statement) }
        for (offset, value) in values.enumerated() {
            let index = Int32(offset + 1)
            let result: Int32
            switch value {
            case .text(let string): result = sqlite3_bind_text(statement, index, string, -1, transient)
            case .integer(let number): result = sqlite3_bind_int64(statement, index, number)
            case .blob(let data):
                result = data.withUnsafeBytes { sqlite3_bind_blob(statement, index, $0.baseAddress, Int32($0.count), transient) }
            }
            guard result == SQLITE_OK else { throw failure() }
        }
        var rows = [T]()
        while true {
            switch sqlite3_step(statement) {
            case SQLITE_ROW: rows.append(try map(statement))
            case SQLITE_DONE: return rows
            default: throw failure()
            }
        }
    }

    func transaction<T>(_ operation: () throws -> T) throws -> T {
        try execute("BEGIN IMMEDIATE")
        do {
            let result = try operation()
            try execute("COMMIT")
            return result
        } catch {
            try? execute("ROLLBACK")
            throw error
        }
    }

    static func decode<T: Decodable>(_ type: T.Type, from statement: OpaquePointer, column: Int32 = 0) throws -> T {
        let count = Int(sqlite3_column_bytes(statement, column))
        guard let bytes = sqlite3_column_blob(statement, column) else { throw CocoaError(.fileReadCorruptFile) }
        return try JSONDecoder().decode(type, from: Data(bytes: bytes, count: count))
    }

    private func failure() -> NSError {
        NSError(domain: "PicSync.SQLite", code: Int(sqlite3_errcode(handle)), userInfo: [NSLocalizedDescriptionKey: "Local sync database: \(String(cString: sqlite3_errmsg(handle)))"])
    }
}
