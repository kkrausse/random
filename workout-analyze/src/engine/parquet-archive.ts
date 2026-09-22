import type { DatabaseHost, DatabaseValue } from './database'
import { ensureIphoneNormalizationSchema } from './iphone-normalization'

export const PARQUET_ARCHIVE_FORMAT = 'workout-analyze-parquet-v1' as const
export const PARQUET_ARCHIVE_MAX_FILE_BYTES = 256 * 1024 * 1024

export interface ParquetArchiveFile {
  readonly role: 'activities' | 'samples'
  readonly path: string
  readonly sizeBytes: number
  readonly sha256: string
}
export interface ParquetArchiveManifest {
  readonly format: typeof PARQUET_ARCHIVE_FORMAT
  readonly schemaVersion: 1
  readonly exportId: string
  readonly createdAt: string
  readonly workoutCount: number
  readonly sampleCount: number
  readonly files: readonly ParquetArchiveFile[]
}
export interface ParquetArchiveProgress { readonly stage: 'download' | 'stage' | 'merge'; readonly completed: number; readonly total: number }
export interface ParquetArchiveImportSummary { readonly workouts: number; readonly samples: number; readonly inserted: number; readonly unchanged: number; readonly conflicts: ReadonlyArray<{ id: string; reason: string }>; readonly analysisRebuildRequired: boolean }

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
export const parseParquetArchiveManifest = (value: unknown): ParquetArchiveManifest => {
  if (!record(value) || value.format !== PARQUET_ARCHIVE_FORMAT || value.schemaVersion !== 1 || typeof value.exportId !== 'string' || !/^[a-f0-9-]{1,128}$/.test(value.exportId)
    || typeof value.createdAt !== 'string' || Number.isNaN(Date.parse(value.createdAt)) || !Number.isSafeInteger(value.workoutCount) || (value.workoutCount as number) < 0 || (value.workoutCount as number) > 20_000
    || !Number.isSafeInteger(value.sampleCount) || (value.sampleCount as number) < 0 || !Array.isArray(value.files) || value.files.length !== 2) throw new Error('Parquet archive manifest is invalid')
  const roles = new Set<string>()
  for (const file of value.files) {
    if (!record(file) || (file.role !== 'activities' && file.role !== 'samples') || roles.has(file.role) || typeof file.path !== 'string' || !/^[a-z-]+\.parquet$/.test(file.path)
      || !Number.isSafeInteger(file.sizeBytes) || (file.sizeBytes as number) < 1 || (file.sizeBytes as number) > PARQUET_ARCHIVE_MAX_FILE_BYTES
      || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('Parquet archive manifest file is invalid')
    roles.add(file.role)
  }
  if (!roles.has('activities') || !roles.has('samples')) throw new Error('Parquet archive manifest files are incomplete')
  return value as unknown as ParquetArchiveManifest
}

const count = async (database: DatabaseHost, sql: string, parameters: readonly DatabaseValue[] = []) => Number((await database.query(sql, parameters))[0]?.count ?? 0)
const tableExists = (database: DatabaseHost, table: string) => count(database, 'SELECT count(*) count FROM information_schema.tables WHERE table_name = ?', [table]).then(Boolean)

/**
 * Imports native-owned Parquet paths entirely inside DuckDB. The web runtime sees
 * only the manifest, opaque handles, counts, and conflict IDs—never sample rows.
 */
export const importParquetArchive = async (
  database: DatabaseHost,
  manifest: ParquetArchiveManifest,
  files: Readonly<Record<'activities' | 'samples', DatabaseValue>>,
  onProgress?: (progress: ParquetArchiveProgress) => void,
): Promise<ParquetArchiveImportSummary> => {
  await ensureIphoneNormalizationSchema(database)
  onProgress?.({ stage: 'stage', completed: 0, total: 2 })
  return database.transaction(async (transaction) => {
    await transaction.execute('CREATE OR REPLACE TEMP TABLE parquet_import_activities AS SELECT * FROM read_parquet(?)', [files.activities])
    onProgress?.({ stage: 'stage', completed: 1, total: 2 })
    await transaction.execute('CREATE OR REPLACE TEMP TABLE parquet_import_samples AS SELECT * FROM read_parquet(?)', [files.samples])
    onProgress?.({ stage: 'stage', completed: 2, total: 2 })

    const workoutCount = await count(transaction, 'SELECT count(*) count FROM parquet_import_activities')
    const sampleCount = await count(transaction, 'SELECT count(*) count FROM parquet_import_samples')
    if (workoutCount !== manifest.workoutCount || sampleCount !== manifest.sampleCount) throw new Error('Parquet archive counts do not match its manifest')
    const invalid = await count(transaction, `SELECT count(*) count FROM parquet_import_activities a WHERE
      NOT regexp_matches(a.id, '^(garmin|iphone):[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$') OR
      a.id <> (CASE WHEN a.source = 'garmin' THEN 'garmin:' WHEN a.source = 'iphone-recorder' THEN 'iphone:' ELSE '' END) || a.source_activity_id OR
      a.revision IS NULL OR length(a.revision) <> 64 OR a.sample_count < 0`)
    const duplicateIds = await count(transaction, 'SELECT count(*) count FROM (SELECT id FROM parquet_import_activities GROUP BY id HAVING count(*) <> 1)')
    const orphanSamples = await count(transaction, 'SELECT count(*) count FROM parquet_import_samples s LEFT JOIN parquet_import_activities a ON a.id=s.activity_id WHERE a.id IS NULL')
    const mismatchedSamples = await count(transaction, `SELECT count(*) count FROM parquet_import_activities a LEFT JOIN
      (SELECT activity_id, count(*) sample_count FROM parquet_import_samples GROUP BY activity_id) s ON s.activity_id=a.id
      WHERE a.sample_count <> coalesce(s.sample_count, 0)`)
    if (invalid || duplicateIds || orphanSamples || mismatchedSamples) throw new Error('Parquet archive canonical IDs, revisions, or sample relationships are invalid')

    await transaction.execute(`CREATE TABLE IF NOT EXISTS portable_archive_sources (
      activity_id VARCHAR PRIMARY KEY, revision VARCHAR NOT NULL, archive_format VARCHAR NOT NULL, imported_at TIMESTAMPTZ NOT NULL
    )`)
    const conflictRows = await transaction.query(`SELECT s.id,
      CASE WHEN p.activity_id IS NULL THEN 'A local workout with this ID has unknown provenance' ELSE 'A different imported revision is already present' END reason
      FROM parquet_import_activities s JOIN activities a ON a.id=s.id
      LEFT JOIN portable_archive_sources p ON p.activity_id=s.id
      WHERE p.revision IS NULL OR p.revision <> s.revision ORDER BY s.id`)
    const conflicts = conflictRows.map((row) => ({ id: String(row.id), reason: String(row.reason) }))
    await transaction.execute(`CREATE OR REPLACE TEMP TABLE parquet_import_candidates AS
      SELECT s.id FROM parquet_import_activities s LEFT JOIN activities a ON a.id=s.id WHERE a.id IS NULL`)
    const inserted = await count(transaction, 'SELECT count(*) count FROM parquet_import_candidates')
    const unchanged = workoutCount - inserted - conflicts.length
    onProgress?.({ stage: 'merge', completed: 0, total: inserted })

    await transaction.execute(`INSERT INTO activities
      SELECT s.id, s.source, s.source_activity_id, s.sport, s.started_at, s.duration_seconds, s.distance_m, s.ascent_m, s.avg_hr_bpm, s.max_hr_bpm
      FROM parquet_import_activities s JOIN parquet_import_candidates c ON c.id=s.id`)
    await transaction.execute(`INSERT INTO activity_samples
      SELECT s.activity_id, s.timestamp, s.lat, s.lon, s.distance_m, s.altitude_m, s.speed_mps, s.heart_rate_bpm, s.cadence, s.power_w
      FROM parquet_import_samples s JOIN parquet_import_candidates c ON c.id=s.activity_id`)
    await transaction.execute(`INSERT INTO normalization_sources
      SELECT s.id, s.source, s.source_activity_id, s.input_kind, s.normalization_version, s.source_version,
        s.observation_count, s.sample_count, current_timestamp
      FROM parquet_import_activities s JOIN parquet_import_candidates c ON c.id=s.id WHERE s.input_kind IS NOT NULL`)
    await transaction.execute(`INSERT INTO portable_archive_sources
      SELECT s.id, s.revision, '${PARQUET_ARCHIVE_FORMAT}', current_timestamp
      FROM parquet_import_activities s JOIN parquet_import_candidates c ON c.id=s.id`)
    if (inserted) for (const table of ['route_coverages', 'route_traversals', 'detected_routes', 'analysis_settings']) if (await tableExists(transaction, table)) await transaction.execute(`DELETE FROM ${table}`)
    onProgress?.({ stage: 'merge', completed: inserted, total: inserted })
    return { workouts: workoutCount, samples: sampleCount, inserted, unchanged, conflicts, analysisRebuildRequired: inserted > 0 }
  })
}
