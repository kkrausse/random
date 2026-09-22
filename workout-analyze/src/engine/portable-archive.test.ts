import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { withBunDuckDbHost } from '../hosts/bun/DuckDbHost'
import type { DatabaseHost } from './database'
import { ensureIphoneNormalizationSchema } from './iphone-normalization'
import { exportPortableArchive, importPortableArchive } from './portable-archive'

const directories: string[] = []
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })))
const databasePath = (name: string) => { const directory = mkdtempSync(join(tmpdir(), 'portable-archive-')); directories.push(directory); return join(directory, `${name}.duckdb`) }
const seed = async (database: DatabaseHost, id: string, distance: number) => {
  await ensureIphoneNormalizationSchema(database)
  await database.bulkInsert('activities', ['id', 'source', 'source_activity_id', 'sport', 'started_at', 'duration_seconds', 'distance_m', 'ascent_m', 'avg_hr_bpm', 'max_hr_bpm'], [[id, id.startsWith('garmin:') ? 'garmin' : 'iphone-recorder', id.split(':')[1]!, 'cycling', { type: 'timestamp', value: '2026-09-20T10:00:00.000Z' }, 60, distance, 2, null, null]])
  await database.bulkInsert('activity_samples', ['activity_id', 'timestamp', 'lat', 'lon', 'distance_m', 'altitude_m', 'speed_mps', 'heart_rate_bpm', 'cadence', 'power_w'], [[id, { type: 'timestamp', value: '2026-09-20T10:00:00.000Z' }, 37, -122, 0, 4, 5, null, null, null]])
}

describe('portable canonical archive', () => {
  test('merges new IDs, preserves distinct local same-ID data, and is idempotent', async () => {
    const source = databasePath('source'); const destination = databasePath('destination')
    const bytes = await withBunDuckDbHost(source, async (database) => { await seed(database, 'garmin:100', 100); await seed(database, 'garmin:200', 200); return exportPortableArchive(database) })
    await withBunDuckDbHost(destination, async (database) => {
      await seed(database, 'garmin:100', 999)
      await database.execute('CREATE TABLE capture_journal_marker (value VARCHAR); INSERT INTO capture_journal_marker VALUES (\'untouched\')')
      const first = await importPortableArchive(database, bytes)
      expect(first).toMatchObject({ inserted: 1, unchanged: 0, analysisRebuildRequired: true })
      expect(first.conflicts).toHaveLength(1)
      expect(Number((await database.query("SELECT distance_m FROM activities WHERE id='garmin:100'"))[0]!.distance_m)).toBe(999)
      expect((await database.query('SELECT value FROM capture_journal_marker'))[0]!.value).toBe('untouched')
      const second = await importPortableArchive(database, bytes)
      expect(second).toMatchObject({ inserted: 0, unchanged: 1, analysisRebuildRequired: false })
      expect(second.conflicts).toHaveLength(1)
      expect(Number((await database.query('SELECT count(*) count FROM activities'))[0]!.count)).toBe(2)
    })
  })

  test('rejects invalid bundles before changing the database', async () => {
    const destination = databasePath('invalid')
    await withBunDuckDbHost(destination, async (database) => {
      await expect(importPortableArchive(database, new TextEncoder().encode('not a zip'))).rejects.toThrow('readable ZIP')
      expect(Number((await database.query("SELECT count(*) count FROM information_schema.tables WHERE table_name='activities'"))[0]!.count)).toBe(0)
    })
  })

  test('rolls the entire merge back when a bulk write fails', async () => {
    const source = databasePath('rollback-source'); const destination = databasePath('rollback-destination')
    const bytes = await withBunDuckDbHost(source, async (database) => { await seed(database, 'garmin:300', 300); return exportPortableArchive(database) })
    await withBunDuckDbHost(destination, async (database) => {
      const failing = (host: DatabaseHost): DatabaseHost => ({
        ...host,
        bulkInsert: (table, columns, rows) => table === 'activity_samples' ? Promise.reject(new Error('injected sample failure')) : host.bulkInsert(table, columns, rows),
        transaction: (run) => host.transaction((transaction) => run(failing(transaction))),
      })
      await expect(importPortableArchive(failing(database), bytes)).rejects.toThrow('injected sample failure')
      expect(Number((await database.query('SELECT count(*) count FROM activities'))[0]!.count)).toBe(0)
      expect(Number((await database.query('SELECT count(*) count FROM portable_archive_sources'))[0]!.count)).toBe(0)
    })
  })
})
