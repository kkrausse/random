import { afterEach, describe, expect, test } from 'bun:test'
import type { SavedWorkoutDetail } from '../../../src/shared/mobile'
import { createRecoveredArchiveClient } from './client'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

describe('recovered archive client', () => {
  test('loads bounded immutable pages into one workout detail', async () => {
    const calls: string[] = []
    globalThis.fetch = (async (input) => {
      const url = String(input); calls.push(url)
      const after = new URL(url, 'http://local').searchParams.get('after')
      const start = after === null ? 1 : Number(after) + 1
      const items = Array.from({ length: start === 1 ? 200 : 25 }, (_, index) => ({ kind: 'transition', sequence: start + index }))
      const detail = {
        summary: { savedWorkoutId: 'ride-real', latestSequence: 225 },
        observations: { afterSequence: after === null ? null : Number(after), items, nextSequence: items.at(-1)!.sequence, latestDurableSequence: 225, hasMore: start === 1 },
      } as unknown as SavedWorkoutDetail
      return new Response(JSON.stringify(detail))
    }) as typeof fetch

    const detail = await createRecoveredArchiveClient().detail('ride-real')

    expect(calls).toHaveLength(2)
    expect(calls[1]).toContain('after=200')
    expect(detail.observations.items).toHaveLength(225)
    expect(detail.observations.afterSequence).toBeNull()
  })
})
