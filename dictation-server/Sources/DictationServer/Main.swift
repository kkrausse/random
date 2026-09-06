import Foundation
import Vapor
import Darwin
import DictationCore

@main
enum Main {
    static func main() async throws {
        LoggingSystem.bootstrap { StreamLogHandler.standardError(label: $0) }
        var options: [String: String] = [:]
        var args = Array(CommandLine.arguments.dropFirst())
        while !args.isEmpty {
            let key = args.removeFirst()
            guard ["--host", "--port", "--model-dir", "--instance-id", "--parent-pid"].contains(key), !args.isEmpty else {
                throw ProtocolFailure("invalid_arguments")
            }
            options[key] = args.removeFirst()
        }
        let host = options["--host"] ?? "127.0.0.1"
        guard ["127.0.0.1", "::1", "localhost"].contains(host),
              let port = Int(options["--port"] ?? "9876"), (1...65535).contains(port) else { throw ProtocolFailure("invalid_address") }
        let instance = options["--instance-id"] ?? UUID().uuidString
        let defaultDirectory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("FluidAudio/Models/parakeet-unified-en-0.6b")
        let directory = options["--model-dir"].map { URL(fileURLWithPath: ($0 as NSString).expandingTildeInPath) } ?? defaultDirectory
        let decoder = Decoder()
        await decoder.prewarm(directory: directory)
        let app = try await Application.make(Environment(name: "production", arguments: [CommandLine.arguments[0]]))
        app.http.server.configuration.hostname = host
        app.http.server.configuration.port = port
        app.logger = Logger(label: "dictation-server", factory: { StreamLogHandler.standardError(label: $0) })
        app.get("healthz") { _ in ["instanceId": instance, "version": "1", "status": "alive"] }
        app.get("v1", "status") { _ async throws -> Response in
            let body: [String: Any] = ["version": 1, "modelId": modelID, "state": await decoder.status(),
                                      "audio": audioFormat, "limits": ["frameBytes": frameLimit, "queueBytes": queueLimit, "seconds": 300]]
            return Response(status: .ok, headers: ["content-type": "application/json"], body: .init(data: try JSONSerialization.data(withJSONObject: body)))
        }
        app.webSocket("v1", "stream", maxFrameSize: .init(integerLiteral: 6400)) { _, socket in
            let recording = Recording(socket: socket, decoder: decoder)
            socket.onText { _, text in recording.text(text) }
            socket.onBinary { _, buffer in recording.audio(Data(buffer.readableBytesView)) }
            socket.onClose.whenComplete { _ in recording.cancel() }
        }
        let watchdog = options["--parent-pid"].flatMap(Int32.init).map { parent in
            Task {
                while !Task.isCancelled {
                    try? await Task.sleep(nanoseconds: 1_000_000_000)
                    if getppid() != parent || kill(parent, 0) != 0 { exit(0) }
                }
            }
        }
        do { try await app.execute() }
        catch { watchdog?.cancel(); try await app.asyncShutdown(); throw error }
        watchdog?.cancel()
        try await app.asyncShutdown()
    }
}
