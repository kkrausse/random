import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { unzipSync } from 'fflate'
import type { Plugin } from 'vite'
import type { RawWorkoutEvent } from '../../src/shared/mobile/contracts.ts'
import type { RecordingSourceMetadata } from '../../src/replay/types.ts'

interface LocalReplayBundle { readonly metadata: RecordingSourceMetadata; readonly events: readonly RawWorkoutEvent[]; readonly reference: { readonly normalizedObservationCount: number | null; readonly metrics: Readonly<Record<string, unknown>> | null } }

const defaultReplay = () => {
  const directory = resolve(import.meta.dirname, '../../data/local-replays')
  if (!existsSync(directory)) return null
  const candidates = readdirSync(directory).filter((name) => name.endsWith('.zip')).sort()
  return candidates.length === 1 ? join(directory, candidates[0]!) : null
}

export const loadLocalReplayBundle = (file = process.env.WORKOUT_LOCAL_REPLAY_ZIP ?? defaultReplay()): LocalReplayBundle => {
  if (!file) throw new Error('Set WORKOUT_LOCAL_REPLAY_ZIP, or leave exactly one ZIP in data/local-replays.')
  const archive = unzipSync(readFileSync(file))
  const manifestBytes = archive['manifest.json']
  const eventsBytes = archive['journal-events.json']
  if (!manifestBytes || !eventsBytes) throw new Error('Replay ZIP must contain manifest.json and journal-events.json.')
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as Record<string, unknown>
  const events = JSON.parse(new TextDecoder().decode(eventsBytes)) as RawWorkoutEvent[]
  if (!Array.isArray(events) || events.length === 0) throw new Error('Replay journal is empty.')
  const sessionId = manifest.sessionId
  if (typeof sessionId !== 'string' || events.some((event) => event.sessionId !== sessionId)) throw new Error('Replay session identity is inconsistent.')
  if (events.some((event, index) => event.journalSequence !== index + 1)) throw new Error('Replay journal sequence is not contiguous from one.')
  if (typeof manifest.startedAt !== 'string' || typeof manifest.finishedAt !== 'string' || Number.isNaN(Date.parse(manifest.startedAt)) || Number.isNaN(Date.parse(manifest.finishedAt))) throw new Error('Replay manifest timestamps are invalid.')
  const metrics = archive['metrics.json'] ? JSON.parse(new TextDecoder().decode(archive['metrics.json'])) as Readonly<Record<string, unknown>> : null
  return { metadata: { sourceId: `local:${basename(file)}`, sessionId, firstJournalSequence: 1, lastJournalSequence: events.length, startedAt: manifest.startedAt, finishedAt: manifest.finishedAt, eventCount: events.length, immutable: true }, events, reference: { normalizedObservationCount: Number.isSafeInteger(manifest.normalizedObservationCount) ? manifest.normalizedObservationCount as number : null, metrics } }
}

export const localReplayPlugin = (): Plugin => {
  let cached: LocalReplayBundle | null = null
  const bundle = () => cached ??= loadLocalReplayBundle()
  return {
    name: 'workout-local-replay', apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__workout/local-replay/metadata', (_request, response) => {
        try { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(bundle().metadata)) }
        catch (error) { response.statusCode = 404; response.end(error instanceof Error ? error.message : 'Local replay unavailable') }
      })
      server.middlewares.use('/__workout/local-replay/events', (request, response) => {
        try {
          const url = new URL(request.url ?? '/', 'http://localhost')
          const afterText = url.searchParams.get('after')
          const after = afterText ? Number(afterText) : null
          const limit = Number(url.searchParams.get('limit') ?? 200)
          if (!(after === null || Number.isSafeInteger(after) && after >= 0) || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new TypeError('Invalid replay cursor or limit.')
          const { events, metadata } = bundle()
          const items = events.slice(after ?? 0, (after ?? 0) + limit)
          const nextJournalSequence = items.at(-1)?.journalSequence ?? null
          response.setHeader('Content-Type', 'application/json')
          response.end(JSON.stringify({ afterJournalSequence: after, items, nextJournalSequence, oldestAvailableJournalSequence: 1, latestJournalSequence: metadata.lastJournalSequence, hasMore: nextJournalSequence !== null && nextJournalSequence < metadata.lastJournalSequence, droppedBeforeJournalSequence: false }))
        } catch (error) { response.statusCode = 400; response.end(error instanceof Error ? error.message : 'Local replay request failed') }
      })
    },
  }
}
