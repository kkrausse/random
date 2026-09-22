import type { Activity, RoutePoint, WorkoutDetail, WorkoutSample } from '../domain/activity'
import type { DetectedRoute, RouteCoverage, RouteDetail, RouteTraversal, WorkoutRouteMatch } from '../domain/analysis'
import type { DetectionConfig } from '../services/SegmentDetector'
import { DETECTION_DEFAULTS, resolveDetectionConfig } from '../services/SegmentDetector'
import type { DatabaseHost, DatabaseRow } from './database'

const nullableNumber = (value: unknown) => value === null || value === undefined ? null : Number(value)
const tableExists = async (database: DatabaseHost, table: string) => Number((await database.query(
  'SELECT count(*) count FROM information_schema.tables WHERE table_name = ?', [table],
))[0]?.count ?? 0) > 0

export const listArchiveActivities = async (database: DatabaseHost): Promise<Activity[]> => {
  if (!await tableExists(database, 'activities')) return []
  const [activities, routeRows] = await Promise.all([
    database.query(`SELECT id, source_activity_id, sport, started_at::VARCHAR AS started_at,
      duration_seconds, distance_m, ascent_m, avg_hr_bpm, max_hr_bpm FROM activities ORDER BY started_at DESC`),
    database.query(`WITH gps AS (
      SELECT activity_id, timestamp, lat, lon, row_number() OVER (PARTITION BY activity_id ORDER BY timestamp) point_number,
        count(*) OVER (PARTITION BY activity_id) point_count FROM activity_samples WHERE lat IS NOT NULL AND lon IS NOT NULL
    ) SELECT activity_id, lat, lon FROM gps WHERE point_number = 1 OR point_number = point_count
      OR point_number % greatest(ceil(point_count / 200.0)::BIGINT, 1) = 0 ORDER BY activity_id, timestamp`),
  ])
  const routes = new Map<string, RoutePoint[]>()
  for (const row of routeRows) {
    const id = String(row.activity_id)
    routes.set(id, [...(routes.get(id) ?? []), { lat: Number(row.lat), lon: Number(row.lon) }])
  }
  return activities.map((row) => ({
    id: String(row.id), sourceActivityId: String(row.source_activity_id), sport: String(row.sport), startedAt: String(row.started_at),
    durationSeconds: nullableNumber(row.duration_seconds), distanceM: nullableNumber(row.distance_m), ascentM: nullableNumber(row.ascent_m),
    avgHrBpm: nullableNumber(row.avg_hr_bpm), maxHrBpm: nullableNumber(row.max_hr_bpm), route: routes.get(String(row.id)) ?? [],
  }))
}

export const getArchiveActivity = async (database: DatabaseHost, id: string): Promise<WorkoutDetail | null> => {
  const rows = await database.query(`SELECT id, source_activity_id, sport, started_at::VARCHAR AS started_at,
    duration_seconds, distance_m, ascent_m, avg_hr_bpm, max_hr_bpm FROM activities WHERE id = ? LIMIT 1`, [id])
  const row = rows[0]
  if (!row) return null
  const samples: WorkoutSample[] = (await database.query(`SELECT timestamp::VARCHAR AS timestamp, lat, lon, distance_m,
    altitude_m, speed_mps, heart_rate_bpm, cadence, power_w FROM activity_samples
    WHERE activity_id = ? AND lat IS NOT NULL AND lon IS NOT NULL ORDER BY timestamp NULLS LAST`, [id])).map((sample) => ({
      timestamp: sample.timestamp === null ? null : String(sample.timestamp), lat: Number(sample.lat), lon: Number(sample.lon),
      distanceM: nullableNumber(sample.distance_m), altitudeM: nullableNumber(sample.altitude_m), speedMps: nullableNumber(sample.speed_mps),
      heartRateBpm: nullableNumber(sample.heart_rate_bpm), cadence: nullableNumber(sample.cadence), powerW: nullableNumber(sample.power_w),
    }))
  return {
    id: String(row.id), sourceActivityId: String(row.source_activity_id), sport: String(row.sport), startedAt: String(row.started_at),
    durationSeconds: nullableNumber(row.duration_seconds), distanceM: nullableNumber(row.distance_m), ascentM: nullableNumber(row.ascent_m),
    avgHrBpm: nullableNumber(row.avg_hr_bpm), maxHrBpm: nullableNumber(row.max_hr_bpm), samples,
  }
}

const routeFromRow = (row: DatabaseRow): DetectedRoute => ({
  id: String(row.id), name: String(row.name), type: String(row.type) as DetectedRoute['type'], sport: String(row.sport),
  geometry: JSON.parse(String(row.geometry_json)) as RoutePoint[], supportProfile: JSON.parse(String(row.support_profile_json ?? '[]')),
  distanceM: Number(row.distance_m), workoutCount: Number(row.workout_count), traversalCount: Number(row.traversal_count),
  matchScore: Number(row.match_score), popularityScore: Number(row.popularity_score), overallScore: Number(row.overall_score),
  firstTraversalAt: String(row.first_traversal_at), lastTraversalAt: String(row.last_traversal_at),
})

export interface ArchiveAnalysisSettings { readonly config: DetectionConfig; readonly analyzedAt: string | null }
export const getArchiveAnalysisSettings = async (database: DatabaseHost): Promise<ArchiveAnalysisSettings> => {
  if (!await tableExists(database, 'analysis_settings')) return { config: DETECTION_DEFAULTS, analyzedAt: null }
  const row = (await database.query('SELECT config_json, analyzed_at::VARCHAR analyzed_at FROM analysis_settings LIMIT 1'))[0]
  return row ? { config: resolveDetectionConfig(JSON.parse(String(row.config_json))), analyzedAt: String(row.analyzed_at) } : { config: DETECTION_DEFAULTS, analyzedAt: null }
}
export const listArchiveRoutes = async (database: DatabaseHost): Promise<DetectedRoute[]> => {
  if (!await tableExists(database, 'detected_routes')) return []
  return (await database.query(`SELECT *, first_traversal_at::VARCHAR first_traversal_at,
    last_traversal_at::VARCHAR last_traversal_at FROM detected_routes ORDER BY overall_score DESC`)).map(routeFromRow)
}

const traversalFromRow = (row: DatabaseRow, activityRoute: readonly RoutePoint[] = []): RouteTraversal => ({
  id: String(row.id), routeId: String(row.route_id), activityId: String(row.activity_id), startedAt: String(row.started_at), endedAt: String(row.ended_at),
  durationSec: Number(row.duration_sec), distanceM: Number(row.distance_m), avgHeartRate: nullableNumber(row.avg_heart_rate), avgSpeed: nullableNumber(row.avg_speed),
  matchErrorM: Number(row.match_error_m), qualityScore: Number(row.quality_score), lapCount: Number(row.lap_count),
  lapTimesSec: JSON.parse(String(row.lap_times_json)) as number[], activityRoute,
})

export const getArchiveRoute = async (database: DatabaseHost, id: string): Promise<RouteDetail | null> => {
  if (!await tableExists(database, 'detected_routes')) return null
  const routeRow = (await database.query(`SELECT *, first_traversal_at::VARCHAR first_traversal_at,
    last_traversal_at::VARCHAR last_traversal_at FROM detected_routes WHERE id = ?`, [id]))[0]
  if (!routeRow) return null
  const traversalRows = await database.query(`SELECT *, started_at::VARCHAR started_at, ended_at::VARCHAR ended_at
    FROM route_traversals WHERE route_id = ? ORDER BY started_at DESC`, [id])
  const activityRoutes = new Map<string, RoutePoint[]>()
  const activityRouteRows = await database.query(`WITH route_activities AS (
      SELECT DISTINCT activity_id FROM route_traversals WHERE route_id = ?
    ), gps AS (
      SELECT samples.activity_id, samples.timestamp, samples.lat, samples.lon,
        row_number() OVER (PARTITION BY samples.activity_id ORDER BY samples.timestamp) point_number,
        count(*) OVER (PARTITION BY samples.activity_id) point_count
      FROM activity_samples samples JOIN route_activities ON route_activities.activity_id = samples.activity_id
      WHERE samples.lat IS NOT NULL AND samples.lon IS NOT NULL
    ) SELECT activity_id, lat, lon FROM gps WHERE point_number = 1 OR point_number = point_count
      OR point_number % greatest(ceil(point_count / 200.0)::BIGINT, 1) = 0 ORDER BY activity_id, timestamp`, [id])
  for (const point of activityRouteRows) {
    const activityId = String(point.activity_id)
    activityRoutes.set(activityId, [...(activityRoutes.get(activityId) ?? []), { lat: Number(point.lat), lon: Number(point.lon) }])
  }
  const coverages: RouteCoverage[] = await tableExists(database, 'route_coverages') ? (await database.query(`SELECT *, started_at::VARCHAR started_at,
    ended_at::VARCHAR ended_at FROM route_coverages WHERE route_id = ? ORDER BY started_at DESC`, [id])).map((row) => ({
      id: String(row.id), routeId: String(row.route_id), activityId: String(row.activity_id), startedAt: String(row.started_at), endedAt: String(row.ended_at),
      startDistanceM: Number(row.start_distance_m), endDistanceM: Number(row.end_distance_m), qualityScore: Number(row.quality_score),
    })) : []
  return { ...routeFromRow(routeRow), traversals: traversalRows.map((row) => traversalFromRow(row, activityRoutes.get(String(row.activity_id)) ?? [])), coverages }
}

export const listArchiveWorkoutMatches = async (database: DatabaseHost, activityId: string): Promise<WorkoutRouteMatch[]> => {
  if (!await tableExists(database, 'detected_routes') || !await tableExists(database, 'route_traversals')) return []
  return (await database.query(`SELECT traversal.id traversal_id, route.id route_id, route.name route_name, route.type route_type,
    route.sport route_sport, route.distance_m route_distance_m, route.workout_count route_workout_count,
    route.traversal_count route_traversal_count, route.match_score route_match_score, route.geometry_json,
    traversal.started_at::VARCHAR started_at, traversal.ended_at::VARCHAR ended_at, traversal.duration_sec, traversal.distance_m,
    traversal.avg_heart_rate, traversal.avg_speed, traversal.quality_score, traversal.lap_count FROM route_traversals traversal
    JOIN detected_routes route ON route.id = traversal.route_id WHERE traversal.activity_id = ? ORDER BY traversal.started_at`, [activityId])).map((row) => ({
      traversalId: String(row.traversal_id), routeId: String(row.route_id), routeName: String(row.route_name), routeType: String(row.route_type) as WorkoutRouteMatch['routeType'],
      routeSport: String(row.route_sport), routeDistanceM: Number(row.route_distance_m), routeWorkoutCount: Number(row.route_workout_count),
      routeTraversalCount: Number(row.route_traversal_count), routeMatchScore: Number(row.route_match_score), geometry: JSON.parse(String(row.geometry_json)),
      startedAt: String(row.started_at), endedAt: String(row.ended_at), durationSec: Number(row.duration_sec), distanceM: Number(row.distance_m),
      avgHeartRate: nullableNumber(row.avg_heart_rate), avgSpeed: nullableNumber(row.avg_speed), qualityScore: Number(row.quality_score), lapCount: Number(row.lap_count),
    }))
}
