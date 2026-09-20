import type { RecordingCheckpoint, RecordingMetrics } from '../engine/recording'
import type { RawWorkoutEvent, RawWorkoutEventPage, RecorderObservation } from '../shared/mobile'

export interface RecordingSourceMetadata {
  readonly sourceId: string
  readonly sessionId: string
  readonly firstJournalSequence: number
  readonly lastJournalSequence: number
  readonly startedAt: string
  readonly finishedAt: string
  readonly eventCount: number
  readonly immutable: true
}

export interface RecordingSource {
  describe(): Promise<RecordingSourceMetadata>
  read(afterJournalSequence: number | null, limit: number): Promise<RawWorkoutEventPage>
}

export interface ProjectionIssue {
  readonly journalSequence: number
  readonly eventId: string
  readonly kind: string
  readonly code: 'unknownEvent' | 'malformedPayload'
  readonly message: string
}

export interface ProjectorCheckpoint {
  readonly schemaVersion: 1
  readonly observationSequence: number
  readonly engineInputSequence: number
  readonly unknownEventCount: number
  readonly malformedEventCount: number
}

export interface ReplayCheckpoint {
  readonly schemaVersion: 1
  readonly namespace: string
  readonly sourceId: string
  readonly sessionId: string
  readonly throughJournalSequence: number
  readonly projector: ProjectorCheckpoint
  readonly engine: RecordingCheckpoint
}

export interface ProjectedBatch {
  readonly throughJournalSequence: number
  readonly observations: readonly RecorderObservation[]
  readonly issues: readonly ProjectionIssue[]
  readonly metrics: RecordingMetrics
  readonly checkpoint: ReplayCheckpoint
}

export interface ReplayClock {
  now(): number
  setTimeout(callback: () => void, delayMs: number): unknown
  clearTimeout(handle: unknown): void
}

export type ReplayStatus = 'idle' | 'loading' | 'paused' | 'playing' | 'finished' | 'error'

export interface ReplaySnapshot {
  readonly status: ReplayStatus
  readonly metadata: RecordingSourceMetadata | null
  readonly checkpoint: ReplayCheckpoint | null
  readonly observations: readonly RecorderObservation[]
  readonly issues: readonly ProjectionIssue[]
  readonly metrics: RecordingMetrics | null
  readonly positionMs: number
  readonly durationMs: number
  readonly speed: number
  readonly error: string | null
}

type WithoutSequence<T> = T extends { readonly sequence: number } ? Omit<T, 'sequence'> : never

export type RawProjection = {
  readonly observation: Omit<RecorderObservation, 'sequence'> | null
  readonly engineInput: WithoutSequence<import('../engine/recording').RecordingEngineObservation> | null
  readonly issue: ProjectionIssue | null
}

export type RawEventDecoder = (event: RawWorkoutEvent) => RawProjection
