import path from 'node:path'
import { DuckDBInstance } from '@duckdb/node-api'
import { Effect } from 'effect'

import type { RoutePoint } from '../domain/activity'
import type { DetectedRoute, RouteCoverage, RouteDetail, RouteTraversal, WorkoutRouteMatch } from '../domain/analysis'
import { analyzeRoutes as analyzeRoutesWithHost, rebuildRouteAnalysis as rebuildRouteAnalysisWithHost } from '../engine/analysis'
import { withBunDuckDbHost } from '../hosts/bun/DuckDbHost'
import { FitnessDataError } from './errors'
import { DETECTION_DEFAULTS, resolveDetectionConfig } from './SegmentDetector'
import type { DetectionConfig } from './SegmentDetector'

const databasePath = () => path.resolve(process.env.FITNESS_DATABASE_PATH ?? 'data/fitness.duckdb')
const nullableNumber = (value: unknown) => value === null ? null : Number(value)

const withDatabase = async <A>(run: (connection: Awaited<ReturnType<DuckDBInstance['connect']>>) => Promise<A>) => {
  const instance = await DuckDBInstance.create(databasePath())
  const connection = await instance.connect()
  try {
    return await run(connection)
  } finally {
    connection.closeSync()
    instance.closeSync()
  }
}

const tableExists = async (connection: Awaited<ReturnType<DuckDBInstance['connect']>>, table: string) => {
  const result = await connection.runAndReadAll(`SELECT count(*) count FROM information_schema.tables WHERE table_name = '${table}'`)
  return Number(result.getRowObjectsJS()[0]?.count ?? 0) > 0
}

export const rebuildRouteAnalysis = (overrides: Partial<DetectionConfig> = {}) => Effect.tryPromise({
  try: () => withBunDuckDbHost(databasePath(), (database) => rebuildRouteAnalysisWithHost(database, overrides)),
  catch: (cause) => new FitnessDataError({ operation: 'rebuild route analysis', cause }),
})

export const analyzeRoutes = (overrides: Partial<DetectionConfig> = {}) => Effect.tryPromise({
  try: () => withBunDuckDbHost(databasePath(), (database) => analyzeRoutesWithHost(database, overrides)),
  catch: (cause) => new FitnessDataError({ operation: 'analyze routes', cause }),
})

export interface AnalysisSettings {
  readonly config: DetectionConfig
  readonly analyzedAt: string | null
}

export const getAnalysisSettings = Effect.tryPromise({
  try: () => withDatabase(async (connection): Promise<AnalysisSettings> => {
    if (!await tableExists(connection, 'analysis_settings')) return { config: DETECTION_DEFAULTS, analyzedAt: null }
    const result = await connection.runAndReadAll('SELECT config_json, analyzed_at::VARCHAR analyzed_at FROM analysis_settings LIMIT 1')
    const row = result.getRowObjectsJS()[0]
    if (!row) return { config: DETECTION_DEFAULTS, analyzedAt: null }
    return { config: resolveDetectionConfig(JSON.parse(String(row.config_json))), analyzedAt: String(row.analyzed_at) }
  }),
  catch: (cause) => new FitnessDataError({ operation: 'query analysis settings', cause }),
})

const routeFromRow = (row: Record<string, unknown>): DetectedRoute => ({
  id: String(row.id), name: String(row.name), type: String(row.type) as DetectedRoute['type'], sport: String(row.sport),
  geometry: JSON.parse(String(row.geometry_json)) as RoutePoint[],
  supportProfile: row.support_profile_json === undefined ? [] : JSON.parse(String(row.support_profile_json)),
  distanceM: Number(row.distance_m),
  workoutCount: Number(row.workout_count), traversalCount: Number(row.traversal_count), matchScore: Number(row.match_score),
  popularityScore: Number(row.popularity_score), overallScore: Number(row.overall_score),
  firstTraversalAt: String(row.first_traversal_at), lastTraversalAt: String(row.last_traversal_at),
})

export const listDetectedRoutes = Effect.tryPromise({
  try: () => withDatabase(async (connection): Promise<ReadonlyArray<DetectedRoute>> => {
    if (!await tableExists(connection, 'detected_routes')) return []
    const result = await connection.runAndReadAll(`SELECT *, first_traversal_at::VARCHAR first_traversal_at,
      last_traversal_at::VARCHAR last_traversal_at FROM detected_routes ORDER BY overall_score DESC`)
    return result.getRowObjectsJS().map(routeFromRow)
  }),
  catch: (cause) => new FitnessDataError({ operation: 'query detected routes', cause }),
})

export const listWorkoutRouteMatches = (activityId: string) => Effect.tryPromise({
  try: () => withDatabase(async (connection): Promise<ReadonlyArray<WorkoutRouteMatch>> => {
    if (!await tableExists(connection, 'detected_routes') || !await tableExists(connection, 'route_traversals')) return []
    const escapedId = activityId.replaceAll("'", "''")
    const result = await connection.runAndReadAll(`
      SELECT traversal.id AS traversal_id, route.id AS route_id, route.name AS route_name,
        route.type AS route_type, route.sport AS route_sport, route.distance_m AS route_distance_m,
        route.workout_count AS route_workout_count, route.traversal_count AS route_traversal_count,
        route.match_score AS route_match_score, route.geometry_json, traversal.started_at::VARCHAR AS started_at,
        traversal.ended_at::VARCHAR AS ended_at, traversal.duration_sec, traversal.distance_m,
        traversal.avg_heart_rate, traversal.avg_speed, traversal.quality_score, traversal.lap_count
      FROM route_traversals traversal
      JOIN detected_routes route ON route.id = traversal.route_id
      WHERE traversal.activity_id = '${escapedId}'
      ORDER BY traversal.started_at
    `)
    return result.getRowObjectsJS().map((row) => ({
      traversalId: String(row.traversal_id),
      routeId: String(row.route_id),
      routeName: String(row.route_name),
      routeType: String(row.route_type) as WorkoutRouteMatch['routeType'],
      routeSport: String(row.route_sport),
      routeDistanceM: Number(row.route_distance_m),
      routeWorkoutCount: Number(row.route_workout_count),
      routeTraversalCount: Number(row.route_traversal_count),
      routeMatchScore: Number(row.route_match_score),
      geometry: JSON.parse(String(row.geometry_json)) as RoutePoint[],
      startedAt: String(row.started_at),
      endedAt: String(row.ended_at),
      durationSec: Number(row.duration_sec),
      distanceM: Number(row.distance_m),
      avgHeartRate: nullableNumber(row.avg_heart_rate),
      avgSpeed: nullableNumber(row.avg_speed),
      qualityScore: Number(row.quality_score),
      lapCount: Number(row.lap_count),
    }))
  }),
  catch: (cause) => new FitnessDataError({ operation: 'query workout route matches', cause }),
})

export const getDetectedRoute = (id: string) => Effect.tryPromise({
  try: () => withDatabase(async (connection): Promise<RouteDetail | null> => {
    if (!await tableExists(connection, 'detected_routes')) return null
    const escapedId = id.replaceAll("'", "''")
    const routeResult = await connection.runAndReadAll(`SELECT *, first_traversal_at::VARCHAR first_traversal_at,
      last_traversal_at::VARCHAR last_traversal_at FROM detected_routes WHERE id = '${escapedId}'`)
    const row = routeResult.getRowObjectsJS()[0]
    if (!row) return null
    const result = await connection.runAndReadAll(`SELECT *, started_at::VARCHAR started_at, ended_at::VARCHAR ended_at
      FROM route_traversals WHERE route_id = '${escapedId}' ORDER BY started_at DESC`)
    const activityRouteResult = await connection.runAndReadAll(`
      WITH route_activities AS (
        SELECT DISTINCT activity_id FROM route_traversals WHERE route_id = '${escapedId}'
      ), gps AS (
        SELECT samples.activity_id, samples.timestamp, samples.lat, samples.lon,
          row_number() OVER (PARTITION BY samples.activity_id ORDER BY samples.timestamp) AS point_number,
          count(*) OVER (PARTITION BY samples.activity_id) AS point_count
        FROM activity_samples samples
        JOIN route_activities ON route_activities.activity_id = samples.activity_id
        WHERE samples.lat IS NOT NULL AND samples.lon IS NOT NULL
      )
      SELECT activity_id, lat, lon FROM gps
      WHERE point_number = 1
        OR point_number = point_count
        OR point_number % greatest(ceil(point_count / 200.0)::BIGINT, 1) = 0
      ORDER BY activity_id, timestamp
    `)
    const activityRoutes = new Map<string, RoutePoint[]>()
    for (const item of activityRouteResult.getRowObjectsJS()) {
      const activityId = String(item.activity_id)
      const points = activityRoutes.get(activityId) ?? []
      points.push({ lat: Number(item.lat), lon: Number(item.lon) })
      activityRoutes.set(activityId, points)
    }
    const traversals: RouteTraversal[] = result.getRowObjectsJS().map((item) => ({
      id: String(item.id), routeId: String(item.route_id), activityId: String(item.activity_id),
      startedAt: String(item.started_at), endedAt: String(item.ended_at), durationSec: Number(item.duration_sec),
      distanceM: Number(item.distance_m), avgHeartRate: nullableNumber(item.avg_heart_rate), avgSpeed: nullableNumber(item.avg_speed),
      matchErrorM: Number(item.match_error_m), qualityScore: Number(item.quality_score), lapCount: Number(item.lap_count),
      lapTimesSec: JSON.parse(String(item.lap_times_json)) as number[],
      activityRoute: activityRoutes.get(String(item.activity_id)) ?? [],
    }))
    const coverages: RouteCoverage[] = await tableExists(connection, 'route_coverages')
      ? (await connection.runAndReadAll(`SELECT *, started_at::VARCHAR started_at, ended_at::VARCHAR ended_at
          FROM route_coverages WHERE route_id = '${escapedId}' ORDER BY started_at DESC`)).getRowObjectsJS().map((item) => ({
            id: String(item.id), routeId: String(item.route_id), activityId: String(item.activity_id),
            startedAt: String(item.started_at), endedAt: String(item.ended_at),
            startDistanceM: Number(item.start_distance_m), endDistanceM: Number(item.end_distance_m), qualityScore: Number(item.quality_score),
          }))
      : []
    return { ...routeFromRow(row), traversals, coverages }
  }),
  catch: (cause) => new FitnessDataError({ operation: 'query detected route', cause }),
})
