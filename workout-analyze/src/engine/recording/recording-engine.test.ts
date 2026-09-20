import { describe, expect, test } from 'bun:test'

import { RECORDING_GOLDEN_FIXTURES } from './fixtures'
import { createRecordingEngineArtifact } from './index'
import type { RecordingEngineArtifact, RecordingMetrics } from './types'

const run = (artifact: RecordingEngineArtifact, fixture: (typeof RECORDING_GOLDEN_FIXTURES)[keyof typeof RECORDING_GOLDEN_FIXTURES]) => artifact.create(null).processBatch({ observations: fixture.observations, evaluatedAt: fixture.evaluatedAt }).metrics

const expectGolden = (actual: RecordingMetrics, expected: Readonly<Record<string, unknown>>) => {
  for (const [key, value] of Object.entries(expected)) expect(actual[key as keyof RecordingMetrics]).toBe(value as string | number | null)
}

describe('portable recording metrics engine', () => {
  for (const [name, fixture] of Object.entries(RECORDING_GOLDEN_FIXTURES)) {
    test(name, () => expectGolden(run(createRecordingEngineArtifact(), fixture), fixture.expected))
  }

  test('deduplicates replay and rejects a durable sequence gap', () => {
    const engine = createRecordingEngineArtifact().create(null)
    const fixture = RECORDING_GOLDEN_FIXTURES.distance
    const first = engine.processBatch({ observations: fixture.observations, evaluatedAt: fixture.evaluatedAt })
    const replay = engine.processBatch({ observations: fixture.observations, evaluatedAt: fixture.evaluatedAt })
    expect(replay.processedCount).toBe(0)
    expect(replay.metrics.distanceM).toBe(first.metrics.distanceM)
    expect(() => engine.processBatch({ observations: [{ ...fixture.observations[2], sequence: 5 }], evaluatedAt: fixture.evaluatedAt })).toThrow('sequence gap')
  })

  test('does not partially commit a rejected batch', () => {
    const engine = createRecordingEngineArtifact().create(null)
    const fixture = RECORDING_GOLDEN_FIXTURES.distance
    expect(() => engine.processBatch({ observations: [fixture.observations[0], { ...fixture.observations[2], sequence: 3 }], evaluatedAt: fixture.evaluatedAt })).toThrow('sequence gap')
    expect(engine.checkpoint().lastSequence).toBe(0)
    expect(engine.processBatch({ observations: fixture.observations, evaluatedAt: fixture.evaluatedAt }).metrics.distanceM).toBe(111.195)
  })

  test('uses durable wall time after restoring an active checkpoint', () => {
    const fixture = RECORDING_GOLDEN_FIXTURES.distance
    const first = createRecordingEngineArtifact().create(null)
    first.processBatch({ observations: fixture.observations.slice(0, 1), evaluatedAt: { wallTimestamp: fixture.observations[0].sourceTimestamp, monotonicTimestampMs: 0 } })
    const restored = createRecordingEngineArtifact().create(first.checkpoint())
    const result = restored.processBatch({ observations: [], evaluatedAt: { wallTimestamp: fixture.evaluatedAt.wallTimestamp, monotonicTimestampMs: 500 } })
    expect(result.metrics.activeDurationMs).toBe(11_000)
  })

  test('accumulates gradual ascent across the elevation deadband', () => {
    const fixture = RECORDING_GOLDEN_FIXTURES.gradualAscent
    expect(run(createRecordingEngineArtifact(), fixture).elevationGainM).toBe(4)
  })

  test('the checked-in plain-JavaScript JavaScriptCore artifact matches TypeScript', async () => {
    const source = await Bun.file(new URL('./recording-engine-v1.js', import.meta.url)).text()
    const host = {} as { WorkoutAnalyzeRecordingEngine?: RecordingEngineArtifact }
    new Function('globalThis', source)(host)
    expect(host.WorkoutAnalyzeRecordingEngine?.describe()).toEqual(createRecordingEngineArtifact().describe())
    const fixture = RECORDING_GOLDEN_FIXTURES.pauseResume
    expect(host.WorkoutAnalyzeRecordingEngine && run(host.WorkoutAnalyzeRecordingEngine, fixture)).toEqual(run(createRecordingEngineArtifact(), fixture))
  })
})
