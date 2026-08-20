import { describe, expect, test } from 'bun:test'

import type { ImportedActivity } from './Database'
import { detectRoutes, pointDistanceM, resolveDetectionConfig } from './SegmentDetector'

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

const routeActivity = (id: string, points: ReadonlyArray<readonly [number, number]>, seconds = 10): ImportedActivity => ({
  sourceActivityId: id,
  sport: 'running',
  startedAt: new Date('2026-01-01T00:00:00Z'),
  durationSeconds: (points.length - 1) * seconds,
  distanceM: null,
  ascentM: 0,
  avgHrBpm: 150,
  maxHrBpm: 160,
  samples: points.map(([lat, lon], index) => ({
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, index * seconds)),
    lat,
    lon,
    distanceM: null,
    altitudeM: 0,
    speedMps: null,
    heartRateBpm: 140 + index,
    cadence: 80,
    powerW: null,
  })),
})

const eastbound = (latitude: number, repeats = 1) => {
  const one = Array.from({ length: 11 }, (_, index) => [latitude, -122 + index * 0.00045] as const)
  return repeats === 1 ? one : Array.from({ length: repeats }, () => one).flat()
}

const circle = (phase: number, radius = 0.0012) => Array.from({ length: 33 }, (_, index) => {
  const angle = phase + index / 32 * Math.PI * 2
  return [37 + Math.sin(angle) * radius, -122 + Math.cos(angle) * radius] as const
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

  test('matches loops recorded from different start phases with one directed ID', () => {
    const result = detectRoutes([
      routeActivity('phase-1', circle(0)),
      routeActivity('phase-2', circle(Math.PI / 2)),
      routeActivity('phase-3', circle(Math.PI)),
    ], { minSegmentDistanceM: 2_000 })
    const loops = result.routes.filter((route) => route.type === 'loop')
    expect(loops).toHaveLength(1)
    expect(loops[0]?.workoutCount).toBe(3)
  })

  test('finds a configured 100m segment across neighboring candidate grid cells', () => {
    const tracks = [0, 0.00001, -0.00001].map((offset, index) => routeActivity(`boundary-${index}`, [
      [0.00089 + offset, -0.00001],
      [0.00089 + offset, 0.00044],
      [0.00089 + offset, 0.00089],
      [0.00089 + offset, 0.00134],
    ]))
    const result = detectRoutes(tracks, { minSegmentDistanceM: 100, candidateCellM: 100, sampleSpacingM: 20 })
    expect(result.routes.some((route) => route.type === 'segment' && route.workoutCount === 3)).toBe(true)
  })

  test('does not emit whole loops beyond maxLoopDistanceM', () => {
    const result = detectRoutes([
      routeActivity('large-1', circle(0, 0.0015)),
      routeActivity('large-2', circle(0.01, 0.0015)),
      routeActivity('large-3', circle(-0.01, 0.0015)),
    ], { maxLoopDistanceM: 500, minSegmentDistanceM: 2_000 })
    expect(result.routes.filter((route) => route.type === 'loop')).toHaveLength(0)
  })

  test('uses the matched interval for traversal metrics instead of the whole workout', () => {
    const routes = [0, 0.00001, -0.00001].map((offset, index) => routeActivity(`partial-${index}`, [
      [37 + offset, -122.001],
      ...eastbound(37 + offset),
      [37 + offset, -121.9945],
    ]))
    const result = detectRoutes(routes, { minSegmentDistanceM: 300 })
    const traversal = result.traversals[0]!
    expect(traversal.distanceM).toBeLessThan(1_000)
    expect(traversal.avgSpeed).toBeCloseTo(traversal.distanceM / traversal.durationSec)
  })

  test('detects every nonoverlapping occurrence of a segment', () => {
    const routes = [0, 0.00001, -0.00001].map((offset, index) => routeActivity(`single-${index}`, eastbound(37 + offset)))
    routes.push(routeActivity('repeat', eastbound(37, 2)))
    const result = detectRoutes(routes, { minSegmentDistanceM: 300 })
    const segment = result.routes.filter((route) => route.type === 'segment').sort((a, b) => b.traversalCount - a.traversalCount)[0]
    expect(segment?.workoutCount).toBe(4)
    expect(segment?.traversalCount).toBe(5)
  })

  test('keeps reverse direction as a distinct geometry-derived segment', () => {
    const forward = [0, 0.00001, -0.00001].map((offset, index) => routeActivity(`forward-${index}`, eastbound(37 + offset)))
    const reverse = [0, 0.00001, -0.00001].map((offset, index) => routeActivity(`reverse-${index}`, [...eastbound(37 + offset)].reverse()))
    const result = detectRoutes([...forward, ...reverse], { minSegmentDistanceM: 300 })
    const segments = result.routes.filter((route) => route.type === 'segment')
    expect(segments).toHaveLength(2)
    expect(new Set(segments.map((route) => route.id)).size).toBe(2)
    expect(segments.every((route) => route.workoutCount === 3)).toBe(true)
  })

  test('keeps distinct same-length loops with the same endpoint cells', () => {
    const tangentCircle = (side: 1 | -1) => Array.from({ length: 33 }, (_, index) => {
      const angle = index / 32 * Math.PI * 2
      return [
        37 + side * 0.0012 - side * Math.cos(angle) * 0.0012,
        -122 + Math.sin(angle) * 0.0015,
      ] as const
    })
    const north = [1, 2, 3].map((id) => routeActivity(`north-${id}`, tangentCircle(1)))
    const south = [1, 2, 3].map((id) => routeActivity(`south-${id}`, tangentCircle(-1)))
    const loops = detectRoutes([...north, ...south], { minSegmentDistanceM: 2_000 }).routes.filter((route) => route.type === 'loop')
    expect(loops).toHaveLength(2)
    expect(new Set(loops.map((route) => route.id)).size).toBe(2)
  })

  test('does not bridge a long missing middle section', () => {
    const complete = eastbound(37)
    const broken = complete.map(([lat, lon], index) => [index >= 4 && index <= 7 ? lat + 0.001 : lat, lon] as const)
    const result = detectRoutes([
      routeActivity('complete-1', complete),
      routeActivity('complete-2', complete),
      routeActivity('broken', broken),
    ], { minSegmentDistanceM: 300 })
    expect(result.routes.filter((route) => route.type === 'segment')).toHaveLength(0)
  })

  test('validates count settings as integers while allowing fractional distance settings', () => {
    expect(() => resolveDetectionConfig({ minWorkoutCount: 2.5 })).toThrow('minWorkoutCount must be an integer')
    expect(() => resolveDetectionConfig({ maxRoutesPerSport: 3.5 })).toThrow('maxRoutesPerSport must be an integer')
    expect(resolveDetectionConfig({ sampleSpacingM: 20.5 }).sampleSpacingM).toBe(20.5)
  })
})
