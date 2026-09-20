export const RECORDING_ENGINE_API_VERSION = 1 as const
export const RECORDING_CHECKPOINT_SCHEMA_VERSION = 1 as const
export const RECORDING_ENGINE_GLOBAL_NAME = 'WorkoutAnalyzeRecordingEngine' as const
export const RECORDING_ENGINE_MAX_BATCH_SIZE = 1_000

export type RecordingState = 'idle' | 'recording' | 'paused' | 'finished' | 'interrupted'

export interface EngineLocationObservation {
  readonly kind: 'location'
  readonly sequence: number
  readonly sourceTimestamp: string
  readonly receivedAt: string
  readonly monotonicTimestampMs: number | null
  readonly latitudeDegrees: number
  readonly longitudeDegrees: number
  readonly horizontalAccuracyM: number
  readonly altitudeM: number | null
  readonly verticalAccuracyM: number | null
  readonly speedMps: number | null
  readonly speedAccuracyMps: number | null
}

export interface EngineHeartRateObservation {
  readonly kind: 'heartRate'
  readonly sequence: number
  readonly sourceTimestamp: string
  readonly monotonicTimestampMs: number | null
  readonly bpm: number
}

export interface EngineTransitionObservation {
  readonly kind: 'transition'
  readonly sequence: number
  readonly sourceTimestamp: string
  readonly monotonicTimestampMs: number | null
  readonly from: RecordingState
  readonly to: RecordingState
}

export interface EngineGapObservation {
  readonly kind: 'gap'
  readonly sequence: number
  readonly sourceTimestamp: string
  readonly monotonicTimestampMs: number | null
  readonly startedAt: string
  readonly endedAt: string
}

export type RecordingEngineObservation = EngineLocationObservation | EngineHeartRateObservation | EngineTransitionObservation | EngineGapObservation

export interface EngineEvaluationClock { readonly wallTimestamp: string; readonly monotonicTimestampMs: number | null }

export interface RecordingMetrics {
  readonly activeDurationMs: number
  readonly elapsedDurationMs: number
  readonly distanceM: number
  readonly averageSpeedMps: number | null
  readonly currentSpeedMps: number | null
  readonly currentSpeedObservedAt: string | null
  readonly altitudeM: number | null
  readonly elevationGainM: number
  readonly heartRateBpm: number | null
  readonly heartRateObservedAt: string | null
  readonly locationQuality: 'waiting' | 'good' | 'poor' | 'stale'
  readonly heartRateQuality: 'unconfigured' | 'live' | 'stale'
}

export interface RecordingCheckpoint {
  readonly schemaVersion: 1
  readonly engineBuildId: string
  readonly algorithmId: string
  readonly lastSequence: number
  readonly state: RecordingState
  readonly startedWallMs: number | null
  readonly finishedWallMs: number | null
  readonly activeStartedWallMs: number | null
  readonly activeStartedMonotonicMs: number | null
  readonly accumulatedActiveMs: number
  readonly distanceM: number
  readonly elevationGainM: number
  readonly anchor: { readonly latitudeDegrees: number; readonly longitudeDegrees: number; readonly wallMs: number; readonly altitudeM: number | null } | null
  readonly lastLocationWallMs: number | null
  readonly poorLocationWallMs: number | null
  readonly currentSpeedMps: number | null
  readonly currentSpeedWallMs: number | null
  readonly altitudeM: number | null
  readonly heartRateBpm: number | null
  readonly heartRateWallMs: number | null
  readonly sawHeartRate: boolean
  readonly lastEvaluationWallMs: number | null
}

export interface RecordingBatchResult { readonly processedCount: number; readonly lastSequence: number; readonly metrics: RecordingMetrics; readonly checkpoint: RecordingCheckpoint }
export interface RecordingEngineInstance {
  processBatch(input: { readonly observations: readonly RecordingEngineObservation[]; readonly evaluatedAt: EngineEvaluationClock }): RecordingBatchResult
  checkpoint(): RecordingCheckpoint
}
export interface RecordingEngineArtifact {
  describe(): { readonly apiVersion: 1; readonly checkpointSchemaVersion: 1; readonly engineBuildId: string; readonly algorithmId: string; readonly maxBatchSize: 1_000 }
  create(checkpoint: RecordingCheckpoint | null): RecordingEngineInstance
}
