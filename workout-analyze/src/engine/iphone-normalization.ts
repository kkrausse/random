import type { NormalizedActivity, ActivitySample } from '../domain/activity'
import type { RecorderObservation, SavedWorkoutDetail, SavedWorkoutSummary } from '../shared/mobile'
import type { DatabaseHost } from './database'
import { databaseTimestamp } from './database'

export const IPHONE_NORMALIZATION_VERSION = 'iphone-observations-v1'
export const iphoneActivityId = (sessionId: string) => `iphone:${sessionId}`

export interface IphoneNormalizationResult {
  readonly activityId: string
  readonly activity: NormalizedActivity
  readonly inputKind: 'saved-observations-v1'
  readonly sourceVersion: string
  readonly observationCount: number
  readonly sampleCount: number
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const radians = (value: number) => value * Math.PI / 180
const distanceBetween = (a: { latitudeDegrees: number; longitudeDegrees: number }, b: { latitudeDegrees: number; longitudeDegrees: number }) => {
  const lat = radians(b.latitudeDegrees - a.latitudeDegrees)
  const lon = radians(b.longitudeDegrees - a.longitudeDegrees)
  const x = Math.sin(lat / 2) ** 2 + Math.cos(radians(a.latitudeDegrees)) * Math.cos(radians(b.latitudeDegrees)) * Math.sin(lon / 2) ** 2
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}

const sourceVersion = (detail: SavedWorkoutDetail) => [
  IPHONE_NORMALIZATION_VERSION,
  detail.recordingFormatVersion,
  detail.pinnedEngine.buildId,
  detail.derivation.algorithmId,
  detail.summary.latestSequence,
  detail.summary.rawEventCount ?? 0,
  detail.summary.finishedAt,
].join(':')

/** Converts the durable recorder projection into the same logical model as FIT imports. */
export const normalizeIphoneWorkout = (detail: SavedWorkoutDetail): IphoneNormalizationResult => {
  const ordered = [...detail.observations.items].sort((a, b) => a.sequence - b.sequence)
  let active = false
  let latestHeartRate: number | null = null
  let previousLocation: Extract<RecorderObservation, { kind: 'location' }> | null = null
  let cumulativeDistance = 0
  const heartRates: number[] = []
  const samples: ActivitySample[] = []

  for (const observation of ordered) {
    if (observation.kind === 'transition') {
      active = observation.to === 'recording'
      if (!active) previousLocation = null
      continue
    }
    if (observation.kind === 'heartRate') {
      latestHeartRate = finite(observation.bpm) ? observation.bpm : null
      if (latestHeartRate !== null && active) heartRates.push(latestHeartRate)
      continue
    }
    if (observation.kind !== 'location' || !finite(observation.latitudeDegrees) || !finite(observation.longitudeDegrees) || !finite(observation.horizontalAccuracyM) || observation.horizontalAccuracyM > 50) continue
    if (active && previousLocation) cumulativeDistance += distanceBetween(previousLocation, observation)
    samples.push({
      timestamp: new Date(observation.sourceTimestamp), lat: observation.latitudeDegrees, lon: observation.longitudeDegrees,
      distanceM: cumulativeDistance, altitudeM: finite(observation.altitudeM) ? observation.altitudeM : null,
      speedMps: finite(observation.speedMps) && observation.speedMps >= 0 ? observation.speedMps : null,
      heartRateBpm: latestHeartRate, cadence: null, powerW: null,
    })
    previousLocation = active ? observation : null
  }

  const metrics = detail.summary.metrics
  const activity: NormalizedActivity = {
    sourceActivityId: detail.summary.sessionId,
    sport: detail.summary.sport,
    startedAt: new Date(detail.summary.startedAt),
    durationSeconds: metrics.activeDurationMs / 1_000,
    distanceM: metrics.distanceM,
    ascentM: metrics.elevationGainM,
    avgHrBpm: heartRates.length ? heartRates.reduce((sum, value) => sum + value, 0) / heartRates.length : null,
    maxHrBpm: heartRates.length ? Math.max(...heartRates) : null,
    samples,
  }
  return {
    activityId: iphoneActivityId(detail.summary.sessionId), activity, inputKind: 'saved-observations-v1',
    sourceVersion: sourceVersion(detail), observationCount: ordered.length, sampleCount: samples.length,
  }
}

export const ensureIphoneNormalizationSchema = (database: DatabaseHost) => database.execute(`
  CREATE TABLE IF NOT EXISTS activities (
    id VARCHAR PRIMARY KEY, source VARCHAR NOT NULL, source_activity_id VARCHAR NOT NULL, sport VARCHAR NOT NULL,
    started_at TIMESTAMPTZ NOT NULL, duration_seconds DOUBLE, distance_m DOUBLE, ascent_m DOUBLE, avg_hr_bpm DOUBLE, max_hr_bpm DOUBLE
  );
  CREATE TABLE IF NOT EXISTS activity_samples (
    activity_id VARCHAR NOT NULL, timestamp TIMESTAMPTZ, lat DOUBLE, lon DOUBLE, distance_m DOUBLE,
    altitude_m DOUBLE, speed_mps DOUBLE, heart_rate_bpm DOUBLE, cadence DOUBLE, power_w DOUBLE
  );
  CREATE TABLE IF NOT EXISTS normalization_sources (
    activity_id VARCHAR PRIMARY KEY, source VARCHAR NOT NULL, source_activity_id VARCHAR NOT NULL,
    input_kind VARCHAR NOT NULL, normalization_version VARCHAR NOT NULL, source_version VARCHAR NOT NULL,
    observation_count BIGINT NOT NULL, sample_count BIGINT NOT NULL, normalized_at TIMESTAMPTZ NOT NULL
  )
`)

const persist = (database: DatabaseHost, normalized: IphoneNormalizationResult) => database.transaction(async (transaction) => {
  await transaction.execute('DELETE FROM activity_samples WHERE activity_id = ?', [normalized.activityId])
  await transaction.execute('DELETE FROM activities WHERE id = ?', [normalized.activityId])
  await transaction.execute('DELETE FROM normalization_sources WHERE activity_id = ?', [normalized.activityId])
  const activity = normalized.activity
  await transaction.bulkInsert('activities', ['id', 'source', 'source_activity_id', 'sport', 'started_at', 'duration_seconds', 'distance_m', 'ascent_m', 'avg_hr_bpm', 'max_hr_bpm'], [[
    normalized.activityId, 'iphone-recorder', activity.sourceActivityId, activity.sport, databaseTimestamp(activity.startedAt),
    activity.durationSeconds, activity.distanceM, activity.ascentM, activity.avgHrBpm, activity.maxHrBpm,
  ]])
  await transaction.bulkInsert('activity_samples', ['activity_id', 'timestamp', 'lat', 'lon', 'distance_m', 'altitude_m', 'speed_mps', 'heart_rate_bpm', 'cadence', 'power_w'], activity.samples.map((sample) => [
    normalized.activityId, sample.timestamp ? databaseTimestamp(sample.timestamp) : null, sample.lat, sample.lon, sample.distanceM,
    sample.altitudeM, sample.speedMps, sample.heartRateBpm, sample.cadence, sample.powerW,
  ]))
  await transaction.bulkInsert('normalization_sources', ['activity_id', 'source', 'source_activity_id', 'input_kind', 'normalization_version', 'source_version', 'observation_count', 'sample_count', 'normalized_at'], [[
    normalized.activityId, 'iphone-recorder', activity.sourceActivityId, normalized.inputKind, IPHONE_NORMALIZATION_VERSION,
    normalized.sourceVersion, normalized.observationCount, normalized.sampleCount, databaseTimestamp(new Date()),
  ]])
})

export interface IphoneIngestionSummary {
  readonly discovered: number
  readonly imported: number
  readonly unchanged: number
  readonly activities: ReadonlyArray<{ readonly id: string; readonly samples: number; readonly sourceVersion: string }>
}

export const ingestIphoneWorkouts = async (
  database: DatabaseHost,
  workouts: readonly SavedWorkoutSummary[],
  loadDetail: (savedWorkoutId: string) => Promise<SavedWorkoutDetail>,
): Promise<IphoneIngestionSummary> => {
  await ensureIphoneNormalizationSchema(database)
  const existing = new Map((await database.query("SELECT activity_id, source_version FROM normalization_sources WHERE source='iphone-recorder'"))
    .map((row) => [String(row.activity_id), String(row.source_version)]))
  let imported = 0
  let unchanged = 0
  const activities: Array<{ id: string; samples: number; sourceVersion: string }> = []
  for (const workout of workouts) {
    const detail = await loadDetail(workout.savedWorkoutId)
    const normalized = normalizeIphoneWorkout(detail)
    if (existing.get(normalized.activityId) === normalized.sourceVersion) unchanged += 1
    else { await persist(database, normalized); imported += 1 }
    activities.push({ id: normalized.activityId, samples: normalized.sampleCount, sourceVersion: normalized.sourceVersion })
  }
  return { discovered: workouts.length, imported, unchanged, activities }
}
