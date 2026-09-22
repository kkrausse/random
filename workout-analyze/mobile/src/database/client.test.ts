import { afterEach, describe, expect, test } from 'bun:test'
import { createLocalDatabaseHost } from './client'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

describe('browser database host', () => {
  test('revives bigint rows and retains a transaction session', async () => {
    const bodies: Array<Record<string, unknown>> = []
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>; bodies.push(body)
      if (body.op === 'begin') return new Response(JSON.stringify({ transactionId: 'tx-1' }))
      if (body.op === 'query') return new Response(JSON.stringify({ rows: [{ count: { $databaseBigInt: '47' } }] }))
      return new Response('{}')
    }) as typeof fetch

    const count = await createLocalDatabaseHost().transaction(async (transaction) => Number((await transaction.query('SELECT count(*) count'))[0]?.count))

    expect(count).toBe(47)
    expect(bodies.map((body) => body.op)).toEqual(['begin', 'query', 'commit'])
    expect(bodies[1]?.transactionId).toBe('tx-1')
  })
})
