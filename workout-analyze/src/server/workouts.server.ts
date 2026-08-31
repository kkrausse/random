import { spawn } from 'node:child_process'
import { Effect } from 'effect'

import { getActivity, listActivities } from '../services/Database'
import { getAnalysisSettings, listWorkoutRouteMatches, rebuildRouteAnalysis } from '../services/AnalysisDatabase'
import { importRawActivities } from '../services/Importer'

type SyncStage = 'downloading' | 'importing' | 'analyzing'
type SyncJob =
  | { readonly status: 'running'; readonly stage: SyncStage; readonly message: string }
  | { readonly status: 'complete'; readonly message: string }
  | { readonly status: 'failed'; readonly message: string }

const syncJobs = new Map<string, SyncJob>()
let activeSyncJobId: string | null = null

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

export const syncGarminHandler = (onStage: (stage: SyncStage) => void = () => {}) => Effect.gen(function* () {
  onStage('downloading')
  const downloadOutput = yield* Effect.tryPromise({
    try: downloadGarminActivities,
    catch: (cause) => cause instanceof Error ? cause : new Error(String(cause)),
  })
  const { config } = yield* getAnalysisSettings
  onStage('importing')
  const imported = yield* importRawActivities
  onStage('analyzing')
  const analysis = yield* rebuildRouteAnalysis(config)
  const syncSummary = downloadOutput.split('\n').at(-1) ?? 'Garmin sync complete'

  return {
    message: `${syncSummary} Imported ${imported.activities} activities and ${imported.samples} samples. Analyzed ${analysis.routes} routes and ${analysis.traversals} traversals.`,
  }
})

const stageMessage = (stage: SyncStage) => ({
  downloading: 'Downloading new activities from Garmin...',
  importing: 'Importing activities and GPS samples...',
  analyzing: 'Rebuilding segment analysis...',
})[stage]

export const startGarminSyncHandler = () => {
  if (activeSyncJobId && syncJobs.get(activeSyncJobId)?.status === 'running') {
    return { jobId: activeSyncJobId }
  }

  const jobId = crypto.randomUUID()
  activeSyncJobId = jobId
  syncJobs.set(jobId, { status: 'running', stage: 'downloading', message: stageMessage('downloading') })

  Effect.runPromise(syncGarminHandler((stage) => {
    syncJobs.set(jobId, { status: 'running', stage, message: stageMessage(stage) })
  })).then(
    (result) => { syncJobs.set(jobId, { status: 'complete', message: result.message }) },
    (error) => {
      syncJobs.set(jobId, {
        status: 'failed',
        message: error instanceof Error ? error.message : 'Garmin sync failed',
      })
    },
  ).finally(() => {
    if (activeSyncJobId === jobId) activeSyncJobId = null
  })

  return { jobId }
}

export const getGarminSyncStatusHandler = (jobId: string): SyncJob =>
  syncJobs.get(jobId) ?? { status: 'failed', message: 'Garmin sync status is no longer available' }
