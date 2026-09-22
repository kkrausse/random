import { DuckDBInstance, DuckDBTimestampTZValue } from '@duckdb/node-api'
import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api'

import type { DatabaseHost, DatabaseValue } from '../../engine/database'

const nativeValue = (value: DatabaseValue): DuckDBValue => value && typeof value === 'object'
  ? new DuckDBTimestampTZValue(BigInt(new Date(value.value).getTime()) * 1_000n)
  : value

const identifier = (value: string) => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error(`Invalid database identifier: ${value}`)
  return value
}

const connectionHost = (connection: DuckDBConnection, inTransaction = false): DatabaseHost => ({
  async execute(sql, parameters = []) {
    await connection.run(sql, parameters.map(nativeValue))
  },
  async query(sql, parameters = []) {
    const result = await connection.runAndReadAll(sql, parameters.map(nativeValue))
    return result.getRowObjectsJS()
  },
  async bulkInsert(table, columns, rows) {
    if (rows.length === 0) return
    const safeTable = identifier(table)
    const safeColumns = columns.map(identifier)
    const tableColumns = await connection.runAndReadAll(`SELECT name FROM pragma_table_info('${safeTable}') ORDER BY cid`)
    const actualColumns = tableColumns.getRowObjectsJS().map((row) => String(row.name))
    if (actualColumns.length !== safeColumns.length || actualColumns.some((column, index) => column !== safeColumns[index])) {
      throw new Error(`Bulk insert columns must match ${safeTable} table order`)
    }
    const appender = await connection.createAppender(safeTable)
    try {
      for (const row of rows) {
        if (row.length !== safeColumns.length) throw new Error(`Invalid ${safeTable} row width`)
        for (const value of row) appender.appendValue(nativeValue(value))
        appender.endRow()
      }
      appender.flushSync()
    } finally {
      appender.closeSync()
    }
  },
  async transaction(run) {
    if (inTransaction) throw new Error('Nested database transactions are not supported')
    await connection.run('BEGIN TRANSACTION')
    try {
      const result = await run(connectionHost(connection, true))
      await connection.run('COMMIT')
      return result
    } catch (error) {
      await connection.run('ROLLBACK')
      throw error
    }
  },
})

export const withBunDuckDbHost = async <A>(path: string, run: (host: DatabaseHost) => Promise<A>): Promise<A> => {
  const instance = await DuckDBInstance.create(path)
  const connection = await instance.connect()
  try {
    return await run(connectionHost(connection))
  } finally {
    connection.closeSync()
    instance.closeSync()
  }
}
