import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

import type { DatabaseHost, DatabaseValue } from './database'
import { databaseTimestamp } from './database'
import { ensureIphoneNormalizationSchema } from './iphone-normalization'
import { sha256 } from './sha256'

export const PORTABLE_ARCHIVE_FORMAT = 'workout-analyze-canonical-v1' as const
export const PORTABLE_ARCHIVE_EXTENSION = '.workout-archive.zip'
const SAMPLE_CHUNK_SIZE = 10_000
export const PORTABLE_ARCHIVE_MAX_COMPRESSED_BYTES = 128 * 1024 * 1024
const MAX_EXPANDED_BYTES = 512 * 1024 * 1024
const activityColumns = ['id', 'source', 'source_activity_id', 'sport', 'started_at', 'duration_seconds', 'distance_m', 'ascent_m', 'avg_hr_bpm', 'max_hr_bpm'] as const
const sampleColumns = ['activity_id', 'timestamp', 'lat', 'lon', 'distance_m', 'altitude_m', 'speed_mps', 'heart_rate_bpm', 'cadence', 'power_w'] as const

type JsonValue = string | number | boolean | null
type PortableActivity = {
  id: string; source: string; sourceActivityId: string; sport: string; startedAt: string
  durationSeconds: number | null; distanceM: number | null; ascentM: number | null; avgHrBpm: number | null; maxHrBpm: number | null
}
type PortableWorkout = { activity: PortableActivity; revision: string; provenance: { inputKind: string; normalizationVersion: string; sourceVersion: string } | null; sampleCount: number; sampleFiles: string[] }
type Manifest = { format: typeof PORTABLE_ARCHIVE_FORMAT; createdAt: string; producer: string; workoutCount: number; sampleCount: number; workouts: PortableWorkout[] }
export interface ArchiveProgress { readonly stage: 'reading' | 'packing' | 'validating' | 'merging'; readonly completed: number; readonly total: number }
export interface ArchiveImportSummary { readonly workouts: number; readonly samples: number; readonly inserted: number; readonly unchanged: number; readonly conflicts: ReadonlyArray<{ id: string; reason: string }>; readonly analysisRebuildRequired: boolean }

const numberOrNull = (value: unknown) => value === null || value === undefined ? null : Number(value)
const timestampText = (value: unknown) => {
  const raw = String(value).replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00')
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid canonical timestamp: ${value}`)
  return date.toISOString()
}
const validId = (id: string) => /^(garmin|iphone):[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)
const finiteOrNull = (value: unknown) => value === null || typeof value === 'number' && Number.isFinite(value)
const validActivity = (value: PortableActivity) => value && validId(value.id)
  && (value.id.startsWith('garmin:') ? value.source === 'garmin' : value.source === 'iphone-recorder')
  && typeof value.sourceActivityId === 'string' && value.sourceActivityId.length > 0 && value.sourceActivityId.length <= 128
  && value.id === `${value.id.startsWith('garmin:') ? 'garmin' : 'iphone'}:${value.sourceActivityId}`
  && typeof value.sport === 'string' && value.sport.length > 0 && value.sport.length <= 64
  && typeof value.startedAt === 'string' && !Number.isNaN(Date.parse(value.startedAt))
  && [value.durationSeconds, value.distanceM, value.ascentM, value.avgHrBpm, value.maxHrBpm].every(finiteOrNull)
const validProvenance = (value: PortableWorkout['provenance']) => value === null || value && [value.inputKind, value.normalizationVersion, value.sourceVersion].every((item) => typeof item === 'string' && item.length > 0 && item.length <= 512)
const validSample = (row: unknown): row is JsonValue[] => Array.isArray(row) && row.length === 9
  && (row[0] === null || typeof row[0] === 'string' && !Number.isNaN(Date.parse(row[0])))
  && row.slice(1).every(finiteOrNull)
const revisionFor = (activity: PortableActivity, samples: readonly JsonValue[][], provenance: PortableWorkout['provenance']) => sha256(JSON.stringify({ activity, samples, provenance }))

export const exportPortableArchive = async (database: DatabaseHost, onProgress?: (value: ArchiveProgress) => void, options: { readonly prepareSchema?: boolean } = {}): Promise<Uint8Array> => {
  if (options.prepareSchema !== false) await ensureIphoneNormalizationSchema(database)
  const rows = await database.query(`SELECT id, source, source_activity_id, sport, started_at::VARCHAR started_at,
    duration_seconds, distance_m, ascent_m, avg_hr_bpm, max_hr_bpm FROM activities ORDER BY id`)
  const provenanceRows = await database.query('SELECT activity_id, input_kind, normalization_version, source_version FROM normalization_sources')
  const provenanceById = new Map(provenanceRows.map((row) => [String(row.activity_id), { inputKind: String(row.input_kind), normalizationVersion: String(row.normalization_version), sourceVersion: String(row.source_version) }]))
  const files: Record<string, Uint8Array> = {}
  const workouts: PortableWorkout[] = []
  let totalSamples = 0
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!
    const id = String(row.id)
    if (!validId(id)) throw new Error(`Cannot export non-canonical workout ID: ${id}`)
    onProgress?.({ stage: 'reading', completed: index, total: rows.length })
    const activity: PortableActivity = { id, source: String(row.source), sourceActivityId: String(row.source_activity_id), sport: String(row.sport), startedAt: timestampText(row.started_at), durationSeconds: numberOrNull(row.duration_seconds), distanceM: numberOrNull(row.distance_m), ascentM: numberOrNull(row.ascent_m), avgHrBpm: numberOrNull(row.avg_hr_bpm), maxHrBpm: numberOrNull(row.max_hr_bpm) }
    const samples = (await database.query(`SELECT timestamp::VARCHAR AS sample_timestamp, lat, lon, distance_m, altitude_m, speed_mps,
      heart_rate_bpm, cadence, power_w FROM activity_samples WHERE activity_id = ? ORDER BY timestamp NULLS LAST`, [id])).map((sample): JsonValue[] => [
        sample.sample_timestamp === null ? null : timestampText(sample.sample_timestamp), numberOrNull(sample.lat), numberOrNull(sample.lon), numberOrNull(sample.distance_m), numberOrNull(sample.altitude_m), numberOrNull(sample.speed_mps), numberOrNull(sample.heart_rate_bpm), numberOrNull(sample.cadence), numberOrNull(sample.power_w),
      ])
    const sampleFiles: string[] = []
    for (let offset = 0; offset < samples.length; offset += SAMPLE_CHUNK_SIZE) {
      const path = `samples/${String(index).padStart(6, '0')}-${String(offset / SAMPLE_CHUNK_SIZE).padStart(4, '0')}.json`
      files[path] = strToU8(JSON.stringify(samples.slice(offset, offset + SAMPLE_CHUNK_SIZE)))
      sampleFiles.push(path)
    }
    const provenance = provenanceById.get(id) ?? null
    workouts.push({ activity, revision: revisionFor(activity, samples, provenance), provenance, sampleCount: samples.length, sampleFiles })
    totalSamples += samples.length
  }
  onProgress?.({ stage: 'packing', completed: rows.length, total: rows.length })
  const manifest: Manifest = { format: PORTABLE_ARCHIVE_FORMAT, createdAt: new Date().toISOString(), producer: 'workout-analyze', workoutCount: workouts.length, sampleCount: totalSamples, workouts }
  files['manifest.json'] = strToU8(JSON.stringify(manifest))
  return zipSync(files, { level: 6 })
}

const parseBundle = (bytes: Uint8Array, onProgress?: (value: ArchiveProgress) => void) => {
  if (!bytes.length || bytes.length > PORTABLE_ARCHIVE_MAX_COMPRESSED_BYTES) throw new Error('Archive is empty or exceeds the 128 MiB import limit')
  onProgress?.({ stage: 'validating', completed: 0, total: bytes.length })
  let files: Record<string, Uint8Array>
  let declaredExpanded = 0
  let fileCount = 0
  try {
    files = unzipSync(bytes, { filter: (file) => {
      declaredExpanded += file.originalSize; fileCount += 1
      if (declaredExpanded > MAX_EXPANDED_BYTES || fileCount > 100_000) throw new Error('archive limits')
      return true
    } })
  } catch (error) {
    if (error instanceof Error && error.message === 'archive limits') throw new Error('Archive exceeds expanded size or file-count limits')
    throw new Error('Archive is not a readable ZIP bundle')
  }
  const expanded = Object.values(files).reduce((sum, file) => sum + file.byteLength, 0)
  if (expanded > MAX_EXPANDED_BYTES) throw new Error('Archive exceeds the 512 MiB expanded limit')
  const rawManifest = files['manifest.json']
  if (!rawManifest) throw new Error('Archive manifest is missing')
  let manifest: Manifest
  try { manifest = JSON.parse(strFromU8(rawManifest)) as Manifest } catch { throw new Error('Archive manifest is invalid JSON') }
  if (manifest.format !== PORTABLE_ARCHIVE_FORMAT || !Array.isArray(manifest.workouts) || manifest.workoutCount !== manifest.workouts.length || !Number.isSafeInteger(manifest.sampleCount) || manifest.workoutCount > 20_000) throw new Error('Archive format or counts are invalid')
  const ids = new Set<string>()
  const parsed = manifest.workouts.map((workout, index) => {
    if (!workout || !validActivity(workout.activity) || !validProvenance(workout.provenance) || ids.has(workout.activity.id) || typeof workout.revision !== 'string' || !/^[a-f0-9]{64}$/.test(workout.revision) || !Array.isArray(workout.sampleFiles) || new Set(workout.sampleFiles).size !== workout.sampleFiles.length || !Number.isSafeInteger(workout.sampleCount) || workout.sampleCount < 0) throw new Error(`Archive workout ${index + 1} is invalid`)
    ids.add(workout.activity.id)
    const samples: JsonValue[][] = []
    for (const path of workout.sampleFiles) {
      if (typeof path !== 'string' || !/^samples\/[0-9-]+\.json$/.test(path) || !files[path]) throw new Error(`Archive sample chunk is invalid for ${workout.activity.id}`)
      let chunk: unknown
      try { chunk = JSON.parse(strFromU8(files[path]!)) } catch { throw new Error(`Archive sample chunk is invalid JSON for ${workout.activity.id}`) }
      if (!Array.isArray(chunk) || chunk.length > SAMPLE_CHUNK_SIZE || !chunk.every(validSample)) throw new Error(`Archive sample rows are invalid for ${workout.activity.id}`)
      samples.push(...chunk as JsonValue[][])
    }
    if (samples.length !== workout.sampleCount || revisionFor(workout.activity, samples, workout.provenance) !== workout.revision) throw new Error(`Archive revision check failed for ${workout.activity.id}`)
    return { workout, samples }
  })
  if (parsed.reduce((sum, item) => sum + item.samples.length, 0) !== manifest.sampleCount) throw new Error('Archive total sample count is invalid')
  return { manifest, parsed }
}

const tableExists = async (database: DatabaseHost, table: string) => Number((await database.query('SELECT count(*) count FROM information_schema.tables WHERE table_name = ?', [table]))[0]?.count ?? 0) > 0

export const importPortableArchive = async (database: DatabaseHost, bytes: Uint8Array, onProgress?: (value: ArchiveProgress) => void): Promise<ArchiveImportSummary> => {
  const { manifest, parsed } = parseBundle(bytes, onProgress)
  await ensureIphoneNormalizationSchema(database)
  await database.execute(`CREATE TABLE IF NOT EXISTS portable_archive_sources (
    activity_id VARCHAR PRIMARY KEY, revision VARCHAR NOT NULL, archive_format VARCHAR NOT NULL, imported_at TIMESTAMPTZ NOT NULL
  )`)
  const existingRows = await database.query('SELECT id FROM activities')
  const existing = new Set(existingRows.map((row) => String(row.id)))
  const known = new Map((await database.query('SELECT activity_id, revision FROM portable_archive_sources')).map((row) => [String(row.activity_id), String(row.revision)]))
  const conflicts: Array<{ id: string; reason: string }> = []
  const inserts = parsed.filter(({ workout }) => {
    if (!existing.has(workout.activity.id)) return true
    if (known.get(workout.activity.id) === workout.revision) return false
    conflicts.push({ id: workout.activity.id, reason: known.has(workout.activity.id) ? 'A different imported revision is already present' : 'A local workout with this ID has unknown provenance' })
    return false
  })
  onProgress?.({ stage: 'merging', completed: 0, total: inserts.length })
  await database.transaction(async (transaction) => {
    for (let index = 0; index < inserts.length; index += 1) {
      const { workout, samples } = inserts[index]!
      const activity = workout.activity
      await transaction.bulkInsert('activities', activityColumns, [[activity.id, activity.source, activity.sourceActivityId, activity.sport, databaseTimestamp(activity.startedAt), activity.durationSeconds, activity.distanceM, activity.ascentM, activity.avgHrBpm, activity.maxHrBpm]])
      for (let offset = 0; offset < samples.length; offset += SAMPLE_CHUNK_SIZE) {
        await transaction.bulkInsert('activity_samples', sampleColumns, samples.slice(offset, offset + SAMPLE_CHUNK_SIZE).map((row): DatabaseValue[] => [activity.id, row[0] === null ? null : databaseTimestamp(String(row[0])), ...row.slice(1) as DatabaseValue[]]))
      }
      if (workout.provenance) await transaction.bulkInsert('normalization_sources', ['activity_id', 'source', 'source_activity_id', 'input_kind', 'normalization_version', 'source_version', 'observation_count', 'sample_count', 'normalized_at'], [[activity.id, activity.source, activity.sourceActivityId, workout.provenance.inputKind, workout.provenance.normalizationVersion, workout.provenance.sourceVersion, 0, workout.sampleCount, databaseTimestamp(new Date())]])
      await transaction.bulkInsert('portable_archive_sources', ['activity_id', 'revision', 'archive_format', 'imported_at'], [[activity.id, workout.revision, PORTABLE_ARCHIVE_FORMAT, databaseTimestamp(new Date())]])
      onProgress?.({ stage: 'merging', completed: index + 1, total: inserts.length })
    }
    if (inserts.length) {
      for (const table of ['route_coverages', 'route_traversals', 'detected_routes', 'analysis_settings']) if (await tableExists(transaction, table)) await transaction.execute(`DELETE FROM ${table}`)
    }
  })
  return { workouts: manifest.workoutCount, samples: manifest.sampleCount, inserted: inserts.length, unchanged: parsed.length - inserts.length - conflicts.length, conflicts, analysisRebuildRequired: inserts.length > 0 }
}
