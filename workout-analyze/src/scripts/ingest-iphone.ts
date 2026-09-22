import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { ingestIphoneWorkouts } from '../engine/iphone-normalization'
import { rebuildRouteAnalysis } from '../engine/analysis'
import { withBunDuckDbHost } from '../hosts/bun/DuckDbHost'
import { listRecoveredWorkouts, readRecoveredWorkoutPage, snapshotRecoveredArchive } from '../../scripts/mobile/recovered-archive'
import type { SavedWorkoutDetail } from '../shared/mobile'

const snapshot = snapshotRecoveredArchive()
try {
  const page = listRecoveredWorkouts(snapshot.database)
  const loadDetail = async (id: string): Promise<SavedWorkoutDetail> => {
    const first = readRecoveredWorkoutPage(snapshot.database, id, null, 200)
    const items = [...first.observations.items]
    let current = first.observations
    while (current.hasMore) {
      if (current.nextSequence === null) throw new Error(`Observation cursor stopped for ${id}`)
      const next = readRecoveredWorkoutPage(snapshot.database, id, current.nextSequence, 200)
      items.push(...next.observations.items)
      current = next.observations
    }
    return { ...first, observations: { ...current, afterSequence: null, items } }
  }
  const result = await withBunDuckDbHost(resolve(process.env.FITNESS_DATABASE_PATH ?? 'data/fitness.duckdb'), async (database) => {
    const ingestion = await ingestIphoneWorkouts(database, page.items, loadDetail)
    const analysis = process.argv.includes('--no-analysis') ? null : await rebuildRouteAnalysis(database)
    return { ingestion, analysis }
  })
  console.log(JSON.stringify(result, null, 2))
} finally {
  snapshot.database.close()
  rmSync(snapshot.directory, { recursive: true, force: true })
}
