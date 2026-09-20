import { createJournalConsumer } from '../../src/replay/consumer'
import { createMemoryRecordingSource } from '../../src/replay/source'
import { loadLocalReplayBundle } from './local-replay'

const bundle = loadLocalReplayBundle()
const source = createMemoryRecordingSource(bundle.metadata, bundle.events)
const consumer = createJournalConsumer({ metadata: bundle.metadata, namespace: 'local-parity-check' })
let cursor: number | null = null
let observations = 0
let issues = 0
let lastMetrics = null
do {
  const page = await source.read(cursor, 200)
  const result = await consumer.consume(page)
  observations += result.observations.length
  issues += result.issues.length
  lastMetrics = result.metrics
  cursor = page.nextJournalSequence
  if (!page.hasMore) break
} while (true)

console.log(JSON.stringify({
  journalEvents: consumer.checkpoint().throughJournalSequence,
  normalizedObservations: observations,
  referenceNormalizedObservations: bundle.reference.normalizedObservationCount,
  normalizedCountDelta: bundle.reference.normalizedObservationCount === null ? null : observations - bundle.reference.normalizedObservationCount,
  engineInputs: consumer.checkpoint().projector.engineInputSequence,
  unknownOrMalformedEvents: issues,
  firstMetricDivergence: bundle.reference.metrics && lastMetrics ? Object.keys(bundle.reference.metrics).sort().find((key) => JSON.stringify(bundle.reference.metrics?.[key]) !== JSON.stringify(lastMetrics?.[key as keyof typeof lastMetrics])) ?? null : null,
}, null, 2))
