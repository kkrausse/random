import Foundation
import DuckDB

/// Owns the durable analytical database and all connection-scoped transactions.
/// Domain schemas and SQL deliberately remain in the shared web application.
actor DuckDBService {
    private struct TransactionSession {
        let connection: Connection
        var touchedAt: Foundation.Date
    }
    private struct ResultCursor {
        var rows: [[String: Any]]
        var offset: Int
        var touchedAt: Foundation.Date
    }

    private let database: Database
    private var transactions: [String: TransactionSession] = [:]
    private var results: [String: ResultCursor] = [:]
    private let pageSize = 200
    private let expiry: TimeInterval = 60

    init(url: URL? = nil) throws {
        if let url {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            database = try Database(store: .file(at: url))
        } else {
            database = try Database(store: .inMemory)
        }
    }

    static func applicationDatabase() throws -> DuckDBService {
        let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let directory = support.appendingPathComponent("WorkoutAnalyze", isDirectory: true)
        let original = directory.appendingPathComponent("analysis.duckdb")
        do {
            return try DuckDBService(url: original)
        } catch {
            // Earlier browser-hosted analysis wrote this file with a newer DuckDB
            // storage format. Keep it intact for export/recovery and open a separate
            // native-compatible store rather than replacing the user's archive.
            guard FileManager.default.fileExists(atPath: original.path) else { throw error }
            return try DuckDBService(url: directory.appendingPathComponent("analysis-native.duckdb"))
        }
    }

    func begin() throws -> String {
        try expireAbandonedWork()
        let id = "dbtx-\(UUID().uuidString.lowercased())"
        let connection = try database.connect()
        try connection.execute("BEGIN TRANSACTION")
        transactions[id] = TransactionSession(connection: connection, touchedAt: Foundation.Date())
        return id
    }

    func commit(_ id: String) throws {
        try expireAbandonedWork(except: id)
        guard let session = transactions.removeValue(forKey: id) else { throw ShellError.invalidState("Database transaction is missing or expired") }
        try session.connection.execute("COMMIT")
    }

    func rollback(_ id: String) throws {
        guard let session = transactions.removeValue(forKey: id) else { throw ShellError.invalidState("Database transaction is missing or expired") }
        try session.connection.execute("ROLLBACK")
    }

    func rollbackAll() {
        for session in transactions.values { try? session.connection.execute("ROLLBACK") }
        transactions.removeAll()
        results.removeAll()
    }

    func execute(sql: String, parameters: [Any], transactionId: String?) throws {
        let connection = try connection(transactionId)
        if parameters.isEmpty {
            try connection.execute(sql)
            return
        }
        _ = try prepared(connection: connection, sql: sql, parameters: parameters).execute()
    }

    func executeBridge(sql: String, parametersJSON: Data, transactionId: String?) throws {
        try execute(sql: sql, parameters: try Self.array(parametersJSON), transactionId: transactionId)
    }

    func query(sql: String, parameters: [Any], transactionId: String?) throws -> [String: Any] {
        let connection = try connection(transactionId)
        let result = try prepared(connection: connection, sql: sql, parameters: parameters).execute()
        return page(rows: try rows(result))
    }

    func queryBridge(sql: String, parametersJSON: Data, transactionId: String?) throws -> Data {
        try Self.json(query(sql: sql, parameters: try Self.array(parametersJSON), transactionId: transactionId))
    }

    func nextResult(_ id: String) throws -> [String: Any] {
        try expireAbandonedWork()
        guard var cursor = results.removeValue(forKey: id) else { throw ShellError.invalidState("Database result cursor is missing or expired") }
        let end = min(cursor.offset + pageSize, cursor.rows.count)
        let items = Array(cursor.rows[cursor.offset..<end])
        cursor.offset = end
        cursor.touchedAt = Foundation.Date()
        let hasMore = end < cursor.rows.count
        if hasMore { results[id] = cursor }
        return ["rows": items, "resultId": hasMore ? id : NSNull(), "hasMore": hasMore]
    }

    func nextResultBridge(_ id: String) throws -> Data { try Self.json(nextResult(id)) }

    func bulkInsert(table: String, columns: [String], rows: [[Any]], transactionId: String?) throws {
        guard Self.identifier(table), !columns.isEmpty, columns.allSatisfy(Self.identifier) else { throw ShellError.invalidRequest("Invalid database identifier") }
        guard rows.allSatisfy({ $0.count == columns.count }) else { throw ShellError.invalidRequest("Invalid bulk row width") }
        if rows.isEmpty { return }
        let connection = try connection(transactionId)
        let info = try connection.query("SELECT name FROM pragma_table_info('\(table)') ORDER BY cid")
        let names = info[0].cast(to: String.self).compactMap { $0 }
        guard names == columns else { throw ShellError.invalidRequest("Bulk insert columns must match \(table) table order") }
        let placeholders = Array(repeating: "?", count: columns.count).joined(separator: ",")
        let statement = try PreparedStatement(connection: connection, query: "INSERT INTO \(table) VALUES (\(placeholders))")
        for row in rows {
            for (offset, value) in row.enumerated() { try bind(value, to: statement, at: offset + 1) }
            _ = try statement.execute()
        }
    }

    func bulkInsertBridge(table: String, columns: [String], rowsJSON: Data, transactionId: String?) throws {
        guard let rows = try JSONSerialization.jsonObject(with: rowsJSON) as? [[Any]] else { throw ShellError.invalidRequest("Invalid database bulk rows") }
        try bulkInsert(table: table, columns: columns, rows: rows, transactionId: transactionId)
    }

    private func connection(_ transactionId: String?) throws -> Connection {
        try expireAbandonedWork(except: transactionId)
        guard let transactionId else { return try database.connect() }
        guard var session = transactions[transactionId] else { throw ShellError.invalidState("Database transaction is missing or expired") }
        session.touchedAt = Date(); transactions[transactionId] = session
        return session.connection
    }

    private func prepared(connection: Connection, sql: String, parameters: [Any]) throws -> PreparedStatement {
        let statement = try PreparedStatement(connection: connection, query: sql)
        guard statement.parameterCount == parameters.count else { throw ShellError.invalidRequest("Database parameter count does not match SQL") }
        for (offset, value) in parameters.enumerated() { try bind(value, to: statement, at: offset + 1) }
        return statement
    }

    private func bind(_ raw: Any, to statement: PreparedStatement, at index: Int) throws {
        if raw is NSNull { try statement.bind(Optional<String>.none, at: index); return }
        if let object = raw as? [String: Any] {
            if object.keys.sorted() == ["$databaseBigInt"], let text = object["$databaseBigInt"] as? String, let value = Int64(text) { try statement.bind(value, at: index); return }
            if object["type"] as? String == "timestamp", object.keys.sorted() == ["type", "value"], let text = object["value"] as? String, Self.isoDate(text) != nil { try statement.bind(text, at: index); return }
            throw ShellError.invalidRequest("Unsupported database value object")
        }
        if let value = raw as? Bool { try statement.bind(value, at: index); return }
        if let value = raw as? NSNumber {
            if CFNumberIsFloatType(value) { try statement.bind(value.doubleValue, at: index) }
            else { try statement.bind(value.int64Value, at: index) }
            return
        }
        if let value = raw as? String { try statement.bind(value, at: index); return }
        throw ShellError.invalidRequest("Unsupported database parameter type")
    }

    private func rows(_ result: ResultSet) throws -> [[String: Any]] {
        var output = Array(repeating: [String: Any](), count: Int(result.rowCount))
        for columnIndex in 0..<result.columnCount {
            let column = result[columnIndex]
            let name = column.name
            for rowIndex in 0..<result.rowCount { output[Int(rowIndex)][name] = try wireValue(column: column, row: rowIndex) }
        }
        return output
    }

    private func wireValue(column: Column<Void>, row: DBInt) throws -> Any {
        if column[row] == nil { return NSNull() }
        switch column.underlyingDatabaseType {
        case .boolean: return column.cast(to: Bool.self)[row]!
        case .tinyint: return Int(column.cast(to: Int8.self)[row]!)
        case .smallint: return Int(column.cast(to: Int16.self)[row]!)
        case .integer: return Int(column.cast(to: Int32.self)[row]!)
        case .bigint: return Self.integerWire(column.cast(to: Int64.self)[row]!)
        case .utinyint: return Int(column.cast(to: UInt8.self)[row]!)
        case .usmallint: return Int(column.cast(to: UInt16.self)[row]!)
        case .uinteger: return Self.unsignedIntegerWire(UInt64(column.cast(to: UInt32.self)[row]!))
        case .ubigint: return Self.unsignedIntegerWire(column.cast(to: UInt64.self)[row]!)
        case .float: return Double(column.cast(to: Float.self)[row]!)
        case .double: return column.cast(to: Double.self)[row]!
        case .varchar: return column.cast(to: String.self)[row]!
        case .blob: return ["$databaseBlob": column.cast(to: Data.self)[row]!.base64EncodedString()]
        case .decimal: return NSDecimalNumber(decimal: column.cast(to: Decimal.self)[row]!).stringValue
        case .timestamp, .timestampTz, .timestampS, .timestampMS, .timestampNS:
            let timestamp = column.cast(to: Timestamp.self)[row]!
            return Self.isoString(Foundation.Date(timeIntervalSince1970: Double(timestamp.microseconds) / 1_000_000))
        case .uuid: return column.cast(to: UUID.self)[row]!.uuidString.lowercased()
        default: throw ShellError.internalFailure("Unsupported DuckDB result type: \(column.underlyingDatabaseType)")
        }
    }

    private func page(rows: [[String: Any]]) -> [String: Any] {
        guard rows.count > pageSize else { return ["rows": rows, "resultId": NSNull(), "hasMore": false] }
        let id = "dbresult-\(UUID().uuidString.lowercased())"
        results[id] = ResultCursor(rows: rows, offset: pageSize, touchedAt: Foundation.Date())
        return ["rows": Array(rows.prefix(pageSize)), "resultId": id, "hasMore": true]
    }

    private func expireAbandonedWork(except id: String? = nil) throws {
        let cutoff = Foundation.Date().addingTimeInterval(-expiry)
        for key in transactions.keys.filter({ $0 != id && transactions[$0]!.touchedAt < cutoff }) {
            if let session = transactions.removeValue(forKey: key) { try? session.connection.execute("ROLLBACK") }
        }
        results = results.filter { $0.value.touchedAt >= cutoff }
    }

    private static func identifier(_ value: String) -> Bool { value.range(of: "^[A-Za-z_][A-Za-z0-9_]*$", options: .regularExpression) != nil }
    private static func integerWire(_ value: Int64) -> Any { abs(Double(value)) <= 9_007_199_254_740_991 ? NSNumber(value: value) : ["$databaseBigInt": String(value)] }
    private static func unsignedIntegerWire(_ value: UInt64) -> Any { value <= 9_007_199_254_740_991 ? NSNumber(value: value) : ["$databaseBigInt": String(value)] }
    private static func isoDate(_ value: String) -> Foundation.Date? { formatter().date(from: value) }
    private static func isoString(_ value: Foundation.Date) -> String { formatter().string(from: value) }
    private static func formatter() -> ISO8601DateFormatter {
        let value = ISO8601DateFormatter()
        value.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return value
    }
    private static func array(_ data: Data) throws -> [Any] {
        guard let value = try JSONSerialization.jsonObject(with: data) as? [Any] else { throw ShellError.invalidRequest("Invalid database parameters") }
        return value
    }
    private static func json(_ value: Any) throws -> Data { try JSONSerialization.data(withJSONObject: value) }
}
