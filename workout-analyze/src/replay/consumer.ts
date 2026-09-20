import { createRecordingEngineArtifact, type RecordingEngineObservation } from '../engine/recording'
import type { RawWorkoutEventPage, RecorderObservation } from '../shared/mobile'
import { decodeRawWorkoutEvent } from './decoder'
import type { ProjectedBatch, ProjectorCheckpoint, RawEventDecoder, RecordingSourceMetadata, ReplayCheckpoint } from './types'

const initialProjector = (): ProjectorCheckpoint => ({ schemaVersion: 1, observationSequence: 0, engineInputSequence: 0, unknownEventCount: 0, malformedEventCount: 0 })

export interface JournalConsumer {
  consume(page: RawWorkoutEventPage): Promise<ProjectedBatch>
  checkpoint(): ReplayCheckpoint
}

export const createJournalConsumer = (options: {
  readonly metadata: RecordingSourceMetadata
  readonly namespace: string
  readonly checkpoint?: ReplayCheckpoint | null
  readonly decode?: RawEventDecoder
  readonly commit?: (checkpoint: ReplayCheckpoint) => void | Promise<void>
}): JournalConsumer => {
  const restored = options.checkpoint ?? null
  if (restored && (restored.sessionId !== options.metadata.sessionId || restored.sourceId !== options.metadata.sourceId || restored.namespace !== options.namespace)) throw new TypeError('Replay checkpoint identity does not match source and namespace')
  let checkpoint: ReplayCheckpoint = restored ?? {
    schemaVersion: 1, namespace: options.namespace, sourceId: options.metadata.sourceId, sessionId: options.metadata.sessionId,
    throughJournalSequence: options.metadata.firstJournalSequence - 1, projector: initialProjector(), engine: createRecordingEngineArtifact().create(null).checkpoint(),
  }
  const engine = createRecordingEngineArtifact().create(checkpoint.engine)
  const decode = options.decode ?? decodeRawWorkoutEvent
  return {
    checkpoint: () => checkpoint,
    async consume(page) {
      if (page.afterJournalSequence !== null && page.afterJournalSequence > checkpoint.throughJournalSequence) throw new RangeError(`Journal cursor skips checkpoint: expected at most ${checkpoint.throughJournalSequence}, got ${page.afterJournalSequence}`)
      if (page.items.some((event) => event.sessionId !== options.metadata.sessionId)) throw new TypeError('Journal page contains another session')
      for (let index = 1; index < page.items.length; index += 1) if (page.items[index]!.journalSequence !== page.items[index - 1]!.journalSequence + 1) throw new RangeError('Journal page is not contiguous')
      const pending = page.items.filter((event) => event.journalSequence > checkpoint.throughJournalSequence)
      if (pending.length && pending[0]!.journalSequence !== checkpoint.throughJournalSequence + 1) throw new RangeError(`Journal sequence gap: expected ${checkpoint.throughJournalSequence + 1}, got ${pending[0]!.journalSequence}`)
      let projector = checkpoint.projector
      const observations: RecorderObservation[] = []
      const engineInputs: RecordingEngineObservation[] = []
      const issues = []
      for (const event of pending) {
        const projected = decode(event)
        if (projected.observation) {
          projector = { ...projector, observationSequence: projector.observationSequence + 1 }
          observations.push({ ...projected.observation, sequence: projector.observationSequence } as RecorderObservation)
        }
        if (projected.engineInput) {
          projector = { ...projector, engineInputSequence: projector.engineInputSequence + 1 }
          engineInputs.push({ ...projected.engineInput, sequence: projector.engineInputSequence } as RecordingEngineObservation)
        }
        if (projected.issue) {
          issues.push(projected.issue)
          projector = { ...projector, unknownEventCount: projector.unknownEventCount + (projected.issue.code === 'unknownEvent' ? 1 : 0), malformedEventCount: projector.malformedEventCount + (projected.issue.code === 'malformedPayload' ? 1 : 0) }
        }
      }
      const throughJournalSequence = pending.at(-1)?.journalSequence ?? checkpoint.throughJournalSequence
      const evaluatedAt = pending.at(-1)?.sourceTimestamp ?? pending.at(-1)?.receivedAt ?? new Date(checkpoint.engine.lastEvaluationWallMs ?? Date.parse(options.metadata.startedAt)).toISOString()
      const result = engine.processBatch({ observations: engineInputs, evaluatedAt: { wallTimestamp: evaluatedAt, monotonicTimestampMs: pending.at(-1)?.monotonicTimestampMs ?? null } })
      const next: ReplayCheckpoint = { ...checkpoint, throughJournalSequence, projector, engine: result.checkpoint }
      await options.commit?.(next)
      checkpoint = next
      return { throughJournalSequence, observations, issues, metrics: result.metrics, checkpoint }
    },
  }
}
