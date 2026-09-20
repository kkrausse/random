import { describe, expect, test } from 'bun:test'

import { composeMobileEngineArtifact, mobileEngineBuildId } from '../../src/engine/mobile-artifact'
import type { RecordingEngineArtifact } from '../../src/engine/recording'
import type { TinyEngineArtifact } from '../../src/engine/shell/artifact-api'

const load = async (version: 'v1' | 'v2') => {
  const [diagnosticSource, recordingSource] = await Promise.all([
    Bun.file(new URL(`../../src/engine/shell/tiny-engine-${version}.js`, import.meta.url)).text(),
    Bun.file(new URL('../../src/engine/recording/recording-engine-v1.js', import.meta.url)).text(),
  ])
  const host = {} as { WorkoutAnalyzeEngine?: TinyEngineArtifact; WorkoutAnalyzeRecordingEngine?: RecordingEngineArtifact }
  new Function('globalThis', composeMobileEngineArtifact({ diagnosticVersion: version, diagnosticSource, recordingSource }))(host)
  return host
}

describe('composed mobile engine artifact', () => {
  for (const version of ['v1', 'v2'] as const) test(`keeps the diagnostic ${version} fixture and installs recording v1`, async () => {
    const host = await load(version)
    expect(host.WorkoutAnalyzeEngine?.describe().engineBuildId).toBe(mobileEngineBuildId(version))
    expect(host.WorkoutAnalyzeEngine?.create(null).processBatch({ observations: [{ sequence: 1, value: 2 }, { sequence: 2, value: 3 }] }).displayValue).toBe(version === 'v1' ? 5 : 10)
    expect(host.WorkoutAnalyzeRecordingEngine?.describe()).toEqual({ apiVersion: 1, checkpointSchemaVersion: 1, engineBuildId: 'recording-engine-v1', algorithmId: 'ride-metrics-v1', maxBatchSize: 1_000 })
  })

  test('rejects source whose selected identities do not match', () => {
    expect(() => composeMobileEngineArtifact({ diagnosticVersion: 'v1', diagnosticSource: 'wrong', recordingSource: 'wrong' })).toThrow('build declaration')
  })
})
