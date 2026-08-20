import { createHash } from 'node:crypto'

import type { ActivitySample, RoutePoint } from '../domain/activity'
import type { DetectedRoute, RouteTraversal, RouteType } from '../domain/analysis'
import type { ImportedActivity } from './Database'

export interface DetectionConfig {
  readonly maxRouteDeviationM: number
  readonly candidateCellM: number
  readonly minSegmentDistanceM: number
  readonly minLoopDistanceM: number
  readonly maxLoopDistanceM: number
  readonly loopClosureM: number
  readonly minWorkoutCount: number
  readonly maxRoutesPerSport: number
}

export const DETECTION_DEFAULTS: DetectionConfig = {
  maxRouteDeviationM: 30,
  candidateCellM: 120,
  minSegmentDistanceM: 500,
  minLoopDistanceM: 200,
  maxLoopDistanceM: 3_000,
  loopClosureM: 40,
  minWorkoutCount: 3,
  maxRoutesPerSport: 12,
}

export const resolveDetectionConfig = (overrides: Partial<DetectionConfig> = {}): DetectionConfig => {
  const { sampleSpacingM: _legacySampleSpacing, ...supportedOverrides } = overrides as Partial<DetectionConfig> & { sampleSpacingM?: unknown }
  const config = { ...DETECTION_DEFAULTS, ...supportedOverrides }
  const ranges: Record<keyof DetectionConfig, readonly [number, number]> = {
    maxRouteDeviationM: [5, 200],
    candidateCellM: [20, 1_000],
    minSegmentDistanceM: [100, 20_000],
    minLoopDistanceM: [100, 10_000],
    maxLoopDistanceM: [200, 50_000],
    loopClosureM: [5, 500],
    minWorkoutCount: [2, 100],
    maxRoutesPerSport: [1, 100],
  }
  for (const [key, [minimum, maximum]] of Object.entries(ranges) as Array<[keyof DetectionConfig, readonly [number, number]]>) {
    if (!Number.isFinite(config[key]) || config[key] < minimum || config[key] > maximum) {
      throw new Error(`${key} must be between ${minimum} and ${maximum}`)
    }
  }
  for (const key of ['minWorkoutCount', 'maxRoutesPerSport'] as const) {
    if (!Number.isInteger(config[key])) throw new Error(`${key} must be an integer`)
  }
  if (config.maxLoopDistanceM < config.minLoopDistanceM) throw new Error('Maximum loop distance must be at least the minimum loop distance')
  return config
}

const EARTH_RADIUS_M = 6_371_000
// Dense enough for the matching tolerance while keeping dynamic alignment tractable on the full archive.
const SAMPLE_SPACING_M = 40

interface Point extends RoutePoint {
  readonly sample: ActivitySample
  readonly sourcePosition: number
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
  readonly endpointErrorM: number
}

interface QualifiedCandidate extends Candidate {
  readonly matches: ReadonlyArray<{ path: Path, match: Match }>
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
  for (let index = 1; index < points.length; index += 1) distance += pointDistanceM(points[index - 1]!, points[index]!)
  return distance
}

const cellCoordinates = (point: RoutePoint, sizeM: number): readonly [number, number] => {
  const y = Math.floor(point.lat * 111_320 / sizeM)
  const x = Math.floor(point.lon * 111_320 * Math.cos(radians(point.lat)) / sizeM)
  return [x, y]
}

const cell = (point: RoutePoint, sizeM: number) => cellCoordinates(point, sizeM).join(':')

const interpolateSample = (a: Point, b: Point, fraction: number): Point => {
  const timestamp = a.sample.timestamp && b.sample.timestamp
    ? new Date(a.sample.timestamp.getTime() + (b.sample.timestamp.getTime() - a.sample.timestamp.getTime()) * fraction)
    : fraction < 0.5 ? a.sample.timestamp : b.sample.timestamp
  const interpolateValue = (first: number | null, second: number | null) => first !== null && second !== null
    ? first + (second - first) * fraction
    : fraction < 0.5 ? first : second
  return {
    lat: a.lat + (b.lat - a.lat) * fraction,
    lon: a.lon + (b.lon - a.lon) * fraction,
    sourcePosition: a.sourcePosition + (b.sourcePosition - a.sourcePosition) * fraction,
    sample: {
      timestamp,
      distanceM: interpolateValue(a.sample.distanceM, b.sample.distanceM),
      altitudeM: interpolateValue(a.sample.altitudeM, b.sample.altitudeM),
      speedMps: interpolateValue(a.sample.speedMps, b.sample.speedMps),
      heartRateBpm: interpolateValue(a.sample.heartRateBpm, b.sample.heartRateBpm),
      cadence: interpolateValue(a.sample.cadence, b.sample.cadence),
      powerW: interpolateValue(a.sample.powerW, b.sample.powerW),
      lat: a.lat + (b.lat - a.lat) * fraction,
      lon: a.lon + (b.lon - a.lon) * fraction,
    },
  }
}

const samplePaths = (activity: ImportedActivity): Path[] => {
  const gps = activity.samples.flatMap((sample, sourcePosition) => sample.lat === null || sample.lon === null ? [] : [{
    lat: sample.lat, lon: sample.lon, sample, sourcePosition,
  }])
  if (gps.length < 2) return []

  const chunks: Point[][] = [[]]
  for (const point of gps) {
    const previous = chunks.at(-1)!.at(-1)
    if (previous) {
      const distance = pointDistanceM(previous, point)
      const elapsedSec = previous.sample.timestamp && point.sample.timestamp
        ? (point.sample.timestamp.getTime() - previous.sample.timestamp.getTime()) / 1000
        : null
      const discontinuity = distance > Math.max(500, SAMPLE_SPACING_M * 12)
        || elapsedSec !== null && (elapsedSec <= 0 || elapsedSec > 300 || distance / elapsedSec > 55)
      if (discontinuity) chunks.push([])
    }
    chunks.at(-1)!.push(point)
  }

  return chunks.flatMap((chunk, chunkIndex) => {
    if (chunk.length < 2) return []
    const sampled: Point[] = [chunk[0]!]
    let target = SAMPLE_SPACING_M
    let cumulative = 0
    for (let index = 1; index < chunk.length; index += 1) {
      const from = chunk[index - 1]!
      const to = chunk[index]!
      const edge = pointDistanceM(from, to)
      if (edge === 0) continue
      while (target <= cumulative + edge) {
        sampled.push(interpolateSample(from, to, (target - cumulative) / edge))
        target += SAMPLE_SPACING_M
      }
      cumulative += edge
    }
    if (pointDistanceM(sampled.at(-1)!, chunk.at(-1)!) > 1) sampled.push(chunk.at(-1)!)
    return sampled.length < 2 ? [] : [{ activity, id: `garmin:${activity.sourceActivityId}:${chunkIndex}`, points: sampled }]
  })
}

const spatialIndex = (points: ReadonlyArray<RoutePoint>, sizeM: number) => {
  const index = new Map<string, number[]>()
  points.forEach((point, pointIndex) => {
    const key = cell(point, sizeM)
    const values = index.get(key)
    if (values) values.push(pointIndex)
    else index.set(key, [pointIndex])
  })
  return index
}

const nearbyIndices = (point: RoutePoint, index: Map<string, number[]>, sizeM: number, radiusM = sizeM) => {
  const [x, y] = cellCoordinates(point, sizeM)
  const reach = Math.max(1, Math.ceil(radiusM / sizeM))
  const result: number[] = []
  for (let dx = -reach; dx <= reach; dx += 1) {
    for (let dy = -reach; dy <= reach; dy += 1) result.push(...(index.get(`${x + dx}:${y + dy}`) ?? []))
  }
  return result
}

const alignFrom = (geometry: ReadonlyArray<RoutePoint>, path: Path, startIndex: number, config: DetectionConfig): Match | null => {
  const firstError = pointDistanceM(geometry[0]!, path.points[startIndex]!)
  if (firstError > config.maxRouteDeviationM) return null

  interface AlignmentState {
    readonly pathIndex: number
    readonly matched: number
    readonly error: number
    readonly consecutiveMisses: number
  }
  let states: AlignmentState[] = [{ pathIndex: startIndex, matched: 1, error: firstError, consecutiveMisses: 0 }]
  for (let geometryIndex = 1; geometryIndex < geometry.length; geometryIndex += 1) {
    const next = new Map<string, AlignmentState>()
    const keep = (state: AlignmentState) => {
      const key = `${state.pathIndex}:${state.consecutiveMisses}`
      const existing = next.get(key)
      if (!existing || state.matched > existing.matched || state.matched === existing.matched && state.error < existing.error) next.set(key, state)
    }
    for (const state of states) {
      if (state.consecutiveMisses < 2 && geometryIndex < geometry.length - 1) {
        keep({ ...state, consecutiveMisses: state.consecutiveMisses + 1 })
      }
      for (let pathIndex = state.pathIndex + 1; pathIndex <= Math.min(path.points.length - 1, state.pathIndex + 4); pathIndex += 1) {
        const distance = pointDistanceM(geometry[geometryIndex]!, path.points[pathIndex]!)
        if (distance <= config.maxRouteDeviationM) {
          keep({ pathIndex, matched: state.matched + 1, error: state.error + distance, consecutiveMisses: 0 })
        }
      }
    }
    // Keep alternate branches around intersections without letting long routes grow a quadratic state set.
    states = [...next.values()]
      .sort((a, b) => b.matched - a.matched || a.error / a.matched - b.error / b.matched)
      .slice(0, 24)
    if (states.length === 0) return null
  }
  const best = states
    .filter((state) => state.consecutiveMisses === 0 && state.pathIndex > startIndex && state.matched / geometry.length >= 0.8)
    .sort((a, b) => b.matched - a.matched || a.error / a.matched - b.error / b.matched)[0]
  if (!best) return null
  const endError = pointDistanceM(geometry.at(-1)!, path.points[best.pathIndex]!)
  return {
    startIndex,
    endIndex: best.pathIndex,
    coverage: best.matched / geometry.length,
    errorM: best.error / best.matched,
    endpointErrorM: (firstError + endError) / 2,
  }
}

const rotateLoop = <T>(points: ReadonlyArray<T>, offset: number): T[] => [...points.slice(offset), ...points.slice(0, offset), points[offset]!]

const findMatches = (geometry: ReadonlyArray<RoutePoint>, path: Path, type: RouteType, config: DetectionConfig, cachedPathIndex?: Map<string, number[]>): Match[] => {
  if (type === 'loop') {
    const ring = geometry.slice(0, -1)
    const geometryIndex = spatialIndex(ring, config.maxRouteDeviationM)
    const found: Match[] = []
    let pathStart = 0
    while (pathStart < path.points.length - ring.length * 0.75) {
      const phases = nearbyIndices(path.points[pathStart]!, geometryIndex, config.maxRouteDeviationM)
        .map((phase) => ({ phase, distance: pointDistanceM(path.points[pathStart]!, ring[phase]!) }))
        .filter(({ distance }) => distance <= config.maxRouteDeviationM)
        .sort((a, b) => a.distance - b.distance)
      let best: Match | null = null
      for (const { phase } of phases) {
        const match = alignFrom(rotateLoop(ring, phase), path, pathStart, config)
        if (match && (!best || match.coverage > best.coverage || match.coverage === best.coverage && match.errorM < best.errorM)) best = match
      }
      if (best) {
        found.push(best)
        // Consecutive laps share their finish/start sample.
        pathStart = best.endIndex
      } else pathStart += 1
    }
    return found
  }

  const pathIndex = cachedPathIndex ?? spatialIndex(path.points, config.maxRouteDeviationM)
  const found: Match[] = []
  for (const start of nearbyIndices(geometry[0]!, pathIndex, config.maxRouteDeviationM)) {
    const match = alignFrom(geometry, path, start, config)
    if (match) found.push(match)
  }
  found.sort((a, b) => a.startIndex - b.startIndex || b.coverage - a.coverage || a.errorM - b.errorM)
  const nonoverlapping: Match[] = []
  for (const match of found) {
    const previous = nonoverlapping.at(-1)
    if (!previous || match.startIndex > previous.endIndex) nonoverlapping.push(match)
    else if (match.startIndex === previous.startIndex && (match.coverage > previous.coverage || match.errorM < previous.errorM)) nonoverlapping[nonoverlapping.length - 1] = match
  }
  return nonoverlapping
}

const pairCandidates = (a: Path, b: Path, config: DetectionConfig): Candidate[] => {
  const index = spatialIndex(b.points, config.maxRouteDeviationM)
  const nearest = (point: RoutePoint, after = -1) => {
    let nearest = -1
    let nearestDistance = config.maxRouteDeviationM
    for (const candidate of nearbyIndices(point, index, config.maxRouteDeviationM)) {
      if (candidate <= after || after >= 0 && candidate > after + 4) continue
      const distance = pointDistanceM(point, b.points[candidate]!)
      if (distance <= nearestDistance) {
        nearest = candidate
        nearestDistance = distance
      }
    }
    return nearest
  }

  const runs: Array<[number, number]> = []
  let start = -1
  let previousB = -1
  let misses = 0
  for (let aIndex = 0; aIndex <= a.points.length; aIndex += 1) {
    const bIndex = aIndex < a.points.length ? nearest(a.points[aIndex]!, previousB) : -1
    const continues = bIndex >= 0
    if (continues) {
      if (start < 0) start = aIndex
      previousB = bIndex
      misses = 0
    } else if (aIndex < a.points.length && start >= 0 && misses < 1) {
      misses += 1
    } else {
      const end = aIndex - misses - 1
      if (start >= 0 && end > start) runs.push([start, end])
      const restart = aIndex < a.points.length ? nearest(a.points[aIndex]!) : -1
      start = restart >= 0 ? aIndex : -1
      previousB = restart
      misses = 0
    }
  }
  return runs.flatMap(([from, to]) => {
    const geometry = a.points.slice(from, to + 1)
    const distanceM = pathDistanceM(geometry)
    return distanceM >= config.minSegmentDistanceM ? [{ type: 'segment' as const, sport: a.activity.sport, geometry, distanceM }] : []
  })
}

const quantizedGeometry = (geometry: ReadonlyArray<RoutePoint>) => geometry
  .map((point) => `${Math.round(point.lat * 1e5)},${Math.round(point.lon * 1e5)}`).join(';')

const canonicalLoop = (candidate: Candidate): Candidate => {
  if (candidate.type !== 'loop') return candidate
  const ring = candidate.geometry.slice(0, -1)
  const tokens = ring.map((point) => `${Math.round(point.lat * 1e5)},${Math.round(point.lon * 1e5)}`)
  // Booth's algorithm finds the lexicographically minimal directed rotation in linear time.
  let first = 0
  let second = 1
  let offset = 0
  while (first < tokens.length && second < tokens.length && offset < tokens.length) {
    const a = tokens[(first + offset) % tokens.length]!
    const b = tokens[(second + offset) % tokens.length]!
    if (a === b) {
      offset += 1
      continue
    }
    if (a > b) {
      first += offset + 1
      if (first === second) first += 1
    } else {
      second += offset + 1
      if (first === second) second += 1
    }
    offset = 0
  }
  const start = Math.min(first, second)
  const best = [...ring.slice(start), ...ring.slice(0, start)]
  return { ...candidate, geometry: [...best, best[0]!] }
}

const directedSimilarity = (a: Candidate, b: Candidate, config: DetectionConfig) => {
  if (a.type !== b.type || a.sport !== b.sport || Math.min(a.distanceM, b.distanceM) / Math.max(a.distanceM, b.distanceM) < 0.75) return false
  const shorter = a.geometry.length <= b.geometry.length ? a : b
  const longer = shorter === a ? b : a
  const fakePath: Path = { activity: null as unknown as ImportedActivity, id: '', points: longer.geometry as ReadonlyArray<Point> }
  if (shorter.type === 'segment') return alignFrom(shorter.geometry, fakePath, 0, { ...config, maxRouteDeviationM: Math.max(config.maxRouteDeviationM, 50) }) !== null
  const ring = shorter.geometry.slice(0, -1)
  const index = spatialIndex(ring, 50)
  return nearbyIndices(longer.geometry[0]!, index, 50).some((phase) =>
    alignFrom(rotateLoop(ring, phase), fakePath, 0, { ...config, maxRouteDeviationM: Math.max(config.maxRouteDeviationM, 50) }) !== null)
}

const segmentContains = (container: Candidate, contained: Candidate, config: DetectionConfig) => {
  if (container.type !== 'segment' || contained.type !== 'segment' || container.sport !== contained.sport) return false
  if (container.distanceM + SAMPLE_SPACING_M < contained.distanceM) return false
  const path: Path = { activity: null as unknown as ImportedActivity, id: '', points: container.geometry as ReadonlyArray<Point> }
  return findMatches(contained.geometry, path, 'segment', { ...config, maxRouteDeviationM: Math.max(config.maxRouteDeviationM, 50) }).length > 0
}

const consolidationAnchor = (candidate: Candidate): RoutePoint => {
  if (candidate.type === 'segment') return candidate.geometry[0]!
  const ring = candidate.geometry.slice(0, -1)
  return {
    lat: ring.reduce((sum, point) => sum + point.lat, 0) / ring.length,
    lon: ring.reduce((sum, point) => sum + point.lon, 0) / ring.length,
  }
}

const strictSameCandidate = (a: Candidate, b: Candidate, config: DetectionConfig) => {
  if (a.type !== b.type || a.sport !== b.sport) return false
  if (Math.min(a.distanceM, b.distanceM) / Math.max(a.distanceM, b.distanceM) < 0.95) return false
  if (Math.abs(a.distanceM - b.distanceM) > SAMPLE_SPACING_M * 2) return false
  if (Math.abs(a.geometry.length - b.geometry.length) > 2) return false
  const tolerance = Math.min(25, Math.max(8, config.maxRouteDeviationM * 0.75))
  const checks = Math.min(12, a.geometry.length, b.geometry.length)
  for (let index = 0; index < checks; index += 1) {
    const aIndex = Math.round(index * (a.geometry.length - 1) / Math.max(1, checks - 1))
    const bIndex = Math.round(index * (b.geometry.length - 1) / Math.max(1, checks - 1))
    if (pointDistanceM(a.geometry[aIndex]!, b.geometry[bIndex]!) > tolerance) return false
  }
  return true
}

const consolidateCandidates = (candidates: ReadonlyArray<Candidate>, config: DetectionConfig) => {
  const representatives: Candidate[] = []
  const buckets = new Map<string, number[]>()
  for (const raw of candidates) {
    if (raw.type === 'loop' && raw.distanceM > config.maxLoopDistanceM) continue
    const candidate = canonicalLoop(raw)
    const anchor = consolidationAnchor(candidate)
    const [x, y] = cellCoordinates(anchor, 200)
    const nearby: number[] = []
    for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) {
      nearby.push(...(buckets.get(`${candidate.sport}:${candidate.type}:${x + dx}:${y + dy}`) ?? []))
    }
    if (nearby.some((index) => strictSameCandidate(candidate, representatives[index]!, config))) continue
    const representativeIndex = representatives.length
    representatives.push(candidate)
    const key = `${candidate.sport}:${candidate.type}:${x}:${y}`
    const values = buckets.get(key)
    if (values) values.push(representativeIndex)
    else buckets.set(key, [representativeIndex])
  }
  return representatives
}

const routeId = (candidate: Candidate) => {
  const normalized = canonicalLoop(candidate)
  const hash = createHash('sha256')
    .update(`${normalized.sport}:${normalized.type}:${quantizedGeometry(normalized.geometry)}`)
    .digest('hex').slice(0, 20)
  return `${candidate.type}-${hash}`
}

const timeWeightedHeartRate = (samples: ReadonlyArray<ActivitySample>, startedAt: Date, endedAt: Date) => {
  const values = samples.filter((sample) => sample.timestamp && sample.heartRateBpm !== null)
  let weighted = 0
  let duration = 0
  for (let index = 0; index < values.length; index += 1) {
    const current = values[index]!
    const from = Math.max(startedAt.getTime(), current.timestamp!.getTime())
    const to = Math.min(endedAt.getTime(), values[index + 1]?.timestamp?.getTime() ?? endedAt.getTime())
    if (to > from) {
      weighted += current.heartRateBpm! * (to - from)
      duration += to - from
    }
  }
  return duration > 0 ? weighted / duration : null
}

const traversal = (id: string, path: Path, match: Match, type: RouteType, config: DetectionConfig, occurrence: number): RouteTraversal | null => {
  const start = path.points[match.startIndex]!
  const end = path.points[match.endIndex]!
  const startedAt = start.sample.timestamp
  const endedAt = end.sample.timestamp
  if (!startedAt || !endedAt) return null
  const durationSec = (endedAt.getTime() - startedAt.getTime()) / 1000
  if (durationSec <= 0) return null
  const distanceM = pathDistanceM(path.points.slice(match.startIndex, match.endIndex + 1))
  if (distanceM <= 0) return null
  const sourceSamples = path.activity.samples.slice(Math.floor(start.sourcePosition), Math.ceil(end.sourcePosition) + 1)
  const avgHeartRate = timeWeightedHeartRate(sourceSamples, startedAt, endedAt)
  const errorScore = 1 - (match.errorM + match.endpointErrorM) / (config.maxRouteDeviationM * 2)
  const qualityScore = Math.max(0, Math.min(1, match.coverage * errorScore))
  return {
    id: `${id}:garmin:${path.activity.sourceActivityId}:${occurrence}`,
    routeId: id,
    activityId: `garmin:${path.activity.sourceActivityId}`,
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

export function detectRoutes(activities: ReadonlyArray<ImportedActivity>, overrides: Partial<DetectionConfig> = {}): DetectionResult {
  const config = resolveDetectionConfig(overrides)
  const paths = activities.flatMap(samplePaths)
  const pathSpatialIndexes = paths.map((path) => spatialIndex(path.points, config.maxRouteDeviationM))
  const bySportCell = new Map<string, number[]>()
  paths.forEach((path, pathIndex) => {
    for (const key of new Set(path.points.map((point) => cell(point, config.candidateCellM)))) {
      const sportKey = `${path.activity.sport}:${key}`
      const values = bySportCell.get(sportKey)
      if (values) values.push(pathIndex)
      else bySportCell.set(sportKey, [pathIndex])
    }
  })

  const candidatePairs = new Set<string>()
  paths.forEach((path, pathIndex) => {
    for (const point of path.points) {
      const [x, y] = cellCoordinates(point, config.candidateCellM)
      for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) {
        for (const other of bySportCell.get(`${path.activity.sport}:${x + dx}:${y + dy}`) ?? []) {
          if (other > pathIndex && paths[other]!.activity.sourceActivityId !== path.activity.sourceActivityId) candidatePairs.add(`${pathIndex}:${other}`)
        }
      }
    }
  })

  const candidates: Candidate[] = []
  for (const pair of candidatePairs) {
    const [a, b] = pair.split(':').map(Number) as [number, number]
    candidates.push(...pairCandidates(paths[a]!, paths[b]!, config))
  }

  for (const path of paths) {
    const cumulative = [0]
    for (let index = 1; index < path.points.length; index += 1) cumulative.push(cumulative[index - 1]! + pointDistanceM(path.points[index - 1]!, path.points[index]!))
    const index = spatialIndex(path.points, config.loopClosureM)
    for (let start = 0; start < path.points.length - 2; start += 1) {
      const closures = nearbyIndices(path.points[start]!, index, config.loopClosureM)
        .filter((end) => {
          const distanceM = cumulative[end]! - cumulative[start]!
          return end > start + 1 && distanceM >= config.minLoopDistanceM && distanceM <= config.maxLoopDistanceM
            && pointDistanceM(path.points[start]!, path.points[end]!) <= config.loopClosureM
        })
        .sort((a, b) => a - b)
      const closureEvents: number[] = []
      for (const end of closures) {
        const previous = closureEvents.at(-1)
        if (previous === undefined || end > previous + 2) closureEvents.push(end)
        else if (pointDistanceM(path.points[start]!, path.points[end]!) < pointDistanceM(path.points[start]!, path.points[previous]!)) {
          closureEvents[closureEvents.length - 1] = end
        }
      }
      // A later return to the same point is another lap, not a larger loop.
      for (const end of closureEvents.slice(0, 1)) {
        const distanceM = cumulative[end]! - cumulative[start]!
        const geometry = [...path.points.slice(start, end), path.points[start]!]
        candidates.push({ type: 'loop', sport: path.activity.sport, geometry, distanceM: Math.min(distanceM, pathDistanceM(geometry)) })
      }
    }
  }

  // This only merges near-identical, equal-length directed sequences. Meaningfully shorter candidates remain independent
  // until after workout support is known, so an unsupported long route cannot suppress a supported sub-route.
  const consolidatedCandidates = consolidateCandidates(candidates, config)

  const qualified: QualifiedCandidate[] = []
  for (const candidate of consolidatedCandidates) {
    const geometry = candidate.geometry.map(({ lat, lon }) => ({ lat, lon }))
    const pathsNear = (point: RoutePoint) => {
      const result = new Set<number>()
      const [x, y] = cellCoordinates(point, config.candidateCellM)
      const reach = Math.max(1, Math.ceil(config.maxRouteDeviationM / config.candidateCellM))
      for (let dx = -reach; dx <= reach; dx += 1) for (let dy = -reach; dy <= reach; dy += 1) {
        for (const pathIndex of bySportCell.get(`${candidate.sport}:${x + dx}:${y + dy}`) ?? []) result.add(pathIndex)
      }
      return result
    }
    let nearbyPaths: Set<number>
    if (candidate.type === 'segment') {
      nearbyPaths = pathsNear(candidate.geometry[0]!)
      const endPaths = pathsNear(candidate.geometry.at(-1)!)
      for (const pathIndex of nearbyPaths) if (!endPaths.has(pathIndex)) nearbyPaths.delete(pathIndex)
    } else {
      nearbyPaths = new Set<number>()
      for (const point of candidate.geometry) for (const pathIndex of pathsNear(point)) nearbyPaths.add(pathIndex)
    }
    const matches = [...nearbyPaths]
      .flatMap((pathIndex) => {
        const path = paths[pathIndex]!
        return findMatches(geometry, path, candidate.type, config, pathSpatialIndexes[pathIndex]).map((match) => ({ path, match }))
      })
    if (new Set(matches.map(({ path }) => path.activity.sourceActivityId)).size >= config.minWorkoutCount) qualified.push({ ...candidate, matches })
  }

  qualified.sort((a, b) => {
    if (a.type === 'segment' && b.type === 'segment') return b.distanceM - a.distanceM || b.matches.length - a.matches.length
    return b.matches.length - a.matches.length || b.distanceM - a.distanceM
  })
  const representatives: QualifiedCandidate[] = []
  for (const candidate of qualified) {
    const duplicate = representatives.some((representative) => candidate.type === 'segment'
      ? segmentContains(representative, candidate, config)
      : directedSimilarity(candidate, representative, config))
    if (!duplicate) representatives.push(candidate)
  }

  const routes: DetectedRoute[] = []
  const traversals: RouteTraversal[] = []
  for (const candidate of representatives) {
    const normalized = canonicalLoop(candidate)
    const geometry = normalized.geometry.map(({ lat, lon }) => ({ lat, lon }))
    const id = routeId(normalized)
    const occurrences = new Map<string, number>()
    const values = candidate.matches.flatMap(({ path, match }) => {
      const activityId = path.activity.sourceActivityId
      const occurrence = occurrences.get(activityId) ?? 0
      occurrences.set(activityId, occurrence + 1)
      const value = traversal(id, path, match, candidate.type, config, occurrence)
      return value ? [value] : []
    })
    const workoutCount = new Set(values.map((value) => value.activityId)).size
    if (workoutCount < config.minWorkoutCount) continue
    const byActivity = new Map<string, RouteTraversal[]>()
    for (const value of values) byActivity.set(value.activityId, [...(byActivity.get(value.activityId) ?? []), value])
    const workoutDistances = [...byActivity.values()].map((items) => items.reduce((sum, item) => sum + item.distanceM, 0) / items.length)
    const workoutQualities = [...byActivity.values()].map((items) => items.reduce((sum, item) => sum + item.qualityScore, 0) / items.length)
    const distanceM = workoutDistances.reduce((sum, value) => sum + value, 0) / workoutDistances.length
    const matchScore = workoutQualities.reduce((sum, value) => sum + value, 0) / workoutQualities.length
    const popularityScore = Math.min(1, Math.log1p(workoutCount) / Math.log(20))
    const dates = values.map((value) => value.startedAt).sort()
    routes.push({
      id,
      name: '',
      type: candidate.type,
      sport: candidate.sport,
      geometry,
      distanceM,
      workoutCount,
      traversalCount: values.length,
      matchScore,
      popularityScore,
      overallScore: matchScore * Math.log1p(workoutCount) * Math.log1p(distanceM),
      firstTraversalAt: dates[0]!,
      lastTraversalAt: dates.at(-1)!,
    })
    traversals.push(...values)
  }

  routes.sort((a, b) => b.overallScore - a.overallScore)
  const selectedIds = new Set<string>()
  for (const sport of new Set(routes.map((route) => route.sport))) {
    for (const type of ['segment', 'loop'] as const) {
      for (const route of routes.filter((item) => item.sport === sport && item.type === type).slice(0, config.maxRoutesPerSport)) {
        selectedIds.add(route.id)
      }
    }
  }
  const selected = routes.filter((route) => selectedIds.has(route.id)).slice(0, 50)
  const kept = new Set(selected.map((route) => route.id))
  const nameCounts = new Map<string, number>()
  const finalRoutes = selected.map((route) => {
    const key = `${route.sport}:${route.type}`
    const number = (nameCounts.get(key) ?? 0) + 1
    nameCounts.set(key, number)
    return { ...route, name: `${route.sport[0]!.toUpperCase()}${route.sport.slice(1)} ${route.type} ${number}` }
  })
  return { routes: finalRoutes, traversals: traversals.filter((item) => kept.has(item.routeId)) }
}
