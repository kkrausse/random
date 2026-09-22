import XCTest
@testable import WorkoutAnalyze

final class DuckDBServiceTests: XCTestCase {
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

    private func json(_ value: Any) throws -> Data { try JSONSerialization.data(withJSONObject: value) }
    private func object(_ data: Data) throws -> [String: Any] { try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any]) }
}
