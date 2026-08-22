import { mkdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { DuckDBInstance, DuckDBTimestampTZValue } from '@duckdb/node-api'
import type { DuckDBAppender, DuckDBValue } from '@duckdb/node-api'
import { Effect, Schema } from 'effect'

import { Activity } from '../domain/activity'
import type { DecodedActivity, RoutePoint, WorkoutDetail, WorkoutSample } from '../domain/activity'
import { FitnessDataError } from './errors'

export interface ImportedActivity extends DecodedActivity {
  readonly sourceActivityId: string
}

const databasePath = () =>
  path.resolve(process.env.FITNESS_DATABASE_PATH ?? 'data/fitness.duckdb')

const timestamp = (value: Date) =>
  new DuckDBTimestampTZValue(BigInt(value.getTime()) * 1_000n)

const append = (appender: DuckDBAppender, value: DuckDBValue) => {
  appender.appendValue(value)
}

export const rebuildDatabase = (activities: ReadonlyArray<ImportedActivity>) =>
  Effect.tryPromise({
    try: async () => {
      const destination = databasePath()
      const temporary = `${destination}.building`
      await mkdir(path.dirname(destination), { recursive: true })
      await rm(temporary, { force: true })

      const instance = await DuckDBInstance.create(temporary)
      const connection = await instance.connect()
      try {
        await connection.run(`
          CREATE TABLE activities (
            id VARCHAR PRIMARY KEY,
            source VARCHAR NOT NULL,
            source_activity_id VARCHAR NOT NULL,
            sport VARCHAR NOT NULL,
            started_at TIMESTAMPTZ NOT NULL,
            duration_seconds DOUBLE,
            distance_m DOUBLE,
            ascent_m DOUBLE,
            avg_hr_bpm DOUBLE,
            max_hr_bpm DOUBLE
          );
          CREATE TABLE activity_samples (
            activity_id VARCHAR NOT NULL,
            timestamp TIMESTAMPTZ,
            lat DOUBLE,
            lon DOUBLE,
            distance_m DOUBLE,
            altitude_m DOUBLE,
            speed_mps DOUBLE,
            heart_rate_bpm DOUBLE,
            cadence DOUBLE,
            power_w DOUBLE
          );
        `)

        const activityAppender = await connection.createAppender('activities')
        for (const activity of activities) {
          for (const value of [
            `garmin:${activity.sourceActivityId}`,
            'garmin',
            activity.sourceActivityId,
            activity.sport,
            timestamp(activity.startedAt),
            activity.durationSeconds,
            activity.distanceM,
            activity.ascentM,
            activity.avgHrBpm,
            activity.maxHrBpm,
          ]) append(activityAppender, value)
          activityAppender.endRow()
        }
        activityAppender.closeSync()

        const sampleAppender = await connection.createAppender('activity_samples')
        for (const activity of activities) {
          for (const sample of activity.samples) {
            for (const value of [
              `garmin:${activity.sourceActivityId}`,
              sample.timestamp ? timestamp(sample.timestamp) : null,
              sample.lat,
              sample.lon,
              sample.distanceM,
              sample.altitudeM,
              sample.speedMps,
              sample.heartRateBpm,
              sample.cadence,
              sample.powerW,
            ]) append(sampleAppender, value)
            sampleAppender.endRow()
          }
        }
        sampleAppender.closeSync()
        await connection.run('CREATE INDEX samples_activity_time ON activity_samples(activity_id, timestamp)')
      } finally {
        connection.closeSync()
        instance.closeSync()
      }

      await rename(temporary, destination)
    },
    catch: (cause) => new FitnessDataError({ operation: 'rebuild DuckDB', cause }),
  })

export const listActivities = Effect.tryPromise({
  try: async (): Promise<ReadonlyArray<Activity>> => {
    const location = databasePath()
    const instance = await DuckDBInstance.create(location)
    const connection = await instance.connect()
    try {
      const tableCheck = await connection.runAndReadAll(`
        SELECT count(*) AS count
        FROM information_schema.tables
        WHERE table_name = 'activities'
      `)
      if (Number(tableCheck.getRowObjectsJS()[0]?.count ?? 0) === 0) return []

      const activityResult = await connection.runAndReadAll(`
        SELECT id, source_activity_id, sport,
          started_at::VARCHAR AS started_at,
          duration_seconds, distance_m, ascent_m, avg_hr_bpm, max_hr_bpm
        FROM activities
        ORDER BY started_at DESC
      `)
      const routeResult = await connection.runAndReadAll(`
        WITH gps AS (
          SELECT activity_id, timestamp, lat, lon,
            row_number() OVER (PARTITION BY activity_id ORDER BY timestamp) AS point_number,
            count(*) OVER (PARTITION BY activity_id) AS point_count
          FROM activity_samples
          WHERE lat IS NOT NULL AND lon IS NOT NULL
        )
        SELECT activity_id, lat, lon
        FROM gps
        WHERE point_number = 1
          OR point_number = point_count
          OR point_number % greatest(ceil(point_count / 200.0)::BIGINT, 1) = 0
        ORDER BY activity_id, timestamp
      `)
      const routes = new Map<string, RoutePoint[]>()
      for (const row of routeResult.getRowObjectsJS()) {
        const id = String(row.activity_id)
        const points = routes.get(id) ?? []
        points.push({ lat: Number(row.lat), lon: Number(row.lon) })
        routes.set(id, points)
      }

      const nullableNumber = (value: unknown) => value === null ? null : Number(value)
      return Schema.decodeUnknownSync(Schema.Array(Activity))(
        activityResult.getRowObjectsJS().map((row) => ({
          id: String(row.id),
          sourceActivityId: String(row.source_activity_id),
          sport: String(row.sport),
          startedAt: String(row.started_at),
          durationSeconds: nullableNumber(row.duration_seconds),
          distanceM: nullableNumber(row.distance_m),
          ascentM: nullableNumber(row.ascent_m),
          avgHrBpm: nullableNumber(row.avg_hr_bpm),
          maxHrBpm: nullableNumber(row.max_hr_bpm),
          route: routes.get(String(row.id)) ?? [],
        })),
      )
    } finally {
      connection.closeSync()
      instance.closeSync()
    }
  },
  catch: (cause) => new FitnessDataError({ operation: 'query DuckDB', cause }),
})

export const getActivity = (id: string) => Effect.tryPromise({
  try: async (): Promise<WorkoutDetail | null> => {
    const instance = await DuckDBInstance.create(databasePath())
    const connection = await instance.connect()
    try {
      const escapedId = id.replaceAll("'", "''")
      const activityResult = await connection.runAndReadAll(`
        SELECT id, source_activity_id, sport, started_at::VARCHAR AS started_at,
          duration_seconds, distance_m, ascent_m, avg_hr_bpm, max_hr_bpm
        FROM activities
        WHERE id = '${escapedId}'
        LIMIT 1
      `)
      const activity = activityResult.getRowObjectsJS()[0]
      if (!activity) return null

      const sampleResult = await connection.runAndReadAll(`
        SELECT timestamp::VARCHAR AS timestamp, lat, lon, distance_m, altitude_m,
          speed_mps, heart_rate_bpm, cadence, power_w
        FROM activity_samples
        WHERE activity_id = '${escapedId}' AND lat IS NOT NULL AND lon IS NOT NULL
        ORDER BY timestamp NULLS LAST
      `)
      const nullableNumber = (value: unknown) => value === null ? null : Number(value)
      const samples: WorkoutSample[] = sampleResult.getRowObjectsJS().map((sample) => ({
        timestamp: sample.timestamp === null ? null : String(sample.timestamp),
        lat: Number(sample.lat),
        lon: Number(sample.lon),
        distanceM: nullableNumber(sample.distance_m),
        altitudeM: nullableNumber(sample.altitude_m),
        speedMps: nullableNumber(sample.speed_mps),
        heartRateBpm: nullableNumber(sample.heart_rate_bpm),
        cadence: nullableNumber(sample.cadence),
        powerW: nullableNumber(sample.power_w),
      }))

      return {
        id: String(activity.id),
        sourceActivityId: String(activity.source_activity_id),
        sport: String(activity.sport),
        startedAt: String(activity.started_at),
        durationSeconds: nullableNumber(activity.duration_seconds),
        distanceM: nullableNumber(activity.distance_m),
        ascentM: nullableNumber(activity.ascent_m),
        avgHrBpm: nullableNumber(activity.avg_hr_bpm),
        maxHrBpm: nullableNumber(activity.max_hr_bpm),
        samples,
      }
    } finally {
      connection.closeSync()
      instance.closeSync()
    }
  },
  catch: (cause) => new FitnessDataError({ operation: 'query workout detail', cause }),
})
