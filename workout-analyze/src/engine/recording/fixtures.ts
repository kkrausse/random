import type { RecordingEngineObservation } from './types'

const at = (seconds: number) => new Date(Date.UTC(2026, 8, 19, 12, 0, seconds)).toISOString()
const transition = (sequence: number, seconds: number, from: 'idle' | 'recording' | 'paused' | 'interrupted', to: 'recording' | 'paused' | 'finished' | 'interrupted'): RecordingEngineObservation => ({ kind: 'transition', sequence, sourceTimestamp: at(seconds), monotonicTimestampMs: seconds * 1_000, from, to })
const location = (sequence: number, seconds: number, longitudeDegrees: number, overrides: Partial<Extract<RecordingEngineObservation, { kind: 'location' }>> = {}): RecordingEngineObservation => ({ kind: 'location', sequence, sourceTimestamp: at(seconds), receivedAt: at(seconds), monotonicTimestampMs: seconds * 1_000, latitudeDegrees: 0, longitudeDegrees, horizontalAccuracyM: 5, altitudeM: 10, verticalAccuracyM: 5, speedMps: null, speedAccuracyMps: null, ...overrides })

export const RECORDING_GOLDEN_FIXTURES = {
  distance: {
    observations: [transition(1, 0, 'idle', 'recording'), location(2, 1, 0), location(3, 11, 0.001)],
    evaluatedAt: { wallTimestamp: at(11), monotonicTimestampMs: 11_000 },
    expected: { distanceM: 111.195, activeDurationMs: 11_000 },
  },
  poorAccuracyAndStaleFix: {
    observations: [transition(1, 0, 'idle', 'recording'), location(2, 1, 0), location(3, 2, 0.0001, { horizontalAccuracyM: 80 }), location(4, 3, 0.0002), location(5, 4, 0.0003, { receivedAt: at(25) }), location(6, 5, 0.0004)],
    evaluatedAt: { wallTimestamp: at(5), monotonicTimestampMs: 5_000 },
    expected: { distanceM: 0 },
  },
  pauseResume: {
    observations: [transition(1, 0, 'idle', 'recording'), location(2, 1, 0), location(3, 6, 0.0002), transition(4, 10, 'recording', 'paused'), location(5, 20, 0.01), transition(6, 30, 'paused', 'recording'), location(7, 31, 0.01), location(8, 36, 0.0102), transition(9, 50, 'recording', 'finished')],
    evaluatedAt: { wallTimestamp: at(50), monotonicTimestampMs: 50_000 },
    expected: { activeDurationMs: 30_000, elapsedDurationMs: 50_000, distanceM: 44.478 },
  },
  staleSpeedAndHeartRate: {
    observations: [transition(1, 0, 'idle', 'recording'), location(2, 1, 0, { speedMps: 7, speedAccuracyMps: 1 }), { kind: 'heartRate', sequence: 3, sourceTimestamp: at(1), monotonicTimestampMs: 1_000, bpm: 145 }],
    evaluatedAt: { wallTimestamp: at(20), monotonicTimestampMs: 20_000 },
    expected: { currentSpeedMps: null, heartRateBpm: null, locationQuality: 'stale', heartRateQuality: 'stale' },
  },
  interruptionGap: {
    observations: [transition(1, 0, 'idle', 'recording'), { kind: 'gap', sequence: 2, sourceTimestamp: at(100), monotonicTimestampMs: null, startedAt: at(10), endedAt: at(100) }],
    evaluatedAt: { wallTimestamp: at(100), monotonicTimestampMs: null },
    expected: { activeDurationMs: 10_000, elapsedDurationMs: 100_000 },
  },
} as const
