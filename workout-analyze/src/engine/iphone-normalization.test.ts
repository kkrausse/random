import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RecorderObservation, SavedWorkoutDetail } from '../shared/mobile'
import { withBunDuckDbHost } from '../hosts/bun/DuckDbHost'
import { ingestIphoneWorkouts, iphoneActivityId, normalizeIphoneWorkout } from './iphone-normalization'

const transition = (sequence: number, from: string, to: string): RecorderObservation => ({
  kind: 'transition', sessionId: 'ride-test', sequence, transitionId: `t${sequence}`, from, to,
  sourceTimestamp: `2026-01-01T00:00:${String(sequence).padStart(2, '0')}Z`, monotonicTimestampMs: sequence * 1_000, cause: 'user',
} as RecorderObservation)
const location = (sequence: number, lon: number, extra: Record<string, unknown> = {}): RecorderObservation => ({
  kind: 'location', sessionId: 'ride-test', sequence, source: 'coreLocation', sourceTimestamp: `2026-01-01T00:00:${String(sequence).padStart(2, '0')}Z`,
  receivedAt: `2026-01-01T00:00:${String(sequence).padStart(2, '0')}Z`, monotonicTimestampMs: sequence * 1_000,
  latitudeDegrees: 0, longitudeDegrees: lon, horizontalAccuracyM: 5, altitudeM: null, verticalAccuracyM: null,
  speedMps: null, speedAccuracyMps: null, courseDegrees: null, courseAccuracyDegrees: null, floorLevel: null,
  isSimulatedBySoftware: false, isProducedByAccessory: false, ...extra,
} as RecorderObservation)

const detail = (observations: readonly RecorderObservation[], rawEventCount = 0): SavedWorkoutDetail => ({
  summary: {
    savedWorkoutId: 'ride-test', sessionId: 'ride-test', sport: 'cycling', startedAt: '2026-01-01T00:00:00Z', finishedAt: '2026-01-01T00:01:00Z',
    durationMs: 60_000, observationCount: observations.length, latestSequence: observations.at(-1)?.sequence ?? 0,
    metrics: { activeDurationMs: 50_000, elapsedDurationMs: 60_000, distanceM: 222, averageSpeedMps: 4.44, currentSpeedMps: null,
      currentSpeedObservedAt: null, altitudeM: null, elevationGainM: 0, heartRateBpm: null, heartRateObservedAt: null, locationQuality: 'good', heartRateQuality: 'unconfigured' },
    hasFatalIssue: false, rawEventCount, lastJournalSequence: rawEventCount,
  },
  pinnedEngine: { buildId: 'engine-v1', apiVersion: 1, checkpointSchemaVersion: 1 }, recordingFormatVersion: 1, units: 'SI',
  derivation: { algorithmId: 'metrics-v1', engineBuildId: 'engine-v1', configId: 'default-v1', firstInputSequence: observations.length ? 1 : null, lastInputSequence: observations.length },
  observations: { afterSequence: null, items: observations, nextSequence: observations.at(-1)?.sequence ?? null, oldestAvailableSequence: observations[0]?.sequence ?? null, latestDurableSequence: observations.length, hasMore: false, droppedBeforeSequence: false },
})

test('normalizes active distance, pause boundaries, and missing location values', () => {
  const result = normalizeIphoneWorkout(detail([
    transition(1, 'idle', 'recording'), location(2, 0), location(3, .001), transition(4, 'recording', 'paused'),
    location(5, .5), transition(6, 'paused', 'recording'), location(7, .5), location(8, .501), transition(9, 'recording', 'finished'),
  ]))
  expect(result.activityId).toBe('iphone:ride-test')
  expect(result.activity.samples).toHaveLength(5)
  expect(result.activity.samples[1]!.distanceM).toBeWithin(111, 111.4)
  expect(result.activity.samples[2]!.distanceM).toBe(result.activity.samples[1]!.distanceM)
  expect(result.activity.samples[4]!.distanceM).toBeWithin(222.2, 222.6)
  expect(result.activity.samples[0]!.altitudeM).toBeNull()
  expect(result.activity.samples[0]!.speedMps).toBeNull()
})

test('uses a stable source identity and supports observations-only legacy input', () => {
  const legacy = detail([transition(1, 'idle', 'recording'), location(2, -122.4), transition(3, 'recording', 'finished')], 0)
  expect(normalizeIphoneWorkout(legacy).activityId).toBe(iphoneActivityId(legacy.summary.sessionId))
  expect(normalizeIphoneWorkout(legacy).inputKind).toBe('saved-observations-v1')
  expect(normalizeIphoneWorkout(legacy).sampleCount).toBe(1)
})

test('repeated ingestion does not duplicate an activity or its samples', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'iphone-normalization-test-'))
  try {
    await withBunDuckDbHost(join(directory, 'fitness.duckdb'), async (database) => {
      await database.execute(`CREATE TABLE activities (id VARCHAR PRIMARY KEY, source VARCHAR, source_activity_id VARCHAR, sport VARCHAR, started_at TIMESTAMPTZ, duration_seconds DOUBLE, distance_m DOUBLE, ascent_m DOUBLE, avg_hr_bpm DOUBLE, max_hr_bpm DOUBLE);
        CREATE TABLE activity_samples (activity_id VARCHAR, timestamp TIMESTAMPTZ, lat DOUBLE, lon DOUBLE, distance_m DOUBLE, altitude_m DOUBLE, speed_mps DOUBLE, heart_rate_bpm DOUBLE, cadence DOUBLE, power_w DOUBLE);`)
      const workout = detail([transition(1, 'idle', 'recording'), location(2, 0), location(3, .001), transition(4, 'recording', 'finished')], 12)
      const first = await ingestIphoneWorkouts(database, [workout.summary], async () => workout)
      const second = await ingestIphoneWorkouts(database, [workout.summary], async () => workout)
      expect(first.imported).toBe(1)
      expect(second.unchanged).toBe(1)
      expect(Number((await database.query('SELECT count(*) count FROM activities'))[0]!.count)).toBe(1)
      expect(Number((await database.query('SELECT count(*) count FROM activity_samples'))[0]!.count)).toBe(2)
    })
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
