import Foundation
import JavaScriptCore

struct RecordingEngineDescription {
    let apiVersion: Int
    let checkpointSchemaVersion: Int
    let engineBuildId: String
    let algorithmId: String
    let maxBatchSize: Int
}

enum RecordingEngineHost {
    static func describe(scriptURL: URL) throws -> RecordingEngineDescription {
        let context = try context(scriptURL: scriptURL)
        guard let object = context.evaluateScript("WorkoutAnalyzeRecordingEngine.describe()").toDictionary() as? [String: Any],
              let api = object["apiVersion"] as? Int, let schema = object["checkpointSchemaVersion"] as? Int,
              let build = object["engineBuildId"] as? String, let algorithm = object["algorithmId"] as? String,
              let batch = object["maxBatchSize"] as? Int else { throw ShellError.incompatibleBuild("Recording engine describe() returned an invalid value") }
        return RecordingEngineDescription(apiVersion: api, checkpointSchemaVersion: schema, engineBuildId: build, algorithmId: algorithm, maxBatchSize: batch)
    }

    static func process(scriptURL: URL, checkpoint: [String: Any]?, observations: [[String: Any]], wallTimestamp: String, monotonicTimestampMs: Double?) throws -> [String: Any] {
        let context = try context(scriptURL: scriptURL)
        let checkpointData = checkpoint.map { try? JSONSerialization.data(withJSONObject: $0) } ?? Data("null".utf8)
        let observationsData = try JSONSerialization.data(withJSONObject: observations)
        let checkpointJSON = String(decoding: checkpointData ?? Data("null".utf8), as: UTF8.self)
        let observationsJSON = String(decoding: observationsData, as: UTF8.self)
        let clock: [String: Any] = ["wallTimestamp": wallTimestamp, "monotonicTimestampMs": monotonicTimestampMs ?? NSNull()]
        let clockData = try JSONSerialization.data(withJSONObject: clock)
        let expression = "WorkoutAnalyzeRecordingEngine.create(\(checkpointJSON)).processBatch({observations:\(observationsJSON),evaluatedAt:\(String(decoding: clockData, as: UTF8.self))})"
        guard let result = context.evaluateScript(expression), !result.isUndefined,
              let object = result.toDictionary() as? [String: Any] else { throw ShellError.internalFailure("Recording engine processBatch() failed") }
        return object
    }

    private static func context(scriptURL: URL) throws -> JSContext {
        let script = try String(contentsOf: scriptURL, encoding: .utf8)
        guard script.utf8.count <= 32 * 1024 * 1024, let context = JSContext() else { throw ShellError.incompatibleBuild("Could not create recording JavaScriptCore context") }
        var exception: String?
        context.exceptionHandler = { _, value in exception = value?.toString() }
        context.evaluateScript(script)
        if let exception { throw ShellError.incompatibleBuild("Recording engine evaluation failed: \(exception)") }
        return context
    }
}
