import FluidAudio
import Foundation

@main
struct TranscribeLocal {
    static func main() async throws {
        let arguments = Array(CommandLine.arguments.dropFirst())
        guard let inputPath = arguments.first, !["-h", "--help"].contains(inputPath) else {
            print("Usage: transcribe-local <audio-file> [output-file]")
            return
        }

        let inputURL = URL(fileURLWithPath: inputPath).standardizedFileURL
        guard FileManager.default.fileExists(atPath: inputURL.path) else {
            throw CocoaError(.fileNoSuchFile, userInfo: [NSFilePathErrorKey: inputURL.path])
        }

        let outputURL = arguments.count > 1
            ? URL(fileURLWithPath: arguments[1]).standardizedFileURL
            : inputURL.deletingPathExtension().appendingPathExtension("txt")

        writeStatus("Converting audio to 16 kHz mono...")
        let samples = try AudioConverter().resampleAudioFile(inputURL)
        let duration = Double(samples.count) / 16_000
        writeStatus("Loading cached Parakeet Unified model for \(format(duration)) of audio...")

        let manager = UnifiedAsrManager(encoderPrecision: .int8)
        try await manager.loadModels()

        writeStatus("Transcribing...")
        let start = Date()
        let transcript = try await manager.transcribe(samples)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        try (transcript + "\n").write(to: outputURL, atomically: true, encoding: .utf8)

        writeStatus("Wrote \(outputURL.path) in \(format(Date().timeIntervalSince(start))).")
    }

    private static func writeStatus(_ message: String) {
        FileHandle.standardError.write(Data((message + "\n").utf8))
    }

    private static func format(_ seconds: TimeInterval) -> String {
        let minutes = Int(seconds) / 60
        return String(format: "%d:%02d", minutes, Int(seconds) % 60)
    }
}
