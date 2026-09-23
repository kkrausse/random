import XCTest
@testable import WorkoutAnalyze

final class DuckDBServiceTests: XCTestCase {
    func testStrandedWALIsNotOpenedAsANewDatabase() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("duckdb-recovery-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let wal = directory.appendingPathComponent("analysis.duckdb.wal")
        let bytes = Data(repeating: 0xAB, count: 128)
        try bytes.write(to: wal)
        let service = try DuckDBService.applicationDatabase(in: directory)
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.appendingPathComponent("analysis.duckdb").path))
        XCTAssertEqual(try Data(contentsOf: wal), bytes)
        let result = try object(await service.queryBridge(sql: "SELECT 1 AS answer", parametersJSON: json([]), transactionId: nil))
        XCTAssertEqual((result["rows"] as? [[String: Any]])?.first?["answer"] as? Int, 1)
    }

    func testFailedStoresAndWALsStayIntactAndRecoveryCanQuery() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("duckdb-recovery-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let preserved = ["analysis.duckdb", "analysis.duckdb.wal", "analysis-native.duckdb", "analysis-native.duckdb.wal", "recording-v1.sqlite", "recording-v1.sqlite-wal"]
        for (index, name) in preserved.enumerated() {
            try Data(repeating: UInt8(index + 1), count: 128).write(to: directory.appendingPathComponent(name))
        }
        var attempts: [(String, String, String?)] = []
        let service = try DuckDBService.applicationDatabase(in: directory) { attempts.append(($0, $1, $2)) }
        XCTAssertEqual(attempts.map(\.0), ["failed", "failed", "selected"])
        XCTAssertEqual(attempts.prefix(2).map(\.1), ["analysis.duckdb", "analysis-native.duckdb"])
        XCTAssertTrue(attempts.prefix(2).allSatisfy { $0.2 != nil })
        let selected = try XCTUnwrap(attempts.last?.1)
        XCTAssertTrue(selected.hasPrefix("analysis-recovery-"))
        let result = try object(await service.queryBridge(sql: "SELECT 42 AS answer", parametersJSON: json([]), transactionId: nil))
        XCTAssertEqual((result["rows"] as? [[String: Any]])?.first?["answer"] as? Int, 42)
        for (index, name) in preserved.enumerated() {
            XCTAssertEqual(try Data(contentsOf: directory.appendingPathComponent(name)), Data(repeating: UInt8(index + 1), count: 128), name)
        }
    }

    func testExistingRecoveryStoreIsReusedAfterBothOriginalStoresFail() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("duckdb-recovery-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        try Data(repeating: 0xFF, count: 128).write(to: directory.appendingPathComponent("analysis.duckdb"))
        try Data(repeating: 0xEE, count: 128).write(to: directory.appendingPathComponent("analysis-native.duckdb"))
        let recovery = "analysis-recovery-2026-09-23T12-00-00Z-\(UUID().uuidString).duckdb"
        do {
            let first = try DuckDBService(url: directory.appendingPathComponent(recovery))
            try await first.executeBridge(sql: "CREATE TABLE retained(value INTEGER); INSERT INTO retained VALUES (17)", parametersJSON: json([]), transactionId: nil)
        }
        var attempts: [(String, String)] = []
        let reopened = try DuckDBService.applicationDatabase(in: directory) { outcome, filename, _ in attempts.append((outcome, filename)) }
        XCTAssertEqual(attempts.map(\.0), ["failed", "failed", "selected"])
        XCTAssertEqual(attempts.last?.1, recovery)
        let result = try object(await reopened.queryBridge(sql: "SELECT value FROM retained", parametersJSON: json([]), transactionId: nil))
        XCTAssertEqual((result["rows"] as? [[String: Any]])?.first?["value"] as? Int, 17)
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: directory.path).filter { $0.hasPrefix("analysis-recovery-") }.count, 1)
    }

    func testMissingEarlierStoresDoNotHideAnExistingRecovery() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("duckdb-recovery-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let recovery = "analysis-recovery-2026-09-23T12-00-00Z-\(UUID().uuidString).duckdb"
        do {
            let first = try DuckDBService(url: directory.appendingPathComponent(recovery))
            try await first.executeBridge(sql: "CREATE TABLE retained(value INTEGER); INSERT INTO retained VALUES (19)", parametersJSON: json([]), transactionId: nil)
        }
        var selected: String?
        let reopened = try DuckDBService.applicationDatabase(in: directory) { outcome, filename, _ in
            if outcome == "selected" { selected = filename }
        }
        XCTAssertEqual(selected, recovery)
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.appendingPathComponent("analysis.duckdb").path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.appendingPathComponent("analysis-native.duckdb").path))
        let result = try object(await reopened.queryBridge(sql: "SELECT value FROM retained", parametersJSON: json([]), transactionId: nil))
        XCTAssertEqual((result["rows"] as? [[String: Any]])?.first?["value"] as? Int, 19)
    }

    func testParameterlessExecuteSupportsSchemaBatches() async throws {
        let service = try DuckDBService()
        try await service.executeBridge(sql: """
            CREATE TABLE activities(id VARCHAR PRIMARY KEY);
            CREATE TABLE activity_samples(activity_id VARCHAR NOT NULL);
            CREATE TABLE normalization_sources(activity_id VARCHAR PRIMARY KEY);
            """, parametersJSON: json([]), transactionId: nil)

        let page = try object(await service.queryBridge(
            sql: "SELECT table_name FROM information_schema.tables WHERE table_name IN ('activities', 'activity_samples', 'normalization_sources') ORDER BY table_name",
            parametersJSON: json([]), transactionId: nil))
        let names = try XCTUnwrap(page["rows"] as? [[String: Any]]).compactMap { $0["table_name"] as? String }
        XCTAssertEqual(names, ["activities", "activity_samples", "normalization_sources"])
    }

    func testBindingsBulkPagingAndTimestampRoundTrip() async throws {
        let service = try DuckDBService()
        try await service.executeBridge(sql: "CREATE TABLE samples(id BIGINT, observed_at TIMESTAMPTZ, active BOOLEAN)", parametersJSON: json([]), transactionId: nil)
        let rows: [[Any]] = (0..<205).map { index in
            [index, ["type": "timestamp", "value": "2026-09-21T12:34:56.123Z"], index.isMultiple(of: 2)]
        }
        try await service.bulkInsertBridge(table: "samples", columns: ["id", "observed_at", "active"], rowsJSON: json(rows), transactionId: nil)

        let first = try object(await service.queryBridge(sql: "SELECT id, observed_at, active FROM samples ORDER BY id", parametersJSON: json([]), transactionId: nil))
        XCTAssertEqual(first["hasMore"] as? Bool, true)
        XCTAssertEqual((first["rows"] as? [[String: Any]])?.count, 200)
        let resultId = try XCTUnwrap(first["resultId"] as? String)
        let second = try object(await service.nextResultBridge(resultId))
        XCTAssertEqual((second["rows"] as? [[String: Any]])?.count, 5)
        XCTAssertEqual(second["hasMore"] as? Bool, false)
        let final = try XCTUnwrap((second["rows"] as? [[String: Any]])?.last)
        XCTAssertEqual(final["id"] as? Int, 204)
        XCTAssertEqual(final["active"] as? Bool, true)
        XCTAssertEqual(final["observed_at"] as? String, "2026-09-21T12:34:56.123Z")
    }

    func testTransactionCommitAndRollbackOwnership() async throws {
        let service = try DuckDBService()
        try await service.executeBridge(sql: "CREATE TABLE values_table(value BIGINT)", parametersJSON: json([]), transactionId: nil)
        let committed = try await service.begin()
        try await service.executeBridge(sql: "INSERT INTO values_table VALUES (?)", parametersJSON: json([["$databaseBigInt": "9007199254740992"]]), transactionId: committed)
        try await service.commit(committed)
        let rolledBack = try await service.begin()
        try await service.executeBridge(sql: "INSERT INTO values_table VALUES (?)", parametersJSON: json([7]), transactionId: rolledBack)
        try await service.rollback(rolledBack)

        let page = try object(await service.queryBridge(sql: "SELECT value FROM values_table", parametersJSON: json([]), transactionId: nil))
        let row = try XCTUnwrap((page["rows"] as? [[String: Any]])?.first)
        XCTAssertEqual((row["value"] as? [String: String])?["$databaseBigInt"], "9007199254740992")
        XCTAssertEqual((page["rows"] as? [[String: Any]])?.count, 1)
    }

    func testPinnedDuckDBHasBuiltInParquetAndAcceptsBoundHostPath() async throws {
        let service = try DuckDBService()
        let path = FileManager.default.temporaryDirectory.appendingPathComponent("duckdb-service-\(UUID().uuidString).parquet")
        defer { try? FileManager.default.removeItem(at: path) }
        let quoted = path.path.replacingOccurrences(of: "'", with: "''")
        try await service.executeBridge(sql: "COPY (SELECT 7::BIGINT AS value) TO '\(quoted)' (FORMAT PARQUET, COMPRESSION SNAPPY)", parametersJSON: json([]), transactionId: nil)

        let page = try object(await service.queryBridge(sql: "SELECT value FROM read_parquet(?)", parametersJSON: json([path.path]), transactionId: nil))

        XCTAssertEqual(((page["rows"] as? [[String: Any]])?.first)?["value"] as? Int, 7)
    }

    private func json(_ value: Any) throws -> Data { try JSONSerialization.data(withJSONObject: value) }
    private func object(_ data: Data) throws -> [String: Any] { try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any]) }
}
