import Foundation

struct StartupHandshakeTracker {
    enum Phase: Equatable {
        case idle
        case navigating
        case committed
        case awaitingHello
        case completed
        case failed
    }

    enum HelloOutcome: Equatable {
        case ignored
        case completed
        case recovered
    }

    private(set) var generation = 0
    private(set) var phase: Phase = .idle

    mutating func beginNavigation() -> Int {
        generation += 1
        phase = .navigating
        return generation
    }

    mutating func navigationCommitted(generation candidate: Int) {
        guard candidate == generation, phase == .navigating else { return }
        phase = .committed
    }

    mutating func navigationFinished(generation candidate: Int) -> Bool {
        guard candidate == generation, phase == .committed else { return false }
        phase = .awaitingHello
        return true
    }

    mutating func hello(generation candidate: Int?) -> HelloOutcome {
        guard candidate == generation else { return .ignored }
        switch phase {
        case .committed, .awaitingHello:
            phase = .completed
            return .completed
        case .failed:
            phase = .completed
            return .recovered
        case .idle, .navigating, .completed:
            return .ignored
        }
    }

    mutating func navigationTimedOut(generation candidate: Int) -> Bool {
        guard candidate == generation, phase == .navigating || phase == .committed else { return false }
        phase = .failed
        return true
    }

    mutating func handshakeTimedOut(generation candidate: Int) -> Bool {
        guard candidate == generation, phase == .awaitingHello else { return false }
        phase = .failed
        return true
    }
}
