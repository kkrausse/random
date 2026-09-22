import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { databaseTimestamp } from '../../engine/database'
import { withBunDuckDbHost } from './DuckDbHost'

let temporaryDirectory: string | undefined

afterEach(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true })
  temporaryDirectory = undefined
})

describe('Bun DuckDB host primitives', () => {
  test('preserves primitive query and bulk result semantics', async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'duckdb-host-'))
    await withBunDuckDbHost(path.join(temporaryDirectory, 'test.duckdb'), async (database) => {
      await database.execute('CREATE TABLE values_table (id VARCHAR, measured DOUBLE, observed_at TIMESTAMPTZ)')
      await database.bulkInsert('values_table', ['id', 'measured', 'observed_at'], [
        ['one', 1.5, databaseTimestamp('2026-09-21T12:34:56.000Z')],
        ['two', null, databaseTimestamp('2026-09-21T12:35:56.000Z')],
      ])
      const rows = await database.query(
        'SELECT id, measured, observed_at::VARCHAR observed_at FROM values_table WHERE id = $1',
        ['one'],
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ id: 'one', measured: 1.5 })
      expect(new Date(String(rows[0]?.observed_at)).toISOString()).toBe('2026-09-21T12:34:56.000Z')
    })
  })

  test('rolls back all writes when a transaction fails', async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'duckdb-host-'))
    await withBunDuckDbHost(path.join(temporaryDirectory, 'test.duckdb'), async (database) => {
      await database.execute('CREATE TABLE counters (value INTEGER); INSERT INTO counters VALUES (1)')
      await expect(database.transaction(async (transaction) => {
        await transaction.execute('DELETE FROM counters; INSERT INTO counters VALUES (2)')
        throw new Error('stop before publish')
      })).rejects.toThrow('stop before publish')
      expect(await database.query('SELECT value FROM counters')).toEqual([{ value: 1 }])
    })
  })
})
