import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { Effect } from 'effect'

import type { RoutePoint } from '../domain/activity'
import type { DetectedRoute } from '../domain/analysis'
import { analyzeRoutes } from '../services/AnalysisDatabase'
import type { DetectionConfig } from '../services/SegmentDetector'
import { pointDistanceM } from '../services/SegmentDetector'

interface RouteSnapshot extends DetectedRoute {
  readonly workoutIds: ReadonlyArray<string>
}

interface ExperimentSnapshot {
  readonly createdAt: string
  readonly durationMs: number
  readonly activityCount: number
  readonly config: DetectionConfig
  readonly routes: ReadonlyArray<RouteSnapshot>
}

const values = new Map<string, string>()
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index]!
  const value = process.argv[index + 1]
  if (key.startsWith('--') && value && !value.startsWith('--')) {
    values.set(key.slice(2), value)
    index += 1
  }
}

const label = values.get('label') ?? new Date().toISOString().replaceAll(/[:.]/g, '-')
const overrides = JSON.parse(values.get('config') ?? '{}') as Partial<DetectionConfig>
const outputDirectory = path.resolve('data/analysis-experiments')
const startedAt = performance.now()
const result = await Effect.runPromise(analyzeRoutes(overrides))
const workoutIds = new Map<string, Set<string>>()
for (const traversal of result.analysis.traversals) {
  const ids = workoutIds.get(traversal.routeId) ?? new Set<string>()
  ids.add(traversal.activityId)
  workoutIds.set(traversal.routeId, ids)
}
const snapshot: ExperimentSnapshot = {
  createdAt: new Date().toISOString(),
  durationMs: performance.now() - startedAt,
  activityCount: result.activities,
  config: result.config,
  routes: result.analysis.routes.map((route) => ({ ...route, workoutIds: [...(workoutIds.get(route.id) ?? [])].sort() })),
}
await mkdir(outputDirectory, { recursive: true })
const outputPath = path.join(outputDirectory, `${label}.json`)
await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`)

const routeErrorM = (a: ReadonlyArray<RoutePoint>, b: ReadonlyArray<RoutePoint>) => {
  const directed = (from: ReadonlyArray<RoutePoint>, to: ReadonlyArray<RoutePoint>) => from.reduce((sum, point) =>
    sum + Math.min(...to.map((other) => pointDistanceM(point, other))), 0) / from.length
  return (directed(a, b) + directed(b, a)) / 2
}

const jaccard = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) => {
  const first = new Set(a)
  const intersection = b.filter((value) => first.has(value)).length
  return intersection / Math.max(1, new Set([...a, ...b]).size)
}

console.log(`${label}: ${snapshot.activityCount} activities, ${snapshot.routes.length} routes, ${result.analysis.traversals.length} traversals in ${(snapshot.durationMs / 1_000).toFixed(2)}s`)
console.log(`Saved ${path.relative(process.cwd(), outputPath)}`)

const baselineName = values.get('baseline')
if (baselineName) {
  const baselinePath = path.join(outputDirectory, `${baselineName}.json`)
  const baseline = JSON.parse(await readFile(baselinePath, 'utf8')) as ExperimentSnapshot
  const comparisons = snapshot.routes.map((route) => {
    const matches = baseline.routes
      .filter((item) => item.type === route.type && item.sport === route.sport)
      .map((item) => ({ item, errorM: routeErrorM(route.geometry, item.geometry) }))
      .sort((a, b) => a.errorM - b.errorM)
    const nearest = matches[0]
    return {
      route: route.name,
      baseline: nearest?.item.name ?? '-',
      geometryErrorM: nearest ? Math.round(nearest.errorM) : null,
      supportJaccard: nearest ? Number(jaccard(route.workoutIds, nearest.item.workoutIds).toFixed(2)) : null,
      workouts: `${nearest?.item.workoutCount ?? 0} -> ${route.workoutCount}`,
      distanceM: `${Math.round(nearest?.item.distanceM ?? 0)} -> ${Math.round(route.distanceM)}`,
    }
  })
  console.table(comparisons)
}
