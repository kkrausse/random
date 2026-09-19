import Foundation
import JavaScriptCore

struct EngineDescription {
    let apiVersion: Int
    let checkpointSchemaVersion: Int
    let engineBuildId: String
    let algorithmId: String
    let maxBatchSize: Int
}

enum EngineHost {
    static func describe(scriptURL: URL) throws -> EngineDescription {
        let script = try String(contentsOf: scriptURL, encoding: .utf8)
        guard script.utf8.count <= 32 * 1024 * 1024, let context = JSContext() else {
            throw ShellError.internalFailure("Could not create bounded JavaScriptCore context")
        }
        var exception: String?
        context.exceptionHandler = { _, value in exception = value?.toString() }
        context.evaluateScript(script)
        if let exception { throw ShellError.incompatibleBuild("Engine evaluation failed: \(exception)") }
        guard let value = context.evaluateScript("WorkoutAnalyzeEngine.describe()"),
              let object = value.toDictionary() as? [String: Any],
              let api = object["apiVersion"] as? Int,
              let checkpoint = object["checkpointSchemaVersion"] as? Int,
              let build = object["engineBuildId"] as? String,
              let algorithm = object["algorithmId"] as? String,
              let maxBatchSize = object["maxBatchSize"] as? Int else {
            throw ShellError.incompatibleBuild("Engine describe() returned an invalid value")
        }
        return EngineDescription(apiVersion: api, checkpointSchemaVersion: checkpoint, engineBuildId: build, algorithmId: algorithm, maxBatchSize: maxBatchSize)
    }

    static func runIsolatedFixture(scriptURL: URL, expectedBuildId: String) throws -> String {
        let script = try String(contentsOf: scriptURL, encoding: .utf8)
        guard let context = JSContext() else { throw ShellError.internalFailure("Could not create fixture JavaScriptCore context") }
        var exception: String?
        context.exceptionHandler = { _, value in exception = value?.toString() }
        context.evaluateScript(script)
        let expression = """
        (function () {
          var d = WorkoutAnalyzeEngine.describe();
          var e = WorkoutAnalyzeEngine.create(null);
          var r = e.processBatch({observations:[{sequence:1,value:2},{sequence:2,value:3}]});
          return {apiVersion:d.apiVersion, checkpointSchemaVersion:d.checkpointSchemaVersion,
                  engineBuildId:d.engineBuildId, algorithmId:r.algorithmId,
                  displayValue:r.displayValue, lastSequence:r.lastSequence,
                  checkpoint:e.checkpoint()};
        })()
        """
        guard let value = context.evaluateScript(expression), exception == nil,
              let result = value.toDictionary() as? [String: Any],
              result["apiVersion"] as? Int == 1,
              result["checkpointSchemaVersion"] as? Int == 1,
              result["engineBuildId"] as? String == expectedBuildId,
              result["lastSequence"] as? Int == 2,
              let display = result["displayValue"] as? NSNumber,
              (display.doubleValue == 5 || display.doubleValue == 10) else {
            throw ShellError.internalFailure("Isolated engine fixture failed\(exception.map { ": \($0)" } ?? "")")
        }
        return "Fresh JavaScriptCore fixture passed for \(expectedBuildId) with display value \(display)"
    }
}
