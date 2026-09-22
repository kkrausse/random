export type DatabaseValue = string | number | bigint | boolean | null | {
  readonly type: 'timestamp'
  readonly value: string
}

export type DatabaseRow = Record<string, unknown>

/**
 * Transport-safe primitives implemented by each native host. SQL and domain
 * behavior intentionally live above this boundary.
 */
export interface DatabaseHost {
  execute(sql: string, parameters?: ReadonlyArray<DatabaseValue>): Promise<void>
  query(sql: string, parameters?: ReadonlyArray<DatabaseValue>): Promise<ReadonlyArray<DatabaseRow>>
  bulkInsert(
    table: string,
    columns: ReadonlyArray<string>,
    rows: ReadonlyArray<ReadonlyArray<DatabaseValue>>,
  ): Promise<void>
  transaction<A>(run: (transaction: DatabaseHost) => Promise<A>): Promise<A>
}

export const databaseTimestamp = (value: string | Date): DatabaseValue => ({
  type: 'timestamp',
  value: typeof value === 'string' ? value : value.toISOString(),
})
