import { describe, expect, test } from 'bun:test'

import { ENGINE_CHANGE_FIXTURE, type TinyEngineArtifact } from './artifact-api'

const load = async (name: string): Promise<TinyEngineArtifact> => {
  const source = await Bun.file(new URL(name, import.meta.url)).text()
  return Function(`${source}\nreturn globalThis.WorkoutAnalyzeEngine`)() as TinyEngineArtifact
}

describe('JavaScriptCore tiny engine artifact', () => {
  test('is deterministic and restores an exact checkpoint', async () => {
    const artifact = await load('./tiny-engine-v1.js')
    const first = artifact.create(null)
    expect(first.processBatch({ observations: ENGINE_CHANGE_FIXTURE.observations })).toEqual({
      algorithmId: 'phase1-sum-v1', processedCount: 2, lastSequence: 2, total: 5, displayValue: 5,
    })
    const resumed = artifact.create(first.checkpoint())
    expect(resumed.processBatch({ observations: [{ sequence: 3, value: 4 }] }).displayValue).toBe(9)
    expect(() => resumed.processBatch({ observations: [{ sequence: 5, value: 1 }] })).toThrow('contiguous')
  })

  test('loading a new artifact changes behavior without changing the API', async () => {
    const v1 = await load('./tiny-engine-v1.js')
    const v2 = await load('./tiny-engine-v2.js')
    expect(v1.describe().apiVersion).toBe(v2.describe().apiVersion)
    expect(v1.create(null).processBatch({ observations: ENGINE_CHANGE_FIXTURE.observations }).displayValue).toBe(ENGINE_CHANGE_FIXTURE.v1.displayValue)
    expect(v2.create(null).processBatch({ observations: ENGINE_CHANGE_FIXTURE.observations }).displayValue).toBe(ENGINE_CHANGE_FIXTURE.v2.displayValue)
    expect(() => v2.create(v1.create(null).checkpoint())).toThrow('incompatible checkpoint')
  })
})
