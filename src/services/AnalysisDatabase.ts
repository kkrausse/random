import path from 'node:path'
import { DuckDBInstance, DuckDBTimestampTZValue } from '@duckdb/node-api'
import type { DuckDBAppender, DuckDBValue } from '@duckdb/node-api'
import { Effect } from 'effect'

import type { ActivitySample, RoutePoint } from '../domain/activity'
import type { DetectedRoute, RouteDetail, RouteTraversal } from '../domain/analysis'
import { FitnessDataError } from './errors'
import type { ImportedActivity } from './Database'
import { detectRoutes } from './SegmentDetector'

const databasePath = () => path.resolve(process.env.FITNESS_DATABASE_PATH ?? 'data/fitness.duckdb')
const timestamp = (value: Date) => new DuckDBTimestampTZValue(BigInt(value.getTime()) * 1_000n)
const append = (appender: DuckDBAppender, value: DuckDBValue) => appender.appendValue(value)
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

const readNormalizedActivities = async (connection: Awaited<ReturnType<DuckDBInstance['connect']>>): Promise<ImportedActivity[]> => {
  const activityResult = await connection.runAndReadAll(`
    SELECT id, source_activity_id, sport, started_at::VARCHAR started_at,
      duration_seconds, distance_m, ascent_m, avg_hr_bpm, max_hr_bpm
    FROM activities ORDER BY started_at
  `)
  const sampleResult = await connection.runAndReadAll(`
    SELECT activity_id, timestamp::VARCHAR AS sample_timestamp, lat, lon, distance_m,
      altitude_m, speed_mps, heart_rate_bpm, cadence, power_w
    FROM activity_samples ORDER BY activity_id, timestamp
  `)
  const samples = new Map<string, ActivitySample[]>()
  for (const row of sampleResult.getRowObjectsJS()) {
    const id = String(row.activity_id)
    const values = samples.get(id) ?? []
    values.push({
      timestamp: row.sample_timestamp === null ? null : new Date(String(row.sample_timestamp)),
      lat: nullableNumber(row.lat),
      lon: nullableNumber(row.lon),
      distanceM: nullableNumber(row.distance_m),
      altitudeM: nullableNumber(row.altitude_m),
      speedMps: nullableNumber(row.speed_mps),
      heartRateBpm: nullableNumber(row.heart_rate_bpm),
      cadence: nullableNumber(row.cadence),
      powerW: nullableNumber(row.power_w),
    })
    samples.set(id, values)
  }
  return activityResult.getRowObjectsJS().map((row) => ({
    sourceActivityId: String(row.source_activity_id),
    sport: String(row.sport),
    startedAt: new Date(String(row.started_at)),
    durationSeconds: nullableNumber(row.duration_seconds),
    distanceM: nullableNumber(row.distance_m),
    ascentM: nullableNumber(row.ascent_m),
    avgHrBpm: nullableNumber(row.avg_hr_bpm),
    maxHrBpm: nullableNumber(row.max_hr_bpm),
    samples: samples.get(String(row.id)) ?? [],
  }))
}

const createAnalysisTables = (connection: Awaited<ReturnType<DuckDBInstance['connect']>>) => connection.run(`
  CREATE TABLE detected_routes (
    id VARCHAR PRIMARY KEY, name VARCHAR NOT NULL, type VARCHAR NOT NULL, sport VARCHAR NOT NULL,
    geometry_json VARCHAR NOT NULL, distance_m DOUBLE NOT NULL, workout_count INTEGER NOT NULL,
    traversal_count INTEGER NOT NULL, match_score DOUBLE NOT NULL, popularity_score DOUBLE NOT NULL,
    overall_score DOUBLE NOT NULL, first_traversal_at TIMESTAMPTZ NOT NULL, last_traversal_at TIMESTAMPTZ NOT NULL
  );
  CREATE TABLE route_traversals (
    id VARCHAR PRIMARY KEY, route_id VARCHAR NOT NULL, activity_id VARCHAR NOT NULL,
    started_at TIMESTAMPTZ NOT NULL, ended_at TIMESTAMPTZ NOT NULL, duration_sec DOUBLE NOT NULL,
    distance_m DOUBLE NOT NULL, avg_heart_rate DOUBLE, avg_speed DOUBLE, match_error_m DOUBLE NOT NULL,
    quality_score DOUBLE NOT NULL, lap_count INTEGER NOT NULL, lap_times_json VARCHAR NOT NULL
  );
`)

export const rebuildRouteAnalysis = Effect.tryPromise({
  try: () => withDatabase(async (connection) => {
    const activities = await readNormalizedActivities(connection)
    const analysis = detectRoutes(activities)
    await connection.run('BEGIN TRANSACTION; DROP TABLE IF EXISTS route_traversals; DROP TABLE IF EXISTS detected_routes;')
    try {
      await createAnalysisTables(connection)
      const routeAppender = await connection.createAppender('detected_routes')
      for (const route of analysis.routes) {
        for (const value of [route.id, route.name, route.type, route.sport, JSON.stringify(route.geometry), route.distanceM,
          route.workoutCount, route.traversalCount, route.matchScore, route.popularityScore, route.overallScore,
          timestamp(new Date(route.firstTraversalAt)), timestamp(new Date(route.lastTraversalAt))]) append(routeAppender, value)
        routeAppender.endRow()
      }
      routeAppender.closeSync()
      const traversalAppender = await connection.createAppender('route_traversals')
      for (const item of analysis.traversals) {
        for (const value of [item.id, item.routeId, item.activityId, timestamp(new Date(item.startedAt)), timestamp(new Date(item.endedAt)),
          item.durationSec, item.distanceM, item.avgHeartRate, item.avgSpeed, item.matchErrorM, item.qualityScore, item.lapCount,
          JSON.stringify(item.lapTimesSec)]) append(traversalAppender, value)
        traversalAppender.endRow()
      }
      traversalAppender.closeSync()
      await connection.run('CREATE INDEX traversals_route_date ON route_traversals(route_id, started_at); COMMIT;')
    } catch (error) {
      await connection.run('ROLLBACK')
      throw error
    }
    return { activities: activities.length, routes: analysis.routes.length, traversals: analysis.traversals.length }
  }),
  catch: (cause) => new FitnessDataError({ operation: 'rebuild route analysis', cause }),
})

const routeFromRow = (row: Record<string, unknown>): DetectedRoute => ({
  id: String(row.id), name: String(row.name), type: String(row.type) as DetectedRoute['type'], sport: String(row.sport),
  geometry: JSON.parse(String(row.geometry_json)) as RoutePoint[], distanceM: Number(row.distance_m),
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
    const traversals: RouteTraversal[] = result.getRowObjectsJS().map((item) => ({
      id: String(item.id), routeId: String(item.route_id), activityId: String(item.activity_id),
      startedAt: String(item.started_at), endedAt: String(item.ended_at), durationSec: Number(item.duration_sec),
      distanceM: Number(item.distance_m), avgHeartRate: nullableNumber(item.avg_heart_rate), avgSpeed: nullableNumber(item.avg_speed),
      matchErrorM: Number(item.match_error_m), qualityScore: Number(item.quality_score), lapCount: Number(item.lap_count),
      lapTimesSec: JSON.parse(String(item.lap_times_json)) as number[],
    }))
    return { ...routeFromRow(row), traversals }
  }),
  catch: (cause) => new FitnessDataError({ operation: 'query detected route', cause }),
})
