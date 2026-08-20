import { describe, expect, test } from 'bun:test'

import type { ImportedActivity } from './Database'
import { detectRoutes, pointDistanceM } from './SegmentDetector'

const activity = (id: string, offset: number): ImportedActivity => ({
  sourceActivityId: id,
  sport: 'running',
  startedAt: new Date('2026-01-01T00:00:00Z'),
  durationSeconds: 300,
  distanceM: 800,
  ascentM: 0,
  avgHrBpm: 150,
  maxHrBpm: 170,
  samples: Array.from({ length: 21 }, (_, index) => ({
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, index * 15)),
    lat: 37 + offset,
    lon: -122 + index * 0.00045,
    distanceM: index * 40,
    altitudeM: 0,
    speedMps: 3,
    heartRateBpm: 145 + index / 2,
    cadence: 80,
    powerW: null,
  })),
})

describe('segment detection', () => {
  test('finds a same-direction route repeated across three workouts', () => {
    const activities = [activity('1', 0), activity('2', 0.00001), activity('3', -0.00001)]
    const result = detectRoutes(activities)
    expect(result.routes.length).toBeGreaterThan(0)
    expect(result.routes[0]?.workoutCount).toBe(3)
    expect(result.routes[0]?.type).toBe('segment')
    expect(result.traversals).toHaveLength(3)
    expect(detectRoutes(activities, { minWorkoutCount: 4 }).routes).toHaveLength(0)
  })

  test('calculates geographic distance', () => {
    expect(pointDistanceM({ lat: 0, lon: 0 }, { lat: 0, lon: 0.001 })).toBeWithin(110, 112)
  })

  test('classifies a closed route repeated across three workouts as a loop', () => {
    const loop = (id: string, offset: number): ImportedActivity => ({
      ...activity(id, offset),
      samples: Array.from({ length: 33 }, (_, index) => {
        const angle = index / 32 * Math.PI * 2
        return {
          timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, index * 5)),
          lat: 37 + offset + Math.sin(angle) * 0.001,
          lon: -122 + Math.cos(angle) * 0.00125,
          distanceM: index * 25,
          altitudeM: 0,
          speedMps: 5,
          heartRateBpm: 150,
          cadence: 80,
          powerW: null,
        }
      }),
    })
    const result = detectRoutes([loop('1', 0), loop('2', 0.00001), loop('3', -0.00001)])
    expect(result.routes.some((route) => route.type === 'loop' && route.workoutCount === 3)).toBe(true)
  })
})
