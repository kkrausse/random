import { spawn } from 'node:child_process'
import { Effect } from 'effect'

import { getActivity, listActivities } from '../services/Database'
import { getAnalysisSettings, listWorkoutRouteMatches, rebuildRouteAnalysis } from '../services/AnalysisDatabase'
import { importRawActivities } from '../services/Importer'

export const getWorkoutsHandler = () => Effect.runPromise(listActivities)
export const getWorkoutHandler = (id: string) => Effect.runPromise(getActivity(id))
export const getWorkoutRouteMatchesHandler = (id: string) => Effect.runPromise(listWorkoutRouteMatches(id))

const downloadGarminActivities = () =>
  new Promise<string>((resolve, reject) => {
    const child = spawn('bun', ['run', 'garmin:sync'], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (chunk) => { output += String(chunk) })
    child.stderr.on('data', (chunk) => { output += String(chunk) })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve(output.trim())
      } else {
        reject(new Error(output.trim() || `Garmin sync exited with code ${code}`))
      }
    })
  })

export const syncGarminHandler = () => Effect.gen(function* () {
  const downloadOutput = yield* Effect.tryPromise({
    try: downloadGarminActivities,
    catch: (cause) => cause instanceof Error ? cause : new Error(String(cause)),
  })
  const { config } = yield* getAnalysisSettings
  const imported = yield* importRawActivities
  const analysis = yield* rebuildRouteAnalysis(config)
  const syncSummary = downloadOutput.split('\n').at(-1) ?? 'Garmin sync complete'

  return {
    message: `${syncSummary} Imported ${imported.activities} activities and ${imported.samples} samples. Analyzed ${analysis.routes} routes and ${analysis.traversals} traversals.`,
  }
})
