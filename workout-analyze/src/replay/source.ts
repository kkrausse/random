import type { RawWorkoutEvent } from '../shared/mobile'
import { parseRawWorkoutEventPage } from '../shared/mobile/validation'
import type { RecordingSource, RecordingSourceMetadata } from './types'

/** Adapter boundary shared by native journal.read and other bounded journal transports. */
export const createJournalReadRecordingSource = (metadata: RecordingSourceMetadata, reader: (params: { readonly sessionId: string; readonly afterJournalSequence: number | null; readonly limit: number }) => Promise<unknown>): RecordingSource => ({
  describe: async () => metadata,
  read: async (afterJournalSequence, requestedLimit) => parseRawWorkoutEventPage(await reader({ sessionId: metadata.sessionId, afterJournalSequence, limit: Math.max(1, Math.min(200, requestedLimit)) })),
})

export const createMemoryRecordingSource = (metadata: RecordingSourceMetadata, events: readonly RawWorkoutEvent[]): RecordingSource => ({
  describe: async () => metadata,
  read: async (afterJournalSequence, requestedLimit) => {
    const limit = Math.max(1, Math.min(200, requestedLimit))
    const start = afterJournalSequence === null ? metadata.firstJournalSequence : afterJournalSequence + 1
    const items = events.filter((event) => event.journalSequence >= start).slice(0, limit)
    const nextJournalSequence = items.at(-1)?.journalSequence ?? null
    return { afterJournalSequence, items, nextJournalSequence, oldestAvailableJournalSequence: events.length ? metadata.firstJournalSequence : null, latestJournalSequence: metadata.lastJournalSequence, hasMore: nextJournalSequence !== null && nextJournalSequence < metadata.lastJournalSequence, droppedBeforeJournalSequence: false }
  },
})

export const createBrowserLocalRecordingSource = (fetcher: typeof fetch = fetch): RecordingSource => ({
  async describe() {
    const response = await fetcher('/__workout/local-replay/metadata')
    if (!response.ok) throw new Error(`Local replay metadata failed (${response.status})`)
    return await response.json() as RecordingSourceMetadata
  },
  async read(afterJournalSequence, limit) {
    const query = new URLSearchParams({ after: afterJournalSequence === null ? '' : String(afterJournalSequence), limit: String(Math.max(1, Math.min(200, limit))) })
    const response = await fetcher(`/__workout/local-replay/events?${query}`)
    if (!response.ok) throw new Error(`Local replay page failed (${response.status})`)
    return parseRawWorkoutEventPage(await response.json())
  },
})
