import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Effect } from 'effect'

import { listActivities, rebuildDatabase } from './Database'

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
  })
})
