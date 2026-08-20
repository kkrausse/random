import { createHash } from 'node:crypto'

import type { ActivitySample, RoutePoint } from '../domain/activity'
import type { DetectedRoute, RouteTraversal, RouteType } from '../domain/analysis'
import type { ImportedActivity } from './Database'

export const DETECTION_DEFAULTS = {
  sampleSpacingM: 40,
  maxRouteDeviationM: 30,
  candidateCellM: 120,
  minSegmentDistanceM: 500,
  minLoopDistanceM: 200,
  maxLoopDistanceM: 3_000,
  loopClosureM: 40,
  minWorkoutCount: 3,
  maxRoutesPerSport: 12,
} as const

const SAMPLE_SPACING_M = DETECTION_DEFAULTS.sampleSpacingM
const MATCH_DISTANCE_M = DETECTION_DEFAULTS.maxRouteDeviationM
const MIN_SEGMENT_M = DETECTION_DEFAULTS.minSegmentDistanceM
const MIN_WORKOUTS = DETECTION_DEFAULTS.minWorkoutCount
const EARTH_RADIUS_M = 6_371_000

interface Point extends RoutePoint {
  readonly sample: ActivitySample
  readonly sourceIndex: number
}

interface Path {
  readonly activity: ImportedActivity
  readonly id: string
  readonly points: ReadonlyArray<Point>
}

interface Candidate {
  readonly type: RouteType
  readonly sport: string
  readonly geometry: ReadonlyArray<Point>
  readonly distanceM: number
}

interface Match {
  readonly startIndex: number
  readonly endIndex: number
  readonly coverage: number
  readonly errorM: number
}

const radians = (degrees: number) => degrees * Math.PI / 180

export const pointDistanceM = (a: RoutePoint, b: RoutePoint) => {
  const latitude = radians((a.lat + b.lat) / 2)
  const x = radians(b.lon - a.lon) * Math.cos(latitude)
  const y = radians(b.lat - a.lat)
  return Math.sqrt(x * x + y * y) * EARTH_RADIUS_M
}

const pathDistanceM = (points: ReadonlyArray<RoutePoint>) => {
  let distance = 0
  for (let index = 1; index < points.length; index += 1) {
    distance += pointDistanceM(points[index - 1]!, points[index]!)
  }
  return distance
}

const cell = (point: RoutePoint, sizeM: number) => {
  const y = Math.floor(point.lat * 111_320 / sizeM)
  const x = Math.floor(point.lon * 111_320 * Math.cos(radians(point.lat)) / sizeM)
  return `${x}:${y}`
}

const samplePath = (activity: ImportedActivity): Path | null => {
  const gps = activity.samples
    .map((sample, sourceIndex) => sample.lat === null || sample.lon === null ? null : ({
      lat: sample.lat,
      lon: sample.lon,
      sample,
      sourceIndex,
    }))
    .filter((point): point is Point => point !== null)
  if (gps.length < 2) return null

  const points: Point[] = [gps[0]!]
  for (const point of gps.slice(1, -1)) {
    if (pointDistanceM(points.at(-1)!, point) >= SAMPLE_SPACING_M) points.push(point)
  }
  if (pointDistanceM(points.at(-1)!, gps.at(-1)!) > 1) points.push(gps.at(-1)!)
  return { activity, id: `garmin:${activity.sourceActivityId}`, points }
}

const spatialIndex = (points: ReadonlyArray<RoutePoint>, sizeM: number = MATCH_DISTANCE_M) => {
  const index = new Map<string, number[]>()
  points.forEach((point, pointIndex) => {
    const key = cell(point, sizeM)
    index.set(key, [...(index.get(key) ?? []), pointIndex])
  })
  return index
}

const nearbyIndices = (point: RoutePoint, index: Map<string, number[]>, sizeM: number = MATCH_DISTANCE_M) => {
  const [x, y] = cell(point, sizeM).split(':').map(Number) as [number, number]
  const result: number[] = []
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) result.push(...(index.get(`${x + dx}:${y + dy}`) ?? []))
  }
  return result
}

const matchGeometry = (geometry: ReadonlyArray<RoutePoint>, path: Path): Match | null => {
  const index = spatialIndex(path.points)
  let previous = -1
  let first = -1
  let last = -1
  let matched = 0
  let error = 0

  for (const routePoint of geometry) {
    let bestIndex = -1
    let bestDistance: number = MATCH_DISTANCE_M
    for (const pathIndex of nearbyIndices(routePoint, index)) {
      if (pathIndex <= previous || pathIndex > previous + 5 && previous >= 0) continue
      const distance = pointDistanceM(routePoint, path.points[pathIndex]!)
      if (distance < bestDistance) {
        bestIndex = pathIndex
        bestDistance = distance
      }
    }
    if (bestIndex >= 0) {
      if (first < 0) first = bestIndex
      previous = bestIndex
      last = bestIndex
      matched += 1
      error += bestDistance
    }
  }

  const coverage = matched / geometry.length
  return coverage >= 0.8 && first >= 0 && last > first
    ? { startIndex: first, endIndex: last, coverage, errorM: error / matched }
    : null
}

const pairCandidates = (a: Path, b: Path): Candidate[] => {
  const index = spatialIndex(b.points)
  const matches = a.points.map((point) => {
    let nearest = -1
    let nearestDistance: number = MATCH_DISTANCE_M
    for (const candidate of nearbyIndices(point, index)) {
      const distance = pointDistanceM(point, b.points[candidate]!)
      if (distance < nearestDistance) {
        nearest = candidate
        nearestDistance = distance
      }
    }
    return nearest
  })

  const runs: Array<[number, number]> = []
  let start = -1
  let previousB = -1
  for (let aIndex = 0; aIndex <= matches.length; aIndex += 1) {
    const bIndex = matches[aIndex] ?? -1
    const continues = bIndex >= 0 && (previousB < 0 || bIndex > previousB && bIndex <= previousB + 5)
    if (continues) {
      if (start < 0) start = aIndex
      previousB = bIndex
    } else {
      if (start >= 0 && aIndex - start >= 2) runs.push([start, aIndex - 1])
      start = bIndex >= 0 ? aIndex : -1
      previousB = bIndex
    }
  }

  return runs.flatMap(([from, to]) => {
    const geometry = a.points.slice(from, to + 1)
    const distanceM = pathDistanceM(geometry)
    return distanceM >= MIN_SEGMENT_M ? [{ type: 'segment' as const, sport: a.activity.sport, geometry, distanceM }] : []
  })
}

const sameRoute = (a: Candidate, b: Candidate) => {
  if (a.type !== b.type || a.sport !== b.sport) return false
  const shorter = a.distanceM <= b.distanceM ? a : b
  const longer = shorter === a ? b : a
  if (shorter.distanceM / longer.distanceM < 0.5) return false
  const index = spatialIndex(longer.geometry, 75)
  const overlap = shorter.geometry.filter((point) => nearbyIndices(point, index, 75)
    .some((pointIndex) => pointDistanceM(point, longer.geometry[pointIndex]!) <= 75)).length / shorter.geometry.length
  return overlap >= 0.75
}

const traversal = (routeId: string, distanceM: number, path: Path, match: Match, type: RouteType, occurrence = 0): RouteTraversal | null => {
  const start = path.points[match.startIndex]!
  const end = path.points[match.endIndex]!
  const startedAt = start.sample.timestamp
  const endedAt = end.sample.timestamp
  if (!startedAt || !endedAt) return null
  const durationSec = (endedAt.getTime() - startedAt.getTime()) / 1000
  if (durationSec <= 0) return null
  const sourceSamples = path.activity.samples.slice(start.sourceIndex, end.sourceIndex + 1)
  const heartRates = sourceSamples.flatMap((sample) => sample.heartRateBpm === null ? [] : [sample.heartRateBpm])
  const avgHeartRate = heartRates.length === 0 ? null : heartRates.reduce((sum, value) => sum + value, 0) / heartRates.length
  const qualityScore = Math.max(0, Math.min(1, match.coverage * (1 - match.errorM / (MATCH_DISTANCE_M * 2))))

  return {
    id: `${routeId}:${path.id}:${occurrence}`,
    routeId,
    activityId: path.id,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationSec,
    distanceM,
    avgHeartRate,
    avgSpeed: distanceM / durationSec,
    matchErrorM: match.errorM,
    qualityScore,
    lapCount: type === 'loop' ? 1 : 0,
    lapTimesSec: type === 'loop' ? [durationSec] : [],
  }
}

export interface DetectionResult {
  readonly routes: ReadonlyArray<DetectedRoute>
  readonly traversals: ReadonlyArray<RouteTraversal>
}

export function detectRoutes(activities: ReadonlyArray<ImportedActivity>): DetectionResult {
  const paths = activities.map(samplePath).filter((path): path is Path => path !== null)
  const activityCells = paths.map((path) => new Set(path.points.map((point) => cell(point, DETECTION_DEFAULTS.candidateCellM))))
  const candidates: Candidate[] = []

  for (let a = 0; a < paths.length; a += 1) {
    for (let b = a + 1; b < paths.length; b += 1) {
      if (paths[a]!.activity.sport !== paths[b]!.activity.sport) continue
      let shared = 0
      for (const key of activityCells[a]!) if (activityCells[b]!.has(key)) shared += 1
      if (shared >= 4) candidates.push(...pairCandidates(paths[a]!, paths[b]!))
    }
  }

  for (const path of paths) {
    const distanceM = pathDistanceM(path.points)
    if (distanceM >= DETECTION_DEFAULTS.minLoopDistanceM && pointDistanceM(path.points[0]!, path.points.at(-1)!) <= DETECTION_DEFAULTS.loopClosureM) {
      candidates.push({ type: 'loop', sport: path.activity.sport, geometry: path.points, distanceM })
    }

    const cumulative = [0]
    for (let index = 1; index < path.points.length; index += 1) {
      cumulative.push(cumulative[index - 1]! + pointDistanceM(path.points[index - 1]!, path.points[index]!))
    }
    const index = spatialIndex(path.points, DETECTION_DEFAULTS.loopClosureM)
    for (let start = 0; start < path.points.length - 6; start += 3) {
      const closures = nearbyIndices(path.points[start]!, index, DETECTION_DEFAULTS.loopClosureM)
        .filter((end) => end > start + 5 && cumulative[end]! - cumulative[start]! >= DETECTION_DEFAULTS.minLoopDistanceM && cumulative[end]! - cumulative[start]! <= DETECTION_DEFAULTS.maxLoopDistanceM)
        .sort((a, b) => a - b)
      const end = closures[0]
      if (end !== undefined && pointDistanceM(path.points[start]!, path.points[end]!) <= DETECTION_DEFAULTS.loopClosureM) {
        const geometry = path.points.slice(start, end + 1)
        candidates.push({ type: 'loop', sport: path.activity.sport, geometry, distanceM: cumulative[end]! - cumulative[start]! })
      }
    }
  }

  candidates.sort((a, b) => b.distanceM - a.distanceM)
  const representatives: Candidate[] = []
  const representativeCounts = new Map<string, number>()
  for (const candidate of candidates) {
    const key = `${candidate.sport}:${candidate.type}`
    if ((representativeCounts.get(key) ?? 0) >= 60) continue
    if (!representatives.some((representative) => sameRoute(candidate, representative))) {
      representatives.push(candidate)
      representativeCounts.set(key, (representativeCounts.get(key) ?? 0) + 1)
    }
  }

  const routes: DetectedRoute[] = []
  const traversals: RouteTraversal[] = []
  for (const candidate of representatives) {
    const geometry = candidate.geometry.map(({ lat, lon }) => ({ lat, lon }))
    const type = candidate.type
    const hash = createHash('sha1')
      .update(`${candidate.sport}:${type}:${cell(geometry[0]!, 50)}:${cell(geometry.at(-1)!, 50)}:${Math.round(candidate.distanceM / 50)}`)
      .digest('hex').slice(0, 12)
    const id = `${type}-${hash}`
    const matches = paths
      .filter((path) => path.activity.sport === candidate.sport)
      .flatMap((path) => {
        if (type === 'segment') {
          const match = matchGeometry(geometry, path)
          const value = match && traversal(id, candidate.distanceM, path, match, type)
          return value ? [value] : []
        }

        const values: RouteTraversal[] = []
        let offset = 0
        while (offset < path.points.length - geometry.length * 0.7) {
          const remainder: Path = { ...path, points: path.points.slice(offset) }
          const match = matchGeometry(geometry, remainder)
          if (!match) break
          const translated = { ...match, startIndex: match.startIndex + offset, endIndex: match.endIndex + offset }
          const value = traversal(id, candidate.distanceM, path, translated, type, values.length)
          if (value) values.push(value)
          offset = translated.endIndex + 1
        }
        return values
      })
    if (new Set(matches.map((match) => match.activityId)).size < MIN_WORKOUTS) continue

    const matchScore = matches.reduce((sum, match) => sum + match.qualityScore, 0) / matches.length
    const workoutCount = new Set(matches.map((match) => match.activityId)).size
    const popularityScore = Math.min(1, Math.log1p(workoutCount) / Math.log(20))
    const dates = matches.map((match) => match.startedAt).sort()
    routes.push({
      id,
      name: `${candidate.sport[0]!.toUpperCase()}${candidate.sport.slice(1)} ${type} ${routes.length + 1}`,
      type,
      sport: candidate.sport,
      geometry,
      distanceM: candidate.distanceM,
      workoutCount,
      traversalCount: matches.length,
      matchScore,
      popularityScore,
      overallScore: matchScore * Math.log1p(workoutCount) * Math.log1p(candidate.distanceM),
      firstTraversalAt: dates[0]!,
      lastTraversalAt: dates.at(-1)!,
    })
    traversals.push(...matches)
  }

  routes.sort((a, b) => b.overallScore - a.overallScore)
  const sportCounts = new Map<string, number>()
  const selected = routes.filter((route) => {
    const count = sportCounts.get(route.sport) ?? 0
    if (count >= DETECTION_DEFAULTS.maxRoutesPerSport) return false
    sportCounts.set(route.sport, count + 1)
    return true
  }).slice(0, 50)
  const kept = new Set(selected.map((route) => route.id))
  const nameCounts = new Map<string, number>()
  const finalRoutes = routes.filter((route) => kept.has(route.id)).map((route) => {
    const key = `${route.sport}:${route.type}`
    const number = (nameCounts.get(key) ?? 0) + 1
    nameCounts.set(key, number)
    return { ...route, name: `${route.sport[0]!.toUpperCase()}${route.sport.slice(1)} ${route.type} ${number}` }
  })
  return {
    routes: finalRoutes,
    traversals: traversals.filter((item) => kept.has(item.routeId)),
  }
}
