import type { DatabaseHost, DatabaseRow } from '../../../src/engine/database'

const call = async <A>(body: unknown): Promise<A> => {
  const response = await fetch('/__workout/database', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body, (_key, value) => typeof value === 'bigint' ? { $databaseBigInt: value.toString() } : value) })
  const result = JSON.parse(await response.text(), (_key, value) => value && typeof value === 'object' && Object.keys(value).length === 1 && typeof value.$databaseBigInt === 'string' ? BigInt(value.$databaseBigInt) : value) as A & { error?: string }
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
