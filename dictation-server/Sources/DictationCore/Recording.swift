import Foundation
import Vapor

// WebSocket callbacks enqueue synchronously; a single consumer orders all inference.
// The lock also gates callbacks after cancel and bounds audio including in-flight work.
package final class Recording: @unchecked Sendable {
    enum Command { case start, audio(Data), stop }
    private let lock = NSLock()
    private let socket: WebSocket
    private let decoder: Decoder
    private let token = UUID()
    private let stream: AsyncStream<Command>
    private let continuation: AsyncStream<Command>.Continuation
    private var state = "new"
    private var id = ""
    private var sequence = 0
    private var queued = 0
    private var total = 0
    private var outgoing = 0
    private var timer: Task<Void, Never>?

    package init(socket: WebSocket, decoder: Decoder) {
        self.socket = socket
        self.decoder = decoder
        (stream, continuation) = AsyncStream.makeStream()
        timer = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 300_000_000_000)
            if !Task.isCancelled { self?.fail("duration_limit") }
        }
        Task { await run() }
    }

    package func text(_ text: String) {
        lock.lock(); defer { lock.unlock() }
        do {
            guard text.utf8.count <= 4096,
                  let value = try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any]
            else { throw ProtocolFailure("invalid_control") }
            if state == "new" {
                id = try validateStart(value)
                state = "loading"
                emitLocked("loading")
                continuation.yield(.start)
            } else if value["recordingId"] as? String == id, value["type"] as? String == "cancel" {
                cancelLocked()
            } else if value["recordingId"] as? String == id, value["type"] as? String == "stop", state == "ready" {
                state = "finishing"
                continuation.yield(.stop)
                continuation.finish()
            } else { throw ProtocolFailure("invalid_state") }
        } catch { failLocked((error as? ProtocolFailure)?.code ?? "invalid_control") }
    }

    package func audio(_ data: Data) {
        lock.lock(); defer { lock.unlock() }
        guard state == "ready" else { failLocked("invalid_state"); return }
        guard !data.isEmpty, data.count <= frameLimit, data.count % 4 == 0 else { failLocked("invalid_audio"); return }
        guard queued + data.count <= queueLimit else { failLocked("overload"); return }
        total += data.count
        guard total <= 300 * 64_000 else { failLocked("duration_limit"); return }
        queued += data.count
        continuation.yield(.audio(data))
    }

    package func cancel() { lock.lock(); defer { lock.unlock() }; cancelLocked() }
    func fail(_ code: String) { lock.lock(); defer { lock.unlock() }; failLocked(code) }
    private func cancelLocked() {
        state = "closed"
        timer?.cancel()
        continuation.finish()
        socket.close(promise: nil)
    }
    private func failLocked(_ code: String) {
        if state != "closed" { emitLocked("error", extra: ["code": code, "message": code.replacingOccurrences(of: "_", with: " ")]) }
        cancelLocked()
    }
    private func emitLocked(_ type: String, extra: [String: Any] = [:]) {
        guard state != "closed" else { return }
        var value: [String: Any] = ["type": type, "recordingId": id, "sequence": sequence]
        sequence += 1
        value.merge(extra) { _, new in new }
        let data = try! JSONSerialization.data(withJSONObject: value)
        guard outgoing + data.count <= 255_488 else {
            // No room to enqueue another cumulative transcript. Close rather than
            // accumulating unbounded writes for a client that stopped reading.
            state = "closed"
            timer?.cancel()
            continuation.finish()
            let error: [String: Any] = ["type": "error", "recordingId": id, "sequence": sequence,
                                       "code": "overload", "message": "Transcript output queue overloaded"]
            socket.send(String(data: try! JSONSerialization.data(withJSONObject: error), encoding: .utf8)!)
            socket.close(code: .unexpectedServerError, promise: nil)
            return
        }
        outgoing += data.count
        let promise = socket.eventLoop.makePromise(of: Void.self)
        promise.futureResult.whenComplete { [weak self] result in
            guard let self else { return }
            self.socket.eventLoop.execute {
                self.lock.lock(); defer { self.lock.unlock() }
                self.outgoing -= data.count
                if case .failure = result { self.cancelLocked() }
            }
        }
        socket.send(String(data: data, encoding: .utf8)!, promise: promise)
    }
    private func active() -> Bool { lock.lock(); defer { lock.unlock() }; return state != "closed" }
    private func ready() {
        lock.lock(); defer { lock.unlock() }
        if state == "loading" { state = "ready"; emitLocked("ready") }
    }
    private func partial(_ text: String) {
        lock.lock(); defer { lock.unlock() }
        if state == "ready" || state == "finishing" { emitLocked("partial", extra: ["text": text]) }
    }
    private func drained(_ count: Int) { lock.lock(); defer { lock.unlock() }; queued -= count }
    private func final(_ text: String) {
        lock.lock(); defer { lock.unlock() }
        if state != "closed" {
            emitLocked("final", extra: ["text": text])
            emitLocked("done")
            cancelLocked()
        }
    }
    private func run() async {
        do {
            for await command in stream {
                guard active() else { break }
                switch command {
                case .start:
                    try await decoder.acquire(token) { [weak self] in self?.partial($0) }
                    ready()
                case .audio(let data):
                    try await decoder.append(decodeAudio(data))
                    drained(data.count)
                case .stop:
                    let text = try await decoder.finish()
                    // Release before done so a subsequent recording can immediately acquire.
                    await decoder.release(token)
                    final(text)
                }
            }
        } catch { fail((error as? ProtocolFailure)?.code ?? "inference_failed") }
        await decoder.release(token)
    }
}
