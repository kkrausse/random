import XCTest
@testable import WorkoutAnalyze

final class ContractValidationTests: XCTestCase {
    func testSafeRelativePaths() {
        XCTAssertTrue(ContractValidation.safeRelativePath("ui/assets/main.js"))
        for value in ["", "/absolute", "../escape", "ui/../escape", "ui//x", "ui\\x", "./x", "ui/a%20b.js", "ui/a?b", "ui/a#b", "ui/a\u{7f}b"] {
            XCTAssertFalse(ContractValidation.safeRelativePath(value), value)
        }
    }

    func testDevelopmentOriginValidation() {
        XCTAssertNotNil(ContractValidation.developmentURL("http://192.168.1.8:3001"))
        XCTAssertNotNil(ContractValidation.developmentURL("https://dev.example.test/"))
        for value in ["ftp://example.test", "http://user:pass@example.test", "http://example.test/path", "http://example.test/?token=x", "http://example.test/#x"] {
            XCTAssertNil(ContractValidation.developmentURL(value), value)
        }
    }

    func testOriginUsesNormalizedPorts() {
        XCTAssertTrue(ContractValidation.sameOrigin(URL(string: "https://example.test/x")!, URL(string: "https://example.test:443/")!))
        XCTAssertFalse(ContractValidation.sameOrigin(URL(string: "http://example.test/")!, URL(string: "https://example.test/")!))
        XCTAssertFalse(ContractValidation.sameOrigin(URL(string: "https://other.test/")!, URL(string: "https://example.test/")!))
    }

    func testCommandRejectsUnknownKeysAndSubsets() throws {
        let valid: [String: Any] = ["protocolVersion": 1, "requestId": "web-1", "method": "diagnostics.runChecks", "params": ["checks": ["bridgePing", "engineFixture"]]]
        XCTAssertNoThrow(try ContractValidation.validateCommand(valid))
        var bad = valid; bad["extra"] = true
        XCTAssertThrowsError(try ContractValidation.validateCommand(bad))
        var badCheck = valid; badCheck["params"] = ["checks": ["liveGPS"]]
        XCTAssertThrowsError(try ContractValidation.validateCommand(badCheck))
    }

    func testSensorCommandBounds() {
        let start: [String: Any] = ["protocolVersion": 1, "requestId": "sensor-1", "method": "location.start", "params": ["desiredAccuracy": "best", "distanceFilterM": 2.5, "backgroundMode": "foregroundOnly", "maxDurationSeconds": 60]]
        XCTAssertNoThrow(try ContractValidation.validateCommand(start))
        var tooLong = start
        tooLong["params"] = ["desiredAccuracy": "best", "distanceFilterM": 2.5, "backgroundMode": "foregroundOnly", "maxDurationSeconds": 1801]
        XCTAssertThrowsError(try ContractValidation.validateCommand(tooLong))
        let read: [String: Any] = ["protocolVersion": 1, "requestId": "sensor-2", "method": "heartRate.read", "params": ["connectionId": "hr-1", "afterCursor": NSNull(), "limit": 200]]
        XCTAssertNoThrow(try ContractValidation.validateCommand(read))
    }

    func testHeartRatePacketParsing() {
        let uint8 = SensorService.parseHeartRatePacket(Data([0x00, 72]))
        XCTAssertEqual(uint8?["bpm"] as? Int, 72)
        XCTAssertEqual(uint8?["valueFormat"] as? String, "uint8")
        let rich = SensorService.parseHeartRatePacket(Data([0x1F, 0x2C, 0x01, 0x34, 0x12, 0x00, 0x04]))
        XCTAssertEqual(rich?["bpm"] as? Int, 300)
        XCTAssertEqual(rich?["energyExpendedKJ"] as? Int, 0x1234)
        XCTAssertEqual((rich?["rrIntervalsSeconds"] as? [Double])?.first, 1.0)
        XCTAssertNil(SensorService.parseHeartRatePacket(Data([0x01, 0x2C])))
    }

    func testBundledManifestAndHashes() throws {
        let resources = Bundle(for: Self.self).resourceURL!.appendingPathComponent("BundledBuild")
        let data = try Data(contentsOf: resources.appendingPathComponent("manifest.json"))
        let manifest = try ContractValidation.validateManifest(data: data)
        XCTAssertEqual(manifest.buildId, "bundled-1")
        XCTAssertEqual(manifest.files.count, 2)
    }

    func testManifestRejectsTraversalAndUnknownKeys() throws {
        let validHash = String(repeating: "a", count: 64)
        let base: [String: Any] = [
            "formatVersion": 1, "buildId": "test-1", "createdAt": "2026-09-19T12:00:00Z",
            "uiEntryPath": "../index.html", "engineEntryPath": "engine/e.js", "engineBuildId": "phase1-engine-v1",
            "bridgeProtocol": ["min": 1, "max": 1], "engineApi": ["min": 1, "max": 1], "checkpointSchemaVersion": 1,
            "requiredCapabilities": ["bridge.ping"],
            "files": [["path": "../index.html", "role": "ui", "sizeBytes": 1, "sha256": validHash], ["path": "engine/e.js", "role": "engine", "sizeBytes": 1, "sha256": validHash]]
        ]
        XCTAssertThrowsError(try ContractValidation.validateManifest(data: JSONSerialization.data(withJSONObject: base)))
        var unknown = base; unknown["surprise"] = true
        XCTAssertThrowsError(try ContractValidation.validateManifest(data: JSONSerialization.data(withJSONObject: unknown)))
    }

    func testHandshakeDeadlinesAreScopedToNavigationGeneration() {
        var tracker = StartupHandshakeTracker()
        let stale = tracker.beginNavigation()
        tracker.navigationCommitted(generation: stale)
        let current = tracker.beginNavigation()

        XCTAssertEqual(tracker.hello(generation: stale), .ignored)
        XCTAssertFalse(tracker.navigationTimedOut(generation: stale))
        tracker.navigationCommitted(generation: current)
        XCTAssertTrue(tracker.navigationFinished(generation: current))
        XCTAssertEqual(tracker.hello(generation: current), .completed)
        XCTAssertFalse(tracker.handshakeTimedOut(generation: current))
    }

    func testLateHelloRecoversOnlyCurrentFailedGeneration() {
        var tracker = StartupHandshakeTracker()
        let generation = tracker.beginNavigation()
        tracker.navigationCommitted(generation: generation)
        XCTAssertTrue(tracker.navigationFinished(generation: generation))
        XCTAssertTrue(tracker.handshakeTimedOut(generation: generation))
        XCTAssertEqual(tracker.hello(generation: generation), .recovered)

        let replacement = tracker.beginNavigation()
        tracker.navigationCommitted(generation: replacement)
        XCTAssertEqual(tracker.hello(generation: generation), .ignored)
        XCTAssertEqual(tracker.hello(generation: replacement), .completed)
    }

    @MainActor
    func testNativeSourceLifecycleDistinguishesConfiguredTargetAndLoaded() throws {
        let builds = BuildManager(log: DiagnosticLog())
        defer { _ = try? builds.configureDevelopmentSource(nil) }
        let configured = URL(string: "http://100.86.29.19:4317/")!
        _ = try builds.configureDevelopmentSource(configured.absoluteString)

        builds.noteUILoadStarted(url: configured, generation: 4)
        XCTAssertEqual(builds.uiLoadState, "navigating")
        XCTAssertNil(builds.loadedUIURL)
        builds.noteUINavigationFinished(url: configured, generation: 4)
        XCTAssertEqual(builds.uiLoadState, "awaitingHello")
        builds.noteUIHandshakeSucceeded(url: configured, generation: 3)
        XCTAssertEqual(builds.uiLoadState, "awaitingHello", "A stale generation must not become loaded")
        builds.noteUIHandshakeSucceeded(url: configured, generation: 4)
        XCTAssertEqual(builds.uiLoadState, "ready")
        XCTAssertEqual(builds.loadedUIURL, configured)
        XCTAssertNil(builds.currentLoadFailure)

        let status = builds.sourceStatusDictionary()
        XCTAssertEqual((status["configured"] as? [String: String])?["url"], configured.absoluteString)
        XCTAssertEqual(status["loadedUrl"] as? String, configured.absoluteString)
    }
}
