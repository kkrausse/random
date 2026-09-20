import { describe, expect, test } from 'bun:test'
import type { RawWorkoutEvent } from '../shared/mobile'
import { createJournalConsumer } from './consumer'
import { createReplayController } from './controller'
import { decodeRawWorkoutEvent } from './decoder'
import { createBrowserLocalRecordingSource, createJournalReadRecordingSource, createMemoryRecordingSource } from './source'
import type { RecordingSourceMetadata, ReplayClock } from './types'

const start = '2026-01-01T00:00:00.000Z'
const metadata: RecordingSourceMetadata = { sourceId: 'fixture', sessionId: 'ride-test', firstJournalSequence: 1, lastJournalSequence: 4, startedAt: start, finishedAt: '2026-01-01T00:00:03.000Z', eventCount: 4, immutable: true }
const raw = (journalSequence: number, kind: string, value: unknown, offsetMs = journalSequence - 1): RawWorkoutEvent => ({
  formatVersion: 1, eventId: `event-${journalSequence}`, sessionId: 'ride-test', journalSequence, kind,
  sourceTimestamp: new Date(Date.parse(start) + offsetMs).toISOString(), receivedAt: new Date(Date.parse(start) + offsetMs).toISOString(), monotonicTimestampMs: offsetMs,
  provenance: { origin: 'liveNative', sourceId: 'fixture-sensor', monotonicClockId: 'fixture-clock', lineage: null }, batch: null, payload: { encoding: 'json', value },
})
const events = [
  raw(1, 'lifecycle.start', { sport: 'cycling' }, 0),
  raw(2, 'locationDelivery', { sourceTimestamp: '2026-01-01T00:00:01.000Z', receivedAt: '2026-01-01T00:00:01.000Z', latitudeDegrees: 1, longitudeDegrees: 2, horizontalAccuracyM: 4, altitudeM: 10, verticalAccuracyM: 2, speedMps: 3, speedAccuracyMps: 1, courseDegrees: null, courseAccuracyDegrees: null, floorLevel: null, isSimulatedBySoftware: false, isProducedByAccessory: false }, 1_000),
  raw(3, 'heartRateCharacteristicDelivery', { connectionId: 'connection-1', deviceId: 'device-1', receivedAt: '2026-01-01T00:00:02.000Z', rawCharacteristicBase64: 'Bow=' }, 2_000),
  raw(4, 'lifecycle.finished', { from: 'recording', to: 'finished', cause: 'user' }, 3_000),
]
const page = (items: readonly RawWorkoutEvent[], after: number | null = null, latestJournalSequence = 4) => ({ afterJournalSequence: after, items, nextJournalSequence: items.at(-1)?.journalSequence ?? null, oldestAvailableJournalSequence: 1, latestJournalSequence, hasMore: (items.at(-1)?.journalSequence ?? 0) < latestJournalSequence, droppedBeforeJournalSequence: false as const })

describe('raw workout decoder and journal consumer', () => {
  test('decodes location and exact BLE bytes into separate normalized and engine inputs', () => {
    const location = decodeRawWorkoutEvent(events[1]!)
    const heartRate = decodeRawWorkoutEvent(events[2]!)
    expect(location.observation?.kind).toBe('location')
    expect(location.observation?.provenance?.rawEvent?.journalSequence).toBe(2)
    expect(heartRate.observation).toMatchObject({ kind: 'heartRate', bpm: 140, valueFormat: 'uint8', rawFlags: 6, sensorContact: 'detected' })
    expect(heartRate.engineInput).toMatchObject({ kind: 'heartRate', bpm: 140 })
  })

  test('preserves unknown and malformed events as issues while advancing the journal cursor', async () => {
    const malformed = raw(2, 'locationDelivery', { latitudeDegrees: 'not-a-number' })
    const unknown = raw(3, 'vendor.future', { opaque: true })
    const consumer = createJournalConsumer({ metadata, namespace: 'test' })
    const result = await consumer.consume(page([events[0]!, malformed, unknown]))
    expect(result.throughJournalSequence).toBe(3)
    expect(result.issues.map((item) => item.code)).toEqual(['malformedPayload', 'unknownEvent'])
    expect(result.checkpoint.projector).toMatchObject({ observationSequence: 1, engineInputSequence: 1, malformedEventCount: 1, unknownEventCount: 1 })
  })

  test('rejects gaps and another session before committing', async () => {
    let commits = 0
    const consumer = createJournalConsumer({ metadata, namespace: 'test', commit: () => { commits += 1 } })
    await expect(consumer.consume(page([events[1]!]))).rejects.toThrow('expected 1, got 2')
    await expect(consumer.consume(page([{ ...events[0]!, sessionId: 'other' }]))).rejects.toThrow('another session')
    expect(commits).toBe(0)
    expect(consumer.checkpoint().throughJournalSequence).toBe(0)
  })

  test('is idempotent for duplicate delivery and restores a committed checkpoint', async () => {
    const first = createJournalConsumer({ metadata, namespace: 'test' })
    const projected = await first.consume(page(events.slice(0, 2)))
    const duplicate = await first.consume(page(events.slice(0, 2)))
    expect(duplicate.observations).toHaveLength(0)
    expect(duplicate.checkpoint).toEqual(projected.checkpoint)
    const restored = createJournalConsumer({ metadata, namespace: 'test', checkpoint: projected.checkpoint })
    const tail = await restored.consume(page(events.slice(2), 2))
    expect(tail.checkpoint.throughJournalSequence).toBe(4)
    expect(tail.checkpoint.projector.observationSequence).toBe(4)
    expect(tail.metrics.heartRateBpm).toBe(140)
  })

  test('does not publish a checkpoint until its durable commit succeeds', async () => {
    let failCommit = true
    const consumer = createJournalConsumer({ metadata, namespace: 'commit-test', commit: () => { if (failCommit) throw new Error('disk unavailable') } })
    await expect(consumer.consume(page(events.slice(0, 2)))).rejects.toThrow('disk unavailable')
    expect(consumer.checkpoint().throughJournalSequence).toBe(0)
    failCommit = false
    const retried = await consumer.consume(page(events.slice(0, 2)))
    expect(retried.checkpoint.throughJournalSequence).toBe(2)
    expect(retried.checkpoint.engine.lastSequence).toBe(2)
  })

  test('suppresses legacy projection duplicates across pages and checkpoint restoration', async () => {
    const duplicateEvents = [
      ...events.slice(0, 3),
      { ...events[1]!, eventId: 'event-4', journalSequence: 4 },
      { ...events[2]!, eventId: 'event-5', journalSequence: 5 },
      { ...events[3]!, eventId: 'event-6', journalSequence: 6 },
    ]
    const duplicateMetadata = { ...metadata, lastJournalSequence: 6, eventCount: 6 }
    const first = createJournalConsumer({ metadata: duplicateMetadata, namespace: 'dedupe-test' })
    const head = await first.consume(page(duplicateEvents.slice(0, 3), null, 6))
    const restored = createJournalConsumer({ metadata: duplicateMetadata, namespace: 'dedupe-test', checkpoint: head.checkpoint })
    const tail = await restored.consume(page(duplicateEvents.slice(3), 3, 6))
    expect(tail.observations.map((item) => item.kind)).toEqual(['transition'])
    expect(tail.checkpoint.throughJournalSequence).toBe(6)
    expect(tail.checkpoint.projector).toMatchObject({ observationSequence: 4, engineInputSequence: 4, duplicateEventCount: 2 })
    expect(tail.checkpoint.projector.emittedDedupeKeys).toHaveLength(2)
  })

  test('produces identical engine results regardless of journal page boundaries', async () => {
    const skewed = [events[0]!, events[1]!, { ...events[3]!, eventId: 'event-3-finish', journalSequence: 3, monotonicTimestampMs: 3_514 }]
    const skewedMetadata = { ...metadata, lastJournalSequence: 3, eventCount: 3 }
    const whole = createJournalConsumer({ metadata: skewedMetadata, namespace: 'whole' })
    const wholeResult = await whole.consume(page(skewed, null, 3))
    const paged = createJournalConsumer({ metadata: skewedMetadata, namespace: 'paged' })
    await paged.consume(page(skewed.slice(0, 1), null, 3))
    const pagedResult = await paged.consume(page(skewed.slice(1), 1, 3))
    expect(pagedResult.metrics).toEqual(wholeResult.metrics)
    expect(pagedResult.checkpoint.engine).toEqual(wholeResult.checkpoint.engine)
    expect(pagedResult.metrics.activeDurationMs).toBe(3_000)
  })
})

describe('recording sources and playback clock', () => {
  test('pages an immutable source with an exclusive journal cursor', async () => {
    const source = createMemoryRecordingSource(metadata, events)
    const first = await source.read(null, 2)
    const second = await source.read(first.nextJournalSequence, 2)
    expect(first.items.map((item) => item.journalSequence)).toEqual([1, 2])
    expect(second.items.map((item) => item.journalSequence)).toEqual([3, 4])
    expect(second.hasMore).toBe(false)
  })

  test('adapts the future native journal.read shape through the same validated source', async () => {
    let requested: unknown = null
    const source = createJournalReadRecordingSource(metadata, async (params) => { requested = params; return page(events.slice(0, 2)) })
    expect((await source.read(null, 500)).items).toHaveLength(2)
    expect(requested).toEqual({ sessionId: 'ride-test', afterJournalSequence: null, limit: 200 })
  })

  test('validates browser source pages rather than trusting the development endpoint', async () => {
    const fetcher = (async (input: string | URL | Request) => new Response(String(input).includes('metadata') ? JSON.stringify(metadata) : JSON.stringify({ ...page([events[1]!]), afterJournalSequence: null }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch
    await expect(createBrowserLocalRecordingSource(fetcher).read(null, 10)).rejects.toThrow('invalid raw workout event page')
  })

  test('plays at injected speed, pauses, and deterministically rebuilds on seek', async () => {
    let now = 0
    let callback: (() => void) | null = null
    const clock: ReplayClock = { now: () => now, setTimeout: (next) => { callback = next; return 1 }, clearTimeout: () => { callback = null } }
    const snapshots: number[] = []
    const controller = createReplayController({ source: createMemoryRecordingSource(metadata, events), namespace: 'clock-test', clock, onChange: (snapshot) => snapshots.push(snapshot.checkpoint?.throughJournalSequence ?? 0) })
    await controller.load()
    controller.setSpeed(2)
    controller.play()
    now = 1_100
    const tick = callback as (() => void) | null
    tick?.()
    for (let index = 0; index < 10 && controller.snapshot().positionMs === 0; index += 1) await Promise.resolve()
    expect(controller.snapshot().positionMs).toBe(2_200)
    expect(controller.snapshot().checkpoint?.throughJournalSequence).toBe(3)
    controller.pause()
    await controller.seek(1_000)
    expect(controller.snapshot().checkpoint?.throughJournalSequence).toBe(2)
    expect(controller.snapshot().positionMs).toBe(1_000)
    expect(snapshots.length).toBeGreaterThan(3)
  })
})
