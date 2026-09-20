import Foundation

enum ContractValidation {
    static let identifier = try! NSRegularExpression(pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
    static let hash = try! NSRegularExpression(pattern: "^[a-f0-9]{64}$")
    static let methods = Set(["bridge.hello"] + phase1Capabilities + sensorCapabilities + recordingCapabilities + archiveCapabilities + journalCapabilities)
    static let checks = Set(["bridgePing", "capabilityCompatibility", "diagnosticStorage", "engineFixture"])

    static func matches(_ value: String, regex: NSRegularExpression) -> Bool {
        let range = NSRange(value.startIndex..., in: value)
        return regex.firstMatch(in: value, range: range)?.range == range
    }

    static func exactKeys(_ object: [String: Any], _ expected: Set<String>) -> Bool {
        Set(object.keys) == expected
    }

    static func safeRelativePath(_ path: String) -> Bool {
        guard !path.isEmpty, path.count <= 240, !path.hasPrefix("/"),
              path.unicodeScalars.allSatisfy({ $0.value > 31 && $0.value != 127 }),
              !path.contains(where: { ["\\", "%", "?", "#"].contains($0) }) else { return false }
        return path.split(separator: "/", omittingEmptySubsequences: false).allSatisfy { $0 != "." && $0 != ".." && !$0.isEmpty }
    }

    static func developmentURL(_ raw: String) -> URL? {
        guard let components = URLComponents(string: raw),
              components.scheme == "http" || components.scheme == "https",
              components.host != nil,
              components.user == nil, components.password == nil,
              (components.path.isEmpty || components.path == "/"),
              components.query == nil, components.fragment == nil,
              let url = components.url else { return nil }
        return url
    }

    static func sameOrigin(_ lhs: URL, _ rhs: URL) -> Bool {
        func port(_ url: URL) -> Int? {
            url.port ?? (url.scheme == "https" ? 443 : (url.scheme == "http" ? 80 : nil))
        }
        return lhs.scheme?.lowercased() == rhs.scheme?.lowercased()
            && lhs.host?.lowercased() == rhs.host?.lowercased()
            && port(lhs) == port(rhs)
    }

    static func validateManifest(data: Data) throws -> BuildManifest {
        guard data.count <= 1024 * 1024,
              let raw = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              exactKeys(raw, ["formatVersion", "buildId", "createdAt", "uiEntryPath", "engineEntryPath", "engineBuildId", "bridgeProtocol", "engineApi", "checkpointSchemaVersion", "requiredCapabilities", "files"]) else {
            throw ShellError.incompatibleBuild("Invalid manifest shape")
        }
        let manifest: BuildManifest
        do { manifest = try JSONDecoder().decode(BuildManifest.self, from: data) }
        catch { throw ShellError.incompatibleBuild("Manifest fields have invalid types") }
        guard let bridge = raw["bridgeProtocol"] as? [String: Any], exactKeys(bridge, ["min", "max"]),
              let engine = raw["engineApi"] as? [String: Any], exactKeys(engine, ["min", "max"]),
              let rawFiles = raw["files"] as? [[String: Any]], rawFiles.allSatisfy({ exactKeys($0, ["path", "role", "sizeBytes", "sha256"]) }),
              manifest.formatVersion == 1,
              matches(manifest.buildId, regex: identifier), matches(manifest.engineBuildId, regex: identifier),
              ISO8601DateFormatter().date(from: manifest.createdAt) != nil,
              manifest.bridgeProtocol == VersionRange(min: 1, max: 1),
              manifest.engineApi == VersionRange(min: 1, max: 1), manifest.checkpointSchemaVersion == 1,
               Set(manifest.requiredCapabilities).isSubset(of: Set(phase1Capabilities + sensorCapabilities + recordingCapabilities)),
              (1...1024).contains(manifest.files.count) else {
            throw ShellError.incompatibleBuild("Manifest identity or API is incompatible")
        }
        var paths = Set<String>()
        var total = 0
        for file in manifest.files {
            guard safeRelativePath(file.path), paths.insert(file.path).inserted,
                  ["ui", "engine", "asset"].contains(file.role),
                  (1...(32 * 1024 * 1024)).contains(file.sizeBytes), matches(file.sha256, regex: hash) else {
                throw ShellError.incompatibleBuild("Manifest contains an invalid file")
            }
            total += file.sizeBytes
            guard total <= 64 * 1024 * 1024 else { throw ShellError.incompatibleBuild("Build exceeds 64 MiB") }
        }
        guard manifest.files.first(where: { $0.path == manifest.uiEntryPath })?.role == "ui",
              manifest.files.first(where: { $0.path == manifest.engineEntryPath })?.role == "engine" else {
            throw ShellError.incompatibleBuild("Manifest entry path or role is invalid")
        }
        return manifest
    }

    static func validateCommand(_ body: Any) throws -> (requestId: String, method: String, params: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(body),
              try JSONSerialization.data(withJSONObject: body).count <= maximumBridgeBytes,
              let object = body as? [String: Any], exactKeys(object, ["protocolVersion", "requestId", "method", "params"]),
              let requestId = object["requestId"] as? String, matches(requestId, regex: identifier),
              let method = object["method"] as? String, let params = object["params"] as? [String: Any] else {
            throw ShellError.invalidRequest("Invalid or oversized command envelope")
        }
        guard object["protocolVersion"] as? Int == 1 else { throw ShellError.unsupportedVersion }
        guard methods.contains(method) else { throw ShellError.unsupportedMethod }
        guard validParams(method: method, params: params) else { throw ShellError.invalidRequest("Invalid parameters for \(method)") }
        return (requestId, method, params)
    }

    private static func text(_ value: Any?, max: Int) -> Bool {
        guard let string = value as? String else { return false }
        return !string.isEmpty && string.count <= max
    }

    private static func validParams(method: String, params: [String: Any]) -> Bool {
        switch method {
        case "bridge.hello":
            return exactKeys(params, ["clientName", "clientVersion", "supportedProtocolVersions"])
                && text(params["clientName"], max: 64) && text(params["clientVersion"], max: 64)
                && (params["supportedProtocolVersions"] as? [Int]) == [1]
        case "bridge.ping": return exactKeys(params, ["nonce"]) && text(params["nonce"], max: 128)
        case "permissions.request": return exactKeys(params, ["permission"]) && ["locationWhenInUse", "bluetooth"].contains(params["permission"] as? String)
        case "location.start":
            guard exactKeys(params, ["desiredAccuracy", "distanceFilterM", "backgroundMode", "maxDurationSeconds"]),
                  ["best", "nearestTenMeters", "hundredMeters"].contains(params["desiredAccuracy"] as? String),
                  let distance = (params["distanceFilterM"] as? NSNumber)?.doubleValue, distance.isFinite, (0...1000).contains(distance),
                  ["foregroundOnly", "continueWhenBackgrounded"].contains(params["backgroundMode"] as? String),
                  let duration = (params["maxDurationSeconds"] as? NSNumber)?.intValue else { return false }
            return (10...1800).contains(duration) && (params["maxDurationSeconds"] as? NSNumber)?.doubleValue == Double(duration)
        case "location.stop": return exactKeys(params, ["probeId"]) && (params["probeId"] as? String).map { matches($0, regex: identifier) } == true
        case "location.read": return validCursorParams(params, identity: "probeId")
        case "heartRate.scan":
            guard exactKeys(params, ["durationSeconds"]), let duration = (params["durationSeconds"] as? NSNumber)?.intValue else { return false }
            return (1...30).contains(duration) && (params["durationSeconds"] as? NSNumber)?.doubleValue == Double(duration)
        case "heartRate.connect": return exactKeys(params, ["deviceId"]) && (params["deviceId"] as? String).map { matches($0, regex: identifier) } == true
        case "heartRate.disconnect": return exactKeys(params, ["connectionId"]) && (params["connectionId"] as? String).map { matches($0, regex: identifier) } == true
        case "heartRate.read": return validCursorParams(params, identity: "connectionId")
        case "workout.start":
            return exactKeys(params, ["expectedRevision", "sport", "startPolicy"])
                && integer(params["expectedRevision"], min: 0, max: Int.max)
                && params["sport"] as? String == "cycling"
                && ["immediate", "waitForReliableLocation"].contains(params["startPolicy"] as? String)
        case "workout.pause", "workout.resume", "workout.finish": return validSessionMutation(params)
        case "workout.recover":
            return exactKeys(params, ["sessionId", "expectedRevision", "action"])
                && validIdentifier(params["sessionId"]) && integer(params["expectedRevision"], min: 0, max: Int.max)
                && ["resume", "finish"].contains(params["action"] as? String)
        case "workout.export":
            return exactKeys(params, ["sessionId", "format"]) && validIdentifier(params["sessionId"])
                && ["workoutBundleV1", "gpx"].contains(params["format"] as? String)
        case "observations.subscribe":
            return exactKeys(params, ["sessionId", "afterSequence", "maxBatchSize"])
                && validIdentifier(params["sessionId"]) && nullableSequence(params["afterSequence"])
                && integer(params["maxBatchSize"], min: 1, max: 200)
        case "observations.unsubscribe": return exactKeys(params, ["subscriptionId"]) && validIdentifier(params["subscriptionId"])
        case "observations.read":
            return exactKeys(params, ["sessionId", "afterSequence", "limit"])
                && validIdentifier(params["sessionId"]) && nullableSequence(params["afterSequence"])
                && integer(params["limit"], min: 1, max: 200)
        case "archive.list":
            return exactKeys(params, ["afterCursor", "limit"])
                && (params["afterCursor"] is NSNull || (params["afterCursor"] as? String).map { !$0.isEmpty && $0.count <= 512 } == true)
                && integer(params["limit"], min: 1, max: 100)
        case "archive.detail":
            return exactKeys(params, ["savedWorkoutId", "afterSequence", "limit"])
                && validIdentifier(params["savedWorkoutId"]) && nullableSequence(params["afterSequence"])
                && integer(params["limit"], min: 1, max: 200)
        case "journal.read":
            return exactKeys(params, ["sessionId", "afterJournalSequence", "limit"])
                && validIdentifier(params["sessionId"]) && nullableSequence(params["afterJournalSequence"])
                && integer(params["limit"], min: 1, max: 200)
        case "diagnostics.runChecks":
            guard exactKeys(params, ["checks"]) else { return false }
            if params["checks"] is NSNull { return true }
            guard let values = params["checks"] as? [String], values.count <= 4 else { return false }
            return values.allSatisfy(checks.contains)
        case "diagnostics.export": return exactKeys(params, ["includeWorkoutObservations"]) && params["includeWorkoutObservations"] is Bool
        case "appBuild.download":
            guard exactKeys(params, ["manifestUrl"]), let raw = params["manifestUrl"] as? String, raw.count <= 2048, let url = URL(string: raw) else { return false }
            return url.scheme == "https" && url.user == nil && url.password == nil
        case "appBuild.activate":
            return exactKeys(params, ["buildId"]) && (params["buildId"] as? String).map { matches($0, regex: identifier) } == true
        case "appBuild.rollback": return exactKeys(params, ["target"]) && ["previous", "bundled"].contains(params["target"] as? String)
        case "devSource.configure":
            guard exactKeys(params, ["url"]) else { return false }
            return params["url"] is NSNull || (params["url"] as? String).flatMap(developmentURL) != nil
        default: return params.isEmpty
        }
    }

    private static func validCursorParams(_ params: [String: Any], identity: String) -> Bool {
        guard exactKeys(params, [identity, "afterCursor", "limit"]),
              let id = params[identity] as? String, matches(id, regex: identifier),
              let limitNumber = params["limit"] as? NSNumber else { return false }
        let limit = limitNumber.intValue
        guard (1...200).contains(limit), limitNumber.doubleValue == Double(limit) else { return false }
        if params["afterCursor"] is NSNull { return true }
        guard let number = params["afterCursor"] as? NSNumber else { return false }
        return number.doubleValue == Double(number.intValue) && number.intValue >= 0
    }

    private static func validIdentifier(_ value: Any?) -> Bool {
        (value as? String).map { matches($0, regex: identifier) } == true
    }

    private static func integer(_ value: Any?, min: Int, max: Int) -> Bool {
        guard let number = value as? NSNumber else { return false }
        return number.doubleValue == Double(number.intValue) && (min...max).contains(number.intValue)
    }

    private static func nullableSequence(_ value: Any?) -> Bool {
        value is NSNull || integer(value, min: 0, max: Int.max)
    }

    private static func validSessionMutation(_ params: [String: Any]) -> Bool {
        exactKeys(params, ["sessionId", "expectedRevision"]) && validIdentifier(params["sessionId"])
            && integer(params["expectedRevision"], min: 0, max: Int.max)
    }
}
