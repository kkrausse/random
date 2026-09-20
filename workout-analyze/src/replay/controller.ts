import type { RawWorkoutEvent, RawWorkoutEventPage } from '../shared/mobile'
import { createJournalConsumer, type JournalConsumer } from './consumer'
import type { RecordingSource, RecordingSourceMetadata, ReplayClock, ReplaySnapshot } from './types'

const systemClock: ReplayClock = {
  now: () => performance.now(),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
}
const eventTime = (event: RawWorkoutEvent) => Date.parse(event.sourceTimestamp ?? event.receivedAt)
const emptySnapshot = (): ReplaySnapshot => ({ status: 'idle', metadata: null, checkpoint: null, observations: [], issues: [], metrics: null, positionMs: 0, durationMs: 0, speed: 1, error: null })

export interface ReplayController {
  snapshot(): ReplaySnapshot
  load(): Promise<void>
  play(): void
  pause(): void
  setSpeed(speed: number): void
  seek(positionMs: number): Promise<void>
  dispose(): void
}

export const createReplayController = (options: { readonly source: RecordingSource; readonly namespace: string; readonly clock?: ReplayClock; readonly onChange?: (snapshot: ReplaySnapshot) => void }): ReplayController => {
  const clock = options.clock ?? systemClock
  let value = emptySnapshot()
  let consumer: JournalConsumer | null = null
  let metadata: RecordingSourceMetadata | null = null
  let buffered: RawWorkoutEvent[] = []
  let sourceCursor: number | null = null
  let timer: unknown = null
  let generation = 0
  let anchorRealMs = 0
  let anchorPositionMs = 0
  const publish = (update: Partial<ReplaySnapshot>) => { value = { ...value, ...update }; options.onChange?.(value) }
  const stopTimer = () => { if (timer !== null) clock.clearTimeout(timer); timer = null }
  const pageFor = (items: readonly RawWorkoutEvent[]): RawWorkoutEventPage => ({ afterJournalSequence: consumer!.checkpoint().throughJournalSequence || null, items, nextJournalSequence: items.at(-1)?.journalSequence ?? null, oldestAvailableJournalSequence: metadata!.firstJournalSequence, latestJournalSequence: metadata!.lastJournalSequence, hasMore: (items.at(-1)?.journalSequence ?? metadata!.firstJournalSequence - 1) < metadata!.lastJournalSequence, droppedBeforeJournalSequence: false })
  const fill = async () => {
    if (buffered.length || sourceCursor === metadata!.lastJournalSequence) return
    const page = await options.source.read(sourceCursor, 200)
    if (page.items.length === 0 && page.hasMore) throw new Error('Replay source returned an empty non-terminal page')
    buffered = [...page.items]
    sourceCursor = page.nextJournalSequence ?? sourceCursor
  }
  const pumpTo = async (positionMs: number, expectedGeneration: number) => {
    const target = Date.parse(metadata!.startedAt) + positionMs
    while (expectedGeneration === generation) {
      await fill()
      const readyCount = buffered.findIndex((event) => eventTime(event) > target)
      const count = readyCount < 0 ? buffered.length : readyCount
      if (count === 0) break
      const items = buffered.slice(0, count)
      buffered = buffered.slice(count)
      const result = await consumer!.consume(pageFor(items))
      if (expectedGeneration !== generation) return
      publish({ checkpoint: result.checkpoint, observations: result.observations, issues: result.issues, metrics: result.metrics, positionMs })
      if (buffered.length === 0 && sourceCursor === metadata!.lastJournalSequence) break
    }
    publish({ positionMs })
  }
  const fail = (error: unknown) => { stopTimer(); publish({ status: 'error', error: error instanceof Error ? error.message : 'Replay failed' }) }
  const schedule = () => {
    stopTimer()
    timer = clock.setTimeout(() => {
      timer = null
      if (value.status !== 'playing') return
      const next = Math.min(value.durationMs, anchorPositionMs + (clock.now() - anchorRealMs) * value.speed)
      const activeGeneration = generation
      void pumpTo(next, activeGeneration).then(() => {
        if (activeGeneration !== generation || value.status !== 'playing') return
        if (next >= value.durationMs) publish({ status: 'finished' })
        else schedule()
      }).catch(fail)
    }, 50)
  }
  const rebuild = async (positionMs: number, expectedGeneration: number) => {
    consumer = createJournalConsumer({ metadata: metadata!, namespace: options.namespace })
    buffered = []
    sourceCursor = null
    publish({ checkpoint: consumer.checkpoint(), observations: [], issues: [], metrics: null, positionMs: 0 })
    await pumpTo(positionMs, expectedGeneration)
  }
  return {
    snapshot: () => value,
    async load() {
      stopTimer(); const activeGeneration = ++generation; publish({ ...emptySnapshot(), status: 'loading' })
      try {
        metadata = await options.source.describe()
        if (activeGeneration !== generation) return
        const durationMs = Math.max(0, Date.parse(metadata.finishedAt) - Date.parse(metadata.startedAt))
        publish({ metadata, durationMs, status: 'paused' })
        await rebuild(0, activeGeneration)
      } catch (error) { fail(error) }
    },
    play() {
      if (!metadata || value.status === 'loading' || value.status === 'error') return
      if (value.positionMs >= value.durationMs) void this.seek(0).then(() => this.play())
      else { anchorRealMs = clock.now(); anchorPositionMs = value.positionMs; publish({ status: 'playing' }); schedule() }
    },
    pause() {
      if (value.status !== 'playing') return
      const positionMs = Math.min(value.durationMs, anchorPositionMs + (clock.now() - anchorRealMs) * value.speed)
      stopTimer(); publish({ status: 'paused', positionMs }); void pumpTo(positionMs, generation).catch(fail)
    },
    setSpeed(speed) {
      if (![0.5, 1, 2, 4, 8, 16].includes(speed)) throw new RangeError('Unsupported replay speed')
      if (value.status === 'playing') { const positionMs = Math.min(value.durationMs, anchorPositionMs + (clock.now() - anchorRealMs) * value.speed); anchorPositionMs = positionMs; anchorRealMs = clock.now(); publish({ speed, positionMs }) }
      else publish({ speed })
    },
    async seek(positionMs) {
      if (!metadata) return
      stopTimer(); const activeGeneration = ++generation; const bounded = Math.max(0, Math.min(value.durationMs, positionMs)); publish({ status: 'loading', error: null })
      try { await rebuild(bounded, activeGeneration); if (activeGeneration === generation) publish({ status: bounded >= value.durationMs ? 'finished' : 'paused' }) } catch (error) { if (activeGeneration === generation) fail(error) }
    },
    dispose() { generation += 1; stopTimer() },
  }
}
