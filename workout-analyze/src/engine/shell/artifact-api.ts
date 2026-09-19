export const ENGINE_GLOBAL_NAME = 'WorkoutAnalyzeEngine' as const
export const ENGINE_API_VERSION = 1 as const
export const ENGINE_CHECKPOINT_SCHEMA_VERSION = 1 as const
export const ENGINE_MAX_BATCH_SIZE = 1_000

export interface TinyEngineDescriptor {
  readonly apiVersion: 1
  readonly checkpointSchemaVersion: 1
  readonly engineBuildId: string
  readonly algorithmId: string
  readonly maxBatchSize: 1_000
}

export interface TinyEngineObservation { readonly sequence: number; readonly value: number }
export interface TinyEngineCheckpoint {
  readonly schemaVersion: 1
  readonly engineBuildId: string
  readonly algorithmId: string
  readonly lastSequence: number
  readonly total: number
}
export interface TinyEngineBatchResult {
  readonly algorithmId: string
  readonly processedCount: number
  readonly lastSequence: number
  readonly total: number
  readonly displayValue: number
}
export interface TinyEngineInstance {
  processBatch(batch: { readonly observations: readonly TinyEngineObservation[] }): TinyEngineBatchResult
  checkpoint(): TinyEngineCheckpoint
}
export interface TinyEngineArtifact {
  describe(): TinyEngineDescriptor
  create(checkpoint: TinyEngineCheckpoint | null): TinyEngineInstance
}

declare global {
  // Installed by evaluating one engine artifact in a JavaScriptCore context.
  var WorkoutAnalyzeEngine: TinyEngineArtifact
}

export const ENGINE_CHANGE_FIXTURE = {
  observations: [{ sequence: 1, value: 2 }, { sequence: 2, value: 3 }],
  v1: { algorithmId: 'phase1-sum-v1', displayValue: 5 },
  v2: { algorithmId: 'phase1-double-v2', displayValue: 10 },
} as const
