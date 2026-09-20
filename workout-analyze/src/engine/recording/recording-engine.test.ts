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

  test('the checked-in plain-JavaScript JavaScriptCore artifact matches TypeScript', async () => {
    const source = await Bun.file(new URL('./recording-engine-v1.js', import.meta.url)).text()
    const host = {} as { WorkoutAnalyzeRecordingEngine?: RecordingEngineArtifact }
    new Function('globalThis', source)(host)
    expect(host.WorkoutAnalyzeRecordingEngine?.describe()).toEqual(createRecordingEngineArtifact().describe())
    const fixture = RECORDING_GOLDEN_FIXTURES.pauseResume
    expect(host.WorkoutAnalyzeRecordingEngine && run(host.WorkoutAnalyzeRecordingEngine, fixture)).toEqual(run(createRecordingEngineArtifact(), fixture))
  })
})
