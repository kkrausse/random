import { afterEach, describe, expect, test } from 'bun:test'
import { createLocalDatabaseHost, createNativeDatabaseHost } from './client'

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

describe('native database host', () => {
  test('paginates results, encodes bigint, and retains transaction ownership', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = []
    const client = { request: async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params })
      if (method === 'database.begin') return { transactionId: 'dbtx-1' }
      if (method === 'database.query') return { rows: [{ value: { $databaseBigInt: '9007199254740992' } }], resultId: 'dbresult-1', hasMore: true }
      if (method === 'database.queryNext') return { rows: [{ value: 2 }], resultId: null, hasMore: false }
      if (method === 'database.commit') return { committed: true }
      throw new Error(`Unexpected ${method}`)
    } }
    const rows = await createNativeDatabaseHost(client as never).transaction((transaction) => transaction.query('SELECT ?', [9007199254740992n]))
    expect(rows).toEqual([{ value: 9007199254740992n }, { value: 2 }])
    expect(calls.map((item) => item.method)).toEqual(['database.begin', 'database.query', 'database.queryNext', 'database.commit'])
    expect(calls[1]?.params).toMatchObject({ parameters: [{ $databaseBigInt: '9007199254740992' }], transactionId: 'dbtx-1' })
  })
})
