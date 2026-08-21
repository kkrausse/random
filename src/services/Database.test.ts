import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Effect } from 'effect'

import { listActivities, rebuildDatabase } from './Database'
import { getAnalysisSettings, getDetectedRoute, listDetectedRoutes, rebuildRouteAnalysis } from './AnalysisDatabase'

let temporaryDirectory: string | undefined

afterEach(async () => {
  delete process.env.FITNESS_DATABASE_PATH
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true })
})

describe('Database', () => {
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
  })
})
