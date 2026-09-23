import { copyFile, mkdtemp, rm, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'

import { readNormalizedActivities } from '../src/engine/analysis'
import { withBunDuckDbHost } from '../src/hosts/bun/DuckDbHost'
import { detectRoutes, resolveDetectionConfig } from '../src/services/SegmentDetector'

const source = resolve(process.argv[2] ?? 'data/phone-recovery-2026-09-23/WorkoutAnalyze/analysis-native.duckdb')
const temporary = await mkdtemp(join(tmpdir(), 'workout-analysis-replay-'))
const databasePath = join(temporary, basename(source))
const walPath = `${source}.wal`

try {
  // DuckDB can replay and checkpoint a WAL merely by opening a database. Keep
  // the original capture byte-for-byte intact, including its native WAL.
  await copyFile(source, databasePath)
  if (await stat(walPath).then(() => true, () => false)) await copyFile(walPath, `${databasePath}.wal`)

  const report = await withBunDuckDbHost(databasePath, async (database) => {
    const [settings] = await database.query('SELECT config_json FROM analysis_settings LIMIT 1')
    if (!settings) throw new Error('Captured database has no analysis settings')
    const config = resolveDetectionConfig(JSON.parse(String(settings.config_json)))
    const activities = await readNormalizedActivities(database)
    const saved = await database.query('SELECT id, name, type, sport, distance_m, workout_count, traversal_count FROM detected_routes')
    const replay = detectRoutes(activities, config)
    const replayById = new Map(replay.routes.map((route) => [route.id, route]))
    const savedIds = new Set(saved.map((route) => String(route.id)))
    return {
      source,
      config,
      activities: activities.length,
      samples: activities.reduce((total, activity) => total + activity.samples.length, 0),
      inputSha256: createHash('sha256').update(JSON.stringify(activities)).digest('hex'),
      savedRoutes: saved.length,
      replayedRoutes: replay.routes.length,
      replayedTraversals: replay.traversals.length,
      missingFromReplay: saved.filter((route) => !replayById.has(String(route.id))).map((route) => String(route.name)),
      newInReplay: replay.routes.filter((route) => !savedIds.has(route.id)).map((route) => route.name),
      changedCounts: saved.flatMap((route) => {
        const result = replayById.get(String(route.id))
        return result && (result.workoutCount !== Number(route.workout_count) || result.traversalCount !== Number(route.traversal_count))
          ? [{ name: String(route.name), saved: [Number(route.workout_count), Number(route.traversal_count)], replayed: [result.workoutCount, result.traversalCount] }]
          : []
      }),
      routes: replay.routes.map((route) => ({ name: route.name, type: route.type, sport: route.sport, distanceM: Math.round(route.distanceM), workouts: route.workoutCount, traversals: route.traversalCount })),
    }
  })
  console.log(JSON.stringify(report, null, 2))
  if (report.missingFromReplay.length || report.newInReplay.length || report.changedCounts.length) process.exitCode = 1
} finally {
  await rm(temporary, { recursive: true, force: true })
}
