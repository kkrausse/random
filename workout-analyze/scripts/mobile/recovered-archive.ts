import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { Database } from 'bun:sqlite'
import type { Plugin } from 'vite'
import type { ArchiveListPage, SavedWorkoutDetail, SavedWorkoutSummary } from '../../src/shared/mobile/contracts.ts'

type SessionRow = {
  id: string; sport: 'cycling'; started_at: string; finished_at: string; observation_sequence: number; metrics_json: string
  engine_build_id: string; engine_api: number; checkpoint_schema: number; algorithm_id: string; checkpoint_sequence: number
}

const defaultSource = resolve(import.meta.dirname, '../../data/phone-recovery-2026-09-20/application-support/recording-v1.sqlite')
const sourcePath = () => resolve(process.env.WORKOUT_RECOVERED_ARCHIVE ?? defaultSource)

const snapshotDatabase = (source: string) => {
  if (!existsSync(source)) throw new Error(`Recovered iPhone archive not found at ${source}`)
  const directory = mkdtempSync(join(tmpdir(), 'workout-recovered-archive-'))
  const destination = join(directory, 'recording-v1.sqlite')
  for (const suffix of ['', '-wal', '-shm']) {
    const from = `${source}${suffix}`
    if (existsSync(from)) copyFileSync(from, `${destination}${suffix}`)
  }
  return { directory, database: new Database(destination) }
}

const durationMs = (row: SessionRow) => Math.max(0, Date.parse(row.finished_at) - Date.parse(row.started_at))
const summary = (database: Database, row: SessionRow): SavedWorkoutSummary => {
  const raw = database.query('SELECT COUNT(*) count FROM journal_events WHERE session_id=?').get(row.id) as { count: number }
  const fatal = database.query("SELECT COUNT(*) count FROM issues WHERE session_id=? AND severity='fatal'").get(row.id) as { count: number }
  return {
    savedWorkoutId: row.id, sessionId: row.id, sport: row.sport, startedAt: row.started_at, finishedAt: row.finished_at,
    durationMs: durationMs(row), observationCount: row.observation_sequence, latestSequence: row.observation_sequence,
    metrics: JSON.parse(row.metrics_json), hasFatalIssue: Number(fatal.count) > 0,
    rawEventCount: Number(raw.count), lastJournalSequence: Number(raw.count),
  }
}

const list = (database: Database): ArchiveListPage => {
  const rows = database.query("SELECT * FROM sessions WHERE state='finished' ORDER BY finished_at DESC,id DESC").all() as SessionRow[]
  return { afterCursor: null, items: rows.map((row) => summary(database, row)), nextCursor: null, hasMore: false, snapshotAt: new Date().toISOString() }
}

const detail = (database: Database, savedWorkoutId: string, afterSequence: number | null, limit: number): SavedWorkoutDetail => {
  const row = database.query("SELECT * FROM sessions WHERE id=? AND state='finished'").get(savedWorkoutId) as SessionRow | null
  if (!row) throw new Error('Recovered workout was not found')
  const observationRows = database.query('SELECT sequence,json FROM observations WHERE session_id=? AND sequence>? ORDER BY sequence LIMIT ?').all(savedWorkoutId, afterSequence ?? 0, limit + 1) as Array<{ sequence: number; json: string }>
  const selected = observationRows.slice(0, limit)
  const items = selected.map((item) => JSON.parse(item.json))
  const oldest = database.query('SELECT MIN(sequence) oldest FROM observations WHERE session_id=?').get(savedWorkoutId) as { oldest: number | null }
  return {
    summary: summary(database, row),
    pinnedEngine: { buildId: row.engine_build_id, apiVersion: 1, checkpointSchemaVersion: 1 },
    recordingFormatVersion: 1, units: 'SI',
    derivation: { algorithmId: row.algorithm_id, engineBuildId: row.engine_build_id, configId: 'default-v1', firstInputSequence: row.observation_sequence === 0 ? null : 1, lastInputSequence: row.checkpoint_sequence },
    observations: { afterSequence, items, nextSequence: selected.at(-1)?.sequence ?? null, oldestAvailableSequence: oldest.oldest, latestDurableSequence: row.observation_sequence, hasMore: observationRows.length > limit, droppedBeforeSequence: oldest.oldest !== null && oldest.oldest > (afterSequence ?? 0) + 1 },
  }
}

export const recoveredArchivePlugin = (): Plugin => {
  let snapshot: ReturnType<typeof snapshotDatabase> | null = null
  const archive = () => snapshot ??= snapshotDatabase(sourcePath())
  return {
    name: 'workout-recovered-iphone-archive', apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__workout/recovered-archive', (request, response) => {
        response.setHeader('Content-Type', 'application/json')
        response.setHeader('Cache-Control', 'no-store')
        try {
          const url = new URL(request.url ?? '/', 'http://localhost')
          if (request.method !== 'GET') throw new Error('Recovered archive is read-only')
          if (url.pathname === '/status') {
            const page = list(archive().database)
            response.end(JSON.stringify({ available: true, source: basename(sourcePath()), workouts: page.items.length }))
          } else if (url.pathname === '/list') response.end(JSON.stringify(list(archive().database)))
          else if (url.pathname === '/detail') {
            const afterText = url.searchParams.get('after')
            const after = afterText === null ? null : Number(afterText)
            const limit = Number(url.searchParams.get('limit') ?? 200)
            if (!(after === null || Number.isSafeInteger(after) && after >= 0) || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error('Invalid archive detail cursor or limit')
            response.end(JSON.stringify(detail(archive().database, url.searchParams.get('id') ?? '', after, limit)))
          }
          else { response.statusCode = 404; response.end(JSON.stringify({ error: 'Unknown recovered archive operation' })) }
        } catch (error) {
          response.statusCode = 500
          response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Recovered archive request failed' }))
        }
      })
    },
    closeBundle() {
      if (!snapshot) return
      snapshot.database.close(); rmSync(snapshot.directory, { recursive: true, force: true }); snapshot = null
    },
  }
}
