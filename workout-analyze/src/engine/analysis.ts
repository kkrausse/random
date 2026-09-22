import type { ActivitySample, NormalizedActivity } from '../domain/activity'
import type { DetectionResult } from '../services/SegmentDetector'
import { detectRoutes, resolveDetectionConfig } from '../services/SegmentDetector'
import type { DetectionConfig } from '../services/SegmentDetector'
import type { DetectionProgress, DetectionProgressListener } from '../services/SegmentDetector'
import type { DatabaseHost } from './database'
import { databaseTimestamp } from './database'

const nullableNumber = (value: unknown) => value === null ? null : Number(value)

export const readNormalizedActivities = async (database: DatabaseHost): Promise<NormalizedActivity[]> => {
  const activityRows = await database.query(`
      SELECT id, source_activity_id, sport, started_at::VARCHAR started_at,
        duration_seconds, distance_m, ascent_m, avg_hr_bpm, max_hr_bpm
      FROM activities ORDER BY started_at
    `)
  const sampleRows = await database.query(`
      SELECT activity_id, timestamp::VARCHAR AS sample_timestamp, lat, lon, distance_m,
        altitude_m, speed_mps, heart_rate_bpm, cadence, power_w
      FROM activity_samples ORDER BY activity_id, timestamp
    `)
  const samples = new Map<string, ActivitySample[]>()
  for (const row of sampleRows) {
    const id = String(row.activity_id)
    const values = samples.get(id) ?? []
    values.push({
      timestamp: row.sample_timestamp === null ? null : new Date(String(row.sample_timestamp)),
      lat: nullableNumber(row.lat), lon: nullableNumber(row.lon), distanceM: nullableNumber(row.distance_m),
      altitudeM: nullableNumber(row.altitude_m), speedMps: nullableNumber(row.speed_mps),
      heartRateBpm: nullableNumber(row.heart_rate_bpm), cadence: nullableNumber(row.cadence), powerW: nullableNumber(row.power_w),
    })
    samples.set(id, values)
  }
  return activityRows.map((row) => ({
    sourceActivityId: String(row.source_activity_id), sport: String(row.sport), startedAt: new Date(String(row.started_at)),
    durationSeconds: nullableNumber(row.duration_seconds), distanceM: nullableNumber(row.distance_m),
    ascentM: nullableNumber(row.ascent_m), avgHrBpm: nullableNumber(row.avg_hr_bpm), maxHrBpm: nullableNumber(row.max_hr_bpm),
    samples: samples.get(String(row.id)) ?? [],
  }))
}

const createAnalysisTables = (database: DatabaseHost) => database.execute(`
  CREATE TABLE detected_routes (
    id VARCHAR PRIMARY KEY, name VARCHAR NOT NULL, type VARCHAR NOT NULL, sport VARCHAR NOT NULL,
    geometry_json VARCHAR NOT NULL, support_profile_json VARCHAR NOT NULL, distance_m DOUBLE NOT NULL, workout_count INTEGER NOT NULL,
    traversal_count INTEGER NOT NULL, match_score DOUBLE NOT NULL, popularity_score DOUBLE NOT NULL,
    overall_score DOUBLE NOT NULL, first_traversal_at TIMESTAMPTZ NOT NULL, last_traversal_at TIMESTAMPTZ NOT NULL
  );
  CREATE TABLE route_traversals (
    id VARCHAR PRIMARY KEY, route_id VARCHAR NOT NULL, activity_id VARCHAR NOT NULL,
    started_at TIMESTAMPTZ NOT NULL, ended_at TIMESTAMPTZ NOT NULL, duration_sec DOUBLE NOT NULL,
    distance_m DOUBLE NOT NULL, avg_heart_rate DOUBLE, avg_speed DOUBLE, match_error_m DOUBLE NOT NULL,
    quality_score DOUBLE NOT NULL, lap_count INTEGER NOT NULL, lap_times_json VARCHAR NOT NULL
  );
  CREATE TABLE route_coverages (
    id VARCHAR PRIMARY KEY, route_id VARCHAR NOT NULL, activity_id VARCHAR NOT NULL,
    started_at TIMESTAMPTZ NOT NULL, ended_at TIMESTAMPTZ NOT NULL,
    start_distance_m DOUBLE NOT NULL, end_distance_m DOUBLE NOT NULL, quality_score DOUBLE NOT NULL
  );
  CREATE TABLE analysis_settings (config_json VARCHAR NOT NULL, analyzed_at TIMESTAMPTZ NOT NULL);
`)

export const publishRouteAnalysis = (database: DatabaseHost, analysis: DetectionResult, config: DetectionConfig, analyzedAt = new Date()) =>
  database.transaction(async (transaction) => {
    await transaction.execute('DROP TABLE IF EXISTS route_coverages; DROP TABLE IF EXISTS route_traversals; DROP TABLE IF EXISTS detected_routes; DROP TABLE IF EXISTS analysis_settings;')
    await createAnalysisTables(transaction)
    const routeColumns = ['id', 'name', 'type', 'sport', 'geometry_json', 'support_profile_json', 'distance_m', 'workout_count', 'traversal_count', 'match_score', 'popularity_score', 'overall_score', 'first_traversal_at', 'last_traversal_at']
    await transaction.bulkInsert('detected_routes', routeColumns, analysis.routes.map((route) => [
      route.id, route.name, route.type, route.sport, JSON.stringify(route.geometry), JSON.stringify(route.supportProfile), route.distanceM,
      route.workoutCount, route.traversalCount, route.matchScore, route.popularityScore, route.overallScore,
      databaseTimestamp(route.firstTraversalAt), databaseTimestamp(route.lastTraversalAt),
    ]))
    const traversalColumns = ['id', 'route_id', 'activity_id', 'started_at', 'ended_at', 'duration_sec', 'distance_m', 'avg_heart_rate', 'avg_speed', 'match_error_m', 'quality_score', 'lap_count', 'lap_times_json']
    await transaction.bulkInsert('route_traversals', traversalColumns, analysis.traversals.map((item) => [
      item.id, item.routeId, item.activityId, databaseTimestamp(item.startedAt), databaseTimestamp(item.endedAt), item.durationSec,
      item.distanceM, item.avgHeartRate, item.avgSpeed, item.matchErrorM, item.qualityScore, item.lapCount, JSON.stringify(item.lapTimesSec),
    ]))
    const coverageColumns = ['id', 'route_id', 'activity_id', 'started_at', 'ended_at', 'start_distance_m', 'end_distance_m', 'quality_score']
    await transaction.bulkInsert('route_coverages', coverageColumns, analysis.coverages.map((item) => [
      item.id, item.routeId, item.activityId, databaseTimestamp(item.startedAt), databaseTimestamp(item.endedAt),
      item.startDistanceM, item.endDistanceM, item.qualityScore,
    ]))
    await transaction.bulkInsert('analysis_settings', ['config_json', 'analyzed_at'], [[JSON.stringify(config), databaseTimestamp(analyzedAt)]])
    await transaction.execute('CREATE INDEX traversals_route_date ON route_traversals(route_id, started_at); CREATE INDEX coverages_route_date ON route_coverages(route_id, started_at);')
  })

export interface RouteAnalysisProgress {
  readonly phase: 'load-inputs' | 'detect-routes' | 'publish-results'
  readonly activities?: number
  readonly samples?: number
  readonly detection?: DetectionProgress
}

export interface RouteDetector {
  (activities: ReadonlyArray<NormalizedActivity>, config: DetectionConfig, onProgress?: DetectionProgressListener): Promise<DetectionResult> | DetectionResult
}

export const rebuildRouteAnalysis = async (database: DatabaseHost, overrides: Partial<DetectionConfig> = {}, options: {
  readonly detect?: RouteDetector
  readonly onProgress?: (progress: RouteAnalysisProgress) => void
} = {}) => {
  const config = resolveDetectionConfig(overrides)
  options.onProgress?.({ phase: 'load-inputs' })
  const activities = await readNormalizedActivities(database)
  options.onProgress?.({ phase: 'load-inputs', activities: activities.length, samples: activities.reduce((sum, activity) => sum + activity.samples.length, 0) })
  const analysis = await (options.detect ?? detectRoutes)(activities, config, (detection) => options.onProgress?.({ phase: 'detect-routes', activities: activities.length, detection }))
  options.onProgress?.({ phase: 'publish-results', activities: activities.length, samples: activities.reduce((sum, activity) => sum + activity.samples.length, 0) })
  await publishRouteAnalysis(database, analysis, config)
  return { activities: activities.length, routes: analysis.routes.length, traversals: analysis.traversals.length, config }
}

export const analyzeRoutes = async (database: DatabaseHost, overrides: Partial<DetectionConfig> = {}) => {
  const config = resolveDetectionConfig(overrides)
  const activities = await readNormalizedActivities(database)
  return { activities: activities.length, config, analysis: detectRoutes(activities, config) }
}
