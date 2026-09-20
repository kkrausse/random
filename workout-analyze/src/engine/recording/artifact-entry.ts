import { createRecordingEngineArtifact } from './index'
import type { RecordingEngineArtifact } from './types'

declare global {
  var WorkoutAnalyzeRecordingEngine: RecordingEngineArtifact
}

globalThis.WorkoutAnalyzeRecordingEngine = createRecordingEngineArtifact()
