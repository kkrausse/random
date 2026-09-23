import XCTest
import CryptoKit
@testable import WorkoutAnalyze

final class DuckDBServiceTests: XCTestCase {
    func testRecoveredExportOpensInPinnedNativeEngine() async throws {
        guard let export = ProcessInfo.processInfo.environment["WORKOUT_RECOVERY_EXPORT"] else {
            throw XCTSkip("Set WORKOUT_RECOVERY_EXPORT to a disposable DuckDB export")
        }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("duckdb-import-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let filename = "analysis-recovery-2026-09-23T14-29-44Z-restored.duckdb"
        let url = directory.appendingPathComponent(filename)
        let quote = export.replacingOccurrences(of: "'", with: "''")
        do {
            let service = try DuckDBService(url: url)
            try await service.execute(sql: "IMPORT DATABASE '\(quote)'", parameters: [], transactionId: nil)
            try await assertRecoveredState(service)
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: url.path + ".wal"))
        var selected: String?
        let reopened = try DuckDBService.applicationDatabase(in: directory) { result, name, _ in
            if result == "selected" { selected = name }
        }
        XCTAssertEqual(selected, filename)
        try await assertRecoveredState(reopened)
        let hash = SHA256.hash(data: try Data(contentsOf: url)).map { String(format: "%02x", $0) }.joined()
        let marker = directory.appendingPathComponent("analysis-recovery-selection.json")
        let restored = directory.appendingPathComponent("analysis-restored-2026-09-23.duckdb")
        try FileManager.default.copyItem(at: url, to: restored)
        try json(["filename": restored.lastPathComponent, "databaseSHA256": hash, "sourceWALSHA256": "d129548514614eea2eed1a8c5121ec161f7cbf0b0cf4dbcb993c5d2c386799cd"]).write(to: marker)
        var activation: String?
        let activated = try DuckDBService.applicationDatabase(in: directory) { result, name, _ in
            if result == "selected" { activation = name }
        }
        XCTAssertEqual(activation, restored.lastPathComponent)
        try await assertRecoveredState(activated)
        try await activated.execute(sql: "CREATE TABLE recovery_post_activation(value INTEGER); INSERT INTO recovery_post_activation VALUES (7)", parameters: [], transactionId: nil)
        let afterWrite = try DuckDBService.applicationDatabase(in: directory)
        let postActivation = try object(await afterWrite.queryBridge(sql: "SELECT value FROM recovery_post_activation", parametersJSON: json([]), transactionId: nil))
        XCTAssertEqual((postActivation["rows"] as? [[String: Any]])?.first?["value"] as? Int, 7)
        try Data("invalid".utf8).write(to: marker)
        XCTAssertThrowsError(try DuckDBService.applicationDatabase(in: directory))
    }

    private func assertRecoveredState(_ service: DuckDBService) async throws {
        let result = try object(await service.queryBridge(sql: "SELECT (SELECT count(*) FROM activities) workouts, (SELECT count(*) FROM activity_samples) samples, (SELECT count(*) FROM detected_routes) routes, (SELECT count(*) FROM route_traversals) traversals, (SELECT count(*) FROM route_coverages) coverages", parametersJSON: json([]), transactionId: nil))
        let row = try XCTUnwrap((result["rows"] as? [[String: Any]])?.first)
        XCTAssertEqual(row["workouts"] as? Int, 173)
        XCTAssertEqual(row["samples"] as? Int, 195928)
        XCTAssertEqual(row["routes"] as? Int, 31)
        XCTAssertEqual(row["traversals"] as? Int, 421)
        XCTAssertEqual(row["coverages"] as? Int, 1890)
        for (sql, digest) in [
            ("SELECT md5(string_agg(id || ':' || traversal_count::VARCHAR || ':' || workout_count::VARCHAR, '|' ORDER BY id)) digest FROM detected_routes", "e47d85d7e98e93bad1fd63112582dd8f"),
            ("SELECT md5(string_agg(id || ':' || route_id || ':' || activity_id, '|' ORDER BY id)) digest FROM route_traversals", "66ab2962eac0f0b059a6e5fccd3da2cd"),
            ("SELECT md5(string_agg(id, '|' ORDER BY id)) digest FROM activities", "6d99f0b4cb2542f2b774d865e7c73fef"),
        ] {
            let page = try object(await service.queryBridge(sql: sql, parametersJSON: json([]), transactionId: nil))
            XCTAssertEqual((page["rows"] as? [[String: Any]])?.first?["digest"] as? String, digest)
        }
    }

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

    func testFailedNativeStoreNeverCreatesAnotherEmptyRecovery() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("duckdb-recovery-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let preserved = ["analysis.duckdb", "analysis.duckdb.wal", "analysis-native.duckdb", "analysis-native.duckdb.wal", "recording-v1.sqlite", "recording-v1.sqlite-wal"]
        for (index, name) in preserved.enumerated() {
            try Data(repeating: UInt8(index + 1), count: 128).write(to: directory.appendingPathComponent(name))
        }
        var attempts: [(String, String, String?)] = []
        XCTAssertThrowsError(try DuckDBService.applicationDatabase(in: directory) { attempts.append(($0, $1, $2)) })
        XCTAssertEqual(attempts.map(\.0), ["failed", "failed"])
        XCTAssertEqual(attempts.map(\.1), ["analysis.duckdb", "analysis-native.duckdb"])
        XCTAssertTrue(attempts.allSatisfy { $0.2 != nil })
        XCTAssertFalse(try FileManager.default.contentsOfDirectory(atPath: directory.path).contains { $0.hasPrefix("analysis-recovery-") })
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
        XCTAssertEqual(attempts.map(\.0), ["selected"])
        XCTAssertEqual(attempts.last?.1, recovery)
        let result = try object(await reopened.queryBridge(sql: "SELECT value FROM retained", parametersJSON: json([]), transactionId: nil))
        XCTAssertEqual((result["rows"] as? [[String: Any]])?.first?["value"] as? Int, 17)
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: directory.path).filter { $0.hasPrefix("analysis-recovery-") }.count, 1)
    }

    func testPopulatedRecoveryIsNotHiddenByNewerEmptyRecoveryWhenWALCannotReplay() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("duckdb-recovery-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let populated = directory.appendingPathComponent("analysis-recovery-2026-09-23T12-00-00Z-first.duckdb")
        try Data(repeating: 0xFF, count: 128).write(to: populated)
        let empty = directory.appendingPathComponent("analysis-recovery-2026-09-23T13-00-00Z-second.duckdb")
        _ = try DuckDBService(url: empty)
        var attempts: [(String, String)] = []
        XCTAssertThrowsError(try DuckDBService.applicationDatabase(in: directory) { outcome, filename, _ in attempts.append((outcome, filename)) })
        XCTAssertEqual(attempts.map(\.1), [populated.lastPathComponent])
        XCTAssertEqual(attempts.map(\.0), ["failed"])
    }

    func testAnalysisScaleIndexedTransactionSurvivesReopenWithoutWALReplay() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("duckdb-checkpoint-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("analysis-recovery-test.duckdb")
        do {
            let service = try DuckDBService(url: url)
            try await service.execute(sql: "CREATE TABLE activities(id VARCHAR PRIMARY KEY); CREATE TABLE activity_samples(activity_id VARCHAR, sample_id INTEGER); CREATE TABLE detected_routes(id VARCHAR PRIMARY KEY); CREATE TABLE route_traversals(id VARCHAR PRIMARY KEY, route_id VARCHAR);", parameters: [], transactionId: nil)
            let importId = try await service.begin()
            try await service.execute(sql: "INSERT INTO activities SELECT 'workout-' || i::VARCHAR FROM range(173) t(i)", parameters: [], transactionId: importId)
            try await service.execute(sql: "INSERT INTO activity_samples SELECT 'workout-' || (i % 173)::VARCHAR, i FROM range(195928) t(i)", parameters: [], transactionId: importId)
            try await service.commit(importId)
            let analysisId = try await service.begin()
            try await service.execute(sql: "INSERT INTO detected_routes SELECT 'route-' || i::VARCHAR FROM range(31) t(i)", parameters: [], transactionId: analysisId)
            try await service.execute(sql: "INSERT INTO route_traversals SELECT 'traversal-' || i::VARCHAR, 'route-' || (i % 31)::VARCHAR FROM range(421) t(i)", parameters: [], transactionId: analysisId)
            try await service.execute(sql: "CREATE INDEX traversals_route ON route_traversals(route_id)", parameters: [], transactionId: analysisId)
            try await service.commit(analysisId)
            let counts = try object(await service.queryBridge(sql: "SELECT (SELECT count(*) FROM activities) workouts, (SELECT count(*) FROM activity_samples) samples, (SELECT count(*) FROM detected_routes) routes, (SELECT count(*) FROM route_traversals) traversals", parametersJSON: json([]), transactionId: nil))
            let row = try XCTUnwrap((counts["rows"] as? [[String: Any]])?.first)
            XCTAssertEqual(row["workouts"] as? Int, 173)
            XCTAssertEqual(row["samples"] as? Int, 195928)
            XCTAssertEqual(row["routes"] as? Int, 31)
            XCTAssertEqual(row["traversals"] as? Int, 421)
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: url.path + ".wal"), "Committed work should already be checkpointed into the database file")
        let reopened = try DuckDBService.applicationDatabase(in: directory)
        let result = try object(await reopened.queryBridge(sql: "SELECT count(*) AS count FROM activity_samples", parametersJSON: json([]), transactionId: nil))
        XCTAssertEqual((result["rows"] as? [[String: Any]])?.first?["count"] as? Int, 195928)
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

    func testLargeRouteRowsPageBelowBridgeReplyLimit() async throws {
        let service = try DuckDBService()
        try await service.executeBridge(sql: "CREATE TABLE routes(id INTEGER, geometry_json VARCHAR, support_profile_json VARCHAR)", parametersJSON: json([]), transactionId: nil)
        let rows: [[Any]] = (0..<31).map { [$0, String(repeating: "g", count: 11_000), String(repeating: "s", count: 10_000)] }
        try await service.bulkInsertBridge(table: "routes", columns: ["id", "geometry_json", "support_profile_json"], rowsJSON: json(rows), transactionId: nil)

        var page = try object(await service.queryBridge(sql: "SELECT * FROM routes ORDER BY id", parametersJSON: json([]), transactionId: nil))
        var ids: [Int] = []
        var pages = 0
        while true {
            pages += 1
            XCTAssertLessThan(try json(["protocolVersion": 1, "requestId": "web-test", "ok": true, "result": page]).count, maximumBridgeBytes)
            ids.append(contentsOf: try XCTUnwrap(page["rows"] as? [[String: Any]]).compactMap { $0["id"] as? Int })
            guard let resultId = page["resultId"] as? String else { break }
            page = try object(await service.nextResultBridge(resultId))
        }
        XCTAssertGreaterThan(pages, 1)
        XCTAssertEqual(ids, Array(0..<31))
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
