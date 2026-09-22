import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Effect } from 'effect'

import { getActivity, listActivities, rebuildDatabase } from './Database'
import { getAnalysisSettings, getDetectedRoute, listDetectedRoutes, listWorkoutRouteMatches, rebuildRouteAnalysis } from './AnalysisDatabase'
import { withBunDuckDbHost } from '../hosts/bun/DuckDbHost'
import { databaseTimestamp } from '../engine/database'

let temporaryDirectory: string | undefined

afterEach(async () => {
  delete process.env.FITNESS_DATABASE_PATH
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true })
})

describe('Database', () => {
  test('Garmin rebuild retains normalized non-Garmin activities and provenance', async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'fitness-retention-db-'))
    process.env.FITNESS_DATABASE_PATH = path.join(temporaryDirectory, 'fitness.duckdb')
    await Effect.runPromise(rebuildDatabase([]))
    await withBunDuckDbHost(process.env.FITNESS_DATABASE_PATH, async (database) => database.transaction(async (transaction) => {
      await transaction.bulkInsert('activities', ['id', 'source', 'source_activity_id', 'sport', 'started_at', 'duration_seconds', 'distance_m', 'ascent_m', 'avg_hr_bpm', 'max_hr_bpm'], [[
        'iphone:ride-1', 'iphone-recorder', 'ride-1', 'cycling', databaseTimestamp('2026-01-01T00:00:00Z'), 10, 20, 0, null, null,
      ]])
      await transaction.bulkInsert('activity_samples', ['activity_id', 'timestamp', 'lat', 'lon', 'distance_m', 'altitude_m', 'speed_mps', 'heart_rate_bpm', 'cadence', 'power_w'], [[
        'iphone:ride-1', databaseTimestamp('2026-01-01T00:00:01Z'), 1, 2, 0, null, null, null, null, null,
      ]])
      await transaction.bulkInsert('normalization_sources', ['activity_id', 'source', 'source_activity_id', 'input_kind', 'normalization_version', 'source_version', 'observation_count', 'sample_count', 'normalized_at'], [[
        'iphone:ride-1', 'iphone-recorder', 'ride-1', 'saved-observations-v1', 'v1', 'source-v1', 3, 1, databaseTimestamp('2026-01-01T00:01:00Z'),
      ]])
    }))
    await Effect.runPromise(rebuildDatabase([]))
    expect((await Effect.runPromise(listActivities)).map((activity) => activity.id)).toEqual(['iphone:ride-1'])
    await withBunDuckDbHost(process.env.FITNESS_DATABASE_PATH, async (database) => {
      expect(Number((await database.query('SELECT count(*) count FROM normalization_sources'))[0]!.count)).toBe(1)
      expect(Number((await database.query('SELECT count(*) count FROM activity_samples'))[0]!.count)).toBe(1)
    })
  })

  test('round-trips activities and GPS samples through DuckDB', async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'fitness-db-'))
    process.env.FITNESS_DATABASE_PATH = path.join(temporaryDirectory, 'fitness.duckdb')

    await Effect.runPromise(rebuildDatabase([{
      sourceActivityId: '42',
      sport: 'running',
      startedAt: new Date('2026-08-19T12:00:00Z'),
      durationSeconds: 1200,
      distanceM: 5000,
      ascentM: 80,
      avgHrBpm: 155,
      maxHrBpm: 174,
      samples: [
        { timestamp: new Date('2026-08-19T12:00:00Z'), lat: 40.7, lon: -74, distanceM: 0, altitudeM: 10, speedMps: 4, heartRateBpm: 130, cadence: 80, powerW: null },
        { timestamp: new Date('2026-08-19T12:00:01Z'), lat: 40.701, lon: -74.001, distanceM: 4, altitudeM: 11, speedMps: 4, heartRateBpm: 131, cadence: 81, powerW: null },
      ],
    }]))

    const activities = await Effect.runPromise(listActivities)
    expect(activities).toHaveLength(1)
    expect(activities[0]?.id).toBe('garmin:42')
    expect(activities[0]?.distanceM).toBe(5000)
    expect(activities[0]?.route).toEqual([
      { lat: 40.7, lon: -74 },
      { lat: 40.701, lon: -74.001 },
    ])
    const detail = await Effect.runPromise(getActivity('garmin:42'))
    expect(detail?.samples).toHaveLength(2)
    expect(new Date(detail?.samples[1]?.timestamp ?? '').toISOString()).toBe('2026-08-19T12:00:01.000Z')
    expect(detail?.samples[1]).toMatchObject({
      distanceM: 4,
      heartRateBpm: 131,
      cadence: 81,
    })
    expect(await Effect.runPromise(getActivity('garmin:missing'))).toBeNull()

    const result = await Effect.runPromise(rebuildRouteAnalysis({ minWorkoutCount: 2, maxRoutesPerSport: 5 }))
    const settings = await Effect.runPromise(getAnalysisSettings)
    expect(result.routes).toBe(0)
    expect(settings.config.minWorkoutCount).toBe(2)
    expect(settings.config.maxRoutesPerSport).toBe(5)
    expect(settings.analyzedAt).not.toBeNull()
  })

  test('persists consensus support profiles and partial coverage observations', async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'fitness-analysis-db-'))
    process.env.FITNESS_DATABASE_PATH = path.join(temporaryDirectory, 'fitness.duckdb')
    const points = Array.from({ length: 11 }, (_, index) => [37, -122 + index * 0.00045] as const)
    const activities = [0, 0.00001, -0.00001].map((offset, activityIndex) => ({
      sourceActivityId: `full-${activityIndex}`,
      sport: 'running',
      startedAt: new Date('2026-08-19T12:00:00Z'),
      durationSeconds: 100,
      distanceM: 500,
      ascentM: 0,
      avgHrBpm: 150,
      maxHrBpm: 160,
      samples: points.map(([lat, lon], index) => ({
        timestamp: new Date(Date.UTC(2026, 7, 19, 12, 0, index * 10)), lat: lat + offset, lon,
        distanceM: index * 50, altitudeM: 0, speedMps: 5, heartRateBpm: 140, cadence: 80, powerW: null,
      })),
    }))
    activities.push({
      ...activities[0]!,
      sourceActivityId: 'middle',
      samples: activities[0]!.samples.slice(2, 9),
    })
    await Effect.runPromise(rebuildDatabase(activities))
    await Effect.runPromise(rebuildRouteAnalysis({ minSegmentDistanceM: 100 }))

    const routes = await Effect.runPromise(listDetectedRoutes)
    const segment = routes.find((route) => route.type === 'segment')!
    const detail = await Effect.runPromise(getDetectedRoute(segment.id))
    expect(detail?.workoutCount).toBe(3)
    expect(Math.max(...(detail?.supportProfile.map((point) => point.workoutCount) ?? []))).toBe(4)
    expect(detail?.coverages.some((item) => item.endDistanceM - item.startDistanceM < segment.distanceM * 0.9)).toBe(true)
    expect(detail?.traversals).toHaveLength(3)
    const workoutMatches = await Effect.runPromise(listWorkoutRouteMatches('garmin:full-0'))
    expect(workoutMatches.length).toBeGreaterThan(0)
    expect(workoutMatches.some((match) => match.routeId === segment.id && match.routeType === 'segment')).toBeTrue()
    const workoutSegment = workoutMatches.find((match) => match.routeId === segment.id)!
    expect(workoutSegment.routeSport).toBe(segment.sport)
    expect(workoutSegment.routeDistanceM).toBe(segment.distanceM)
    expect(workoutSegment.routeWorkoutCount).toBe(segment.workoutCount)
    expect(workoutSegment.routeTraversalCount).toBe(segment.traversalCount)
    expect(workoutSegment.routeMatchScore).toBe(segment.matchScore)
  })
})
