import { createJournalConsumer } from '../../src/replay/consumer'
import { createMemoryRecordingSource } from '../../src/replay/source'
import { loadLocalReplayBundle } from './local-replay'

const bundle = loadLocalReplayBundle()
const source = createMemoryRecordingSource(bundle.metadata, bundle.events)
const consumer = createJournalConsumer({ metadata: bundle.metadata, namespace: 'local-parity-check' })
let cursor: number | null = null
let observations = 0
let lastMetrics = null
do {
  const page = await source.read(cursor, 200)
  const result = await consumer.consume(page)
  observations += result.observations.length
  lastMetrics = result.metrics
  cursor = page.nextJournalSequence
  if (!page.hasMore) break
} while (true)

const metricKeys = bundle.reference.metrics && lastMetrics ? [...new Set([...Object.keys(bundle.reference.metrics), ...Object.keys(lastMetrics)])].sort() : []
const divergentMetricKeys = metricKeys.filter((key) => JSON.stringify(bundle.reference.metrics?.[key]) !== JSON.stringify(lastMetrics?.[key as keyof typeof lastMetrics]))
const checkpoint = consumer.checkpoint()
const parity = checkpoint.throughJournalSequence === bundle.metadata.lastJournalSequence && bundle.reference.normalizedObservationCount !== null && observations === bundle.reference.normalizedObservationCount && divergentMetricKeys.length === 0

console.log(JSON.stringify({
  parity,
  journalEvents: consumer.checkpoint().throughJournalSequence,
  normalizedObservations: observations,
  referenceNormalizedObservations: bundle.reference.normalizedObservationCount,
  normalizedCountDelta: bundle.reference.normalizedObservationCount === null ? null : observations - bundle.reference.normalizedObservationCount,
  engineInputs: checkpoint.projector.engineInputSequence,
  duplicateEvents: checkpoint.projector.duplicateEventCount,
  unsupportedEvents: checkpoint.projector.unknownEventCount,
  malformedEvents: checkpoint.projector.malformedEventCount,
  divergentMetricKeys,
}, null, 2))

if (!parity) process.exitCode = 1
