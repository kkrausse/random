import type { DatabaseHost, DatabaseRow } from '../../../src/engine/database'
import type { BridgeClient } from '../bridge/client'

const encodeValue = (value: unknown): unknown => typeof value === 'bigint' ? { $databaseBigInt: value.toString() } : value
const decodeValue = (value: unknown): unknown => value && typeof value === 'object' && Object.keys(value).length === 1 && '$databaseBigInt' in value && typeof value.$databaseBigInt === 'string' ? BigInt(value.$databaseBigInt) : value

const call = async <A>(body: unknown): Promise<A> => {
  const response = await fetch('/__workout/database', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body, (_key, value) => encodeValue(value)) })
  const result = JSON.parse(await response.text(), (_key, value) => decodeValue(value)) as A & { error?: string }
  if (!response.ok) throw new Error(result.error ?? `Local database request failed (${response.status})`)
  return result
}

const adapter = (transactionId?: string): DatabaseHost => ({
  execute: (sql, parameters = []) => call<void>({ op: 'execute', sql, parameters, transactionId }),
  async query(sql, parameters = []) { return (await call<{ rows: DatabaseRow[] }>({ op: 'query', sql, parameters, transactionId })).rows },
  bulkInsert: (table, columns, rows) => call<void>({ op: 'bulkInsert', table, columns, rows, transactionId }),
  async transaction<A>(run: (transaction: DatabaseHost) => Promise<A>) {
    if (transactionId) throw new Error('Nested database transactions are not supported')
    const started = await call<{ transactionId: string }>({ op: 'begin' })
    try {
      const value = await run(adapter(started.transactionId))
      await call<void>({ op: 'commit', transactionId: started.transactionId })
      return value
    } catch (error) {
      await call<void>({ op: 'rollback', transactionId: started.transactionId }).catch(() => undefined)
      throw error
    }
  },
})

export const createLocalDatabaseHost = (): DatabaseHost => adapter()

const chunkRows = (rows: ReadonlyArray<ReadonlyArray<unknown>>, maximumBytes = 128 * 1024) => {
  const chunks: Array<ReadonlyArray<ReadonlyArray<unknown>>> = []
  let current: Array<ReadonlyArray<unknown>> = []
  let bytes = 2
  for (const row of rows) {
    const rowBytes = new TextEncoder().encode(JSON.stringify(row, (_key, value) => encodeValue(value))).byteLength + 1
    if (rowBytes > maximumBytes) throw new Error('A database bulk row exceeds the native bridge limit')
    if (current.length && bytes + rowBytes > maximumBytes) { chunks.push(current); current = []; bytes = 2 }
    current.push(row); bytes += rowBytes
  }
  if (current.length) chunks.push(current)
  return chunks
}

/** Adapts the primitive WKWebView commands to the same DatabaseHost used by Bun. */
export const createNativeDatabaseHost = (client: Pick<BridgeClient, 'request'>): DatabaseHost => {
  const make = (transactionId: string | null): DatabaseHost => ({
    async execute(sql, parameters = []) { await client.request('database.execute', { sql, parameters: parameters.map(encodeValue), transactionId }) },
    async query(sql, parameters = []) {
      let page = await client.request('database.query', { sql, parameters: parameters.map(encodeValue), transactionId })
      const rows: DatabaseRow[] = page.rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, decodeValue(value)])))
      while (page.hasMore) {
        if (!page.resultId) throw new Error('Native database result cursor was missing')
        page = await client.request('database.queryNext', { resultId: page.resultId })
        rows.push(...page.rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, decodeValue(value)]))))
      }
      return rows
    },
    async bulkInsert(table, columns, rows) {
      for (const chunk of chunkRows(rows)) await client.request('database.bulkInsert', { table, columns: [...columns], rows: chunk.map((row) => row.map(encodeValue)), transactionId })
    },
    async transaction<A>(run: (transaction: DatabaseHost) => Promise<A>) {
      if (transactionId) throw new Error('Nested database transactions are not supported')
      const started = await client.request('database.begin', {})
      try {
        const result = await run(make(started.transactionId))
        await client.request('database.commit', { transactionId: started.transactionId })
        return result
      } catch (error) {
        await client.request('database.rollback', { transactionId: started.transactionId }).catch(() => undefined)
        throw error
      }
    },
  })
  return make(null)
}
