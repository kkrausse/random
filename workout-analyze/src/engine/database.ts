export type DatabaseValue = string | number | bigint | boolean | null | {
  readonly type: 'timestamp'
  readonly value: string
} | {
  /** Opaque native-owned file handle. Only the native database host resolves it to a path. */
  readonly type: 'hostFile'
  readonly id: string
}

export type DatabaseRow = Record<string, unknown>

/**
 * Execution-facing database operations implemented by each host. SQL and
 * domain behavior intentionally live above this boundary.
 *
 * This is not a wire protocol: DatabaseValue and DatabaseRow still include
 * runtime-native values, and transaction() runs its callback in the calling
 * TypeScript runtime. A remote host adapter must define value/result encoding
 * and retain one transaction session for every callback operation.
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
