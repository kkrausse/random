// Lifecycle and trailing-silence strategy adapted from the local Swift Hex fork.
// See THIRD_PARTY_NOTICES.md.
import AVFoundation
import FluidAudio
import Foundation

package actor Decoder {
    package init() {}
    private let manager = StreamingUnifiedAsrManager(config: UnifiedConfig(leftFrames: 70, chunkFrames: 7, rightFrames: 7))
    private var state = "loading"
    private var owner: UUID?
    private var load: Task<Void, Error>?

    package func prewarm(directory: URL) {
        guard load == nil else { return }
        load = Task {
            let start = Date()
            do {
                // Explicit local-only API: a missing cache fails rather than downloading.
                try await manager.loadModels(from: directory)
                state = "ready"
                FileHandle.standardError.write(Data("Model loaded in \(Date().timeIntervalSince(start))s\n".utf8))
            } catch {
                state = "error"
                FileHandle.standardError.write(Data("Model load failed: \(error)\n".utf8))
                throw error
            }
        }
    }

    package func status() -> String { owner == nil ? state : "busy" }

    func acquire(_ token: UUID, partial: @escaping @Sendable (String) -> Void) async throws {
        guard owner == nil else { throw ProtocolFailure("busy") }
        owner = token // Reserve before any suspension, including model warmup/reset.
        do {
            guard let load else { throw ProtocolFailure("unavailable") }
            try await load.value
            try await manager.reset()
            await manager.setPartialTranscriptCallback(partial)
        } catch {
            owner = nil
            throw error
        }
    }

    func append(_ samples: [Float]) async throws {
        try await manager.appendAudio(Self.buffer(samples))
        try await manager.processBufferedAudio()
    }

    func finish() async throws -> String {
        await manager.setPartialTranscriptCallback { _ in }
        try await append([Float](repeating: 0, count: 6400))
        return try await manager.finish()
    }

    func release(_ token: UUID) async {
        guard owner == token else { return }
        await manager.setPartialTranscriptCallback { _ in }
        do { try await manager.reset() }
        catch { state = "error"; load = Task { throw ProtocolFailure("reset_failed") } }
        owner = nil // Do not lend a decoder with outstanding inference/reset.
    }

    private static func buffer(_ samples: [Float]) -> AVAudioPCMBuffer {
        let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(max(1, samples.count)))!
        buffer.frameLength = AVAudioFrameCount(samples.count)
        samples.withUnsafeBufferPointer { source in
            if let base = source.baseAddress { buffer.floatChannelData![0].update(from: base, count: samples.count) }
        }
        return buffer
    }
}
