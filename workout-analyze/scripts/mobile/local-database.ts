import { resolve } from 'node:path'
import { basename, join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { DuckDBInstance } from '@duckdb/node-api'
import type { DuckDBConnection } from '@duckdb/node-api'
import type { Plugin } from 'vite'
import type { DatabaseHost } from '../../src/engine/database.ts'
import { createBunDuckDbConnectionHost } from '../../src/hosts/bun/DuckDbHost.ts'
import { exportPortableArchive, PORTABLE_ARCHIVE_EXTENSION } from '../../src/engine/portable-archive.ts'
import { PARQUET_ARCHIVE_FORMAT, type ParquetArchiveManifest } from '../../src/engine/parquet-archive.ts'

type Operation =
  | { op: 'query' | 'execute'; sql: string; parameters?: unknown[]; transactionId?: string }
  | { op: 'bulkInsert'; table: string; columns: string[]; rows: unknown[][]; transactionId?: string }
  | { op: 'begin' }
  | { op: 'commit' | 'rollback'; transactionId: string }

const readBody = (request: import('node:http').IncomingMessage) => new Promise<string>((resolveBody, reject) => {
  let body = ''
  request.setEncoding('utf8')
  request.on('data', (chunk) => {
    body += chunk
    if (body.length > 32 * 1024 * 1024) reject(new Error('Database request is too large'))
  })
  request.on('end', () => resolveBody(body))
  request.on('error', reject)
})

const json = (value: unknown) => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? { $databaseBigInt: item.toString() } : item)
const parse = (value: string) => JSON.parse(value, (_key, item) => item && typeof item === 'object' && Object.keys(item).length === 1 && typeof item.$databaseBigInt === 'string' ? BigInt(item.$databaseBigInt) : item) as Operation

const allowedArchiveOrigin = (origin: string) => {
  // WKWebView's bundled custom-scheme page can be reported either explicitly
  // or as an opaque `null` origin depending on WebKit version.
  if (origin === 'null' || origin === 'workout-analyze://app') return true
  try {
    const url = new URL(origin)
    return url.protocol === 'https:' && url.hostname.endsWith('.ts.net')
      || url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
      || url.protocol === 'workout-analyze:' && url.hostname === 'app'
  } catch { return false }
}

const sqlString = (value: string) => `'${value.replaceAll("'", "''")}'`
const sha256File = (path: string) => new Promise<string>((resolveHash, reject) => {
  const hash = createHash('sha256')
  createReadStream(path).on('data', (chunk) => hash.update(chunk)).on('error', reject).on('end', () => resolveHash(hash.digest('hex')))
})

type ParquetExport = { directory: string; manifest: ParquetArchiveManifest; created: number }
export const createParquetExport = async (connection: DuckDBConnection): Promise<ParquetExport> => {
  const exportId = randomUUID().toLowerCase()
  const directory = mkdtempSync(join(tmpdir(), `workout-parquet-${exportId}-`))
  const activitiesPath = join(directory, 'activities.parquet')
  const samplesPath = join(directory, 'samples.parquet')
  try {
    await connection.run('BEGIN TRANSACTION')
    try {
      await connection.run(`CREATE OR REPLACE TEMP TABLE portable_export_activities AS
        WITH sample_digest AS (
          SELECT activity_id, count(*)::BIGINT sample_count,
            sha256(string_agg(to_json(struct_pack(sample_timestamp := timestamp, lat := lat, lon := lon, distance_m := distance_m,
              altitude_m := altitude_m, speed_mps := speed_mps, heart_rate_bpm := heart_rate_bpm, cadence := cadence, power_w := power_w)), '\n'
              ORDER BY timestamp NULLS LAST, lat NULLS LAST, lon NULLS LAST, distance_m NULLS LAST, altitude_m NULLS LAST,
                speed_mps NULLS LAST, heart_rate_bpm NULLS LAST, cadence NULLS LAST, power_w NULLS LAST)) sample_digest
          FROM activity_samples GROUP BY activity_id
        ), canonical AS (
          SELECT a.id, a.source, a.source_activity_id, a.sport, a.started_at, a.duration_seconds, a.distance_m, a.ascent_m,
            a.avg_hr_bpm, a.max_hr_bpm, n.input_kind, n.normalization_version, n.source_version,
            coalesce(n.observation_count, 0)::BIGINT observation_count, coalesce(s.sample_count, 0)::BIGINT sample_count,
            coalesce(s.sample_digest, sha256('')) sample_digest
          FROM activities a LEFT JOIN normalization_sources n ON n.activity_id=a.id LEFT JOIN sample_digest s ON s.activity_id=a.id
        )
        SELECT * EXCLUDE(sample_digest), sha256(to_json(struct_pack(id := id, source := source, source_activity_id := source_activity_id,
          sport := sport, started_at := started_at, duration_seconds := duration_seconds, distance_m := distance_m, ascent_m := ascent_m,
          avg_hr_bpm := avg_hr_bpm, max_hr_bpm := max_hr_bpm, input_kind := input_kind, normalization_version := normalization_version,
          source_version := source_version, observation_count := observation_count, sample_count := sample_count, sample_digest := sample_digest))) revision
        FROM canonical ORDER BY id`)
      await connection.run(`COPY portable_export_activities TO ${sqlString(activitiesPath)} (FORMAT PARQUET, COMPRESSION SNAPPY)`)
      await connection.run(`COPY (SELECT activity_id, timestamp, lat, lon, distance_m, altitude_m, speed_mps, heart_rate_bpm, cadence, power_w
        FROM activity_samples ORDER BY activity_id, timestamp NULLS LAST, lat NULLS LAST, lon NULLS LAST) TO ${sqlString(samplesPath)} (FORMAT PARQUET, COMPRESSION SNAPPY)`)
      const counts = (await connection.runAndReadAll('SELECT (SELECT count(*) FROM portable_export_activities) workout_count, (SELECT count(*) FROM activity_samples) sample_count')).getRowObjectsJS()[0]!
      await connection.run('COMMIT')
      const manifest: ParquetArchiveManifest = {
        format: PARQUET_ARCHIVE_FORMAT, schemaVersion: 1, exportId, createdAt: new Date().toISOString(),
        workoutCount: Number(counts.workout_count), sampleCount: Number(counts.sample_count),
        files: await Promise.all(([['activities', activitiesPath], ['samples', samplesPath]] as const).map(async ([role, path]) => ({ role, path: basename(path), sizeBytes: statSync(path).size, sha256: await sha256File(path) }))),
      }
      return { directory, manifest, created: Date.now() }
    } catch (error) { await connection.run('ROLLBACK').catch(() => undefined); throw error }
  } catch (error) { rmSync(directory, { recursive: true, force: true }); throw error }
}

export const servePortableArchive = async (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse, database: DatabaseHost) => {
  response.setHeader('Cache-Control', 'no-store')
  const origin = request.headers.origin
  if (origin && allowedArchiveOrigin(origin)) response.setHeader('Access-Control-Allow-Origin', origin)
  if (request.method === 'OPTIONS') { response.statusCode = 204; response.end(); return }
  if (request.method !== 'GET') { response.statusCode = 405; response.end('Archive download accepts GET requests only'); return }
  try {
    // prepareSchema=false is deliberate: this endpoint is a query-only view of the existing archive.
    const bytes = await exportPortableArchive(database, undefined, { prepareSchema: false })
    response.setHeader('Content-Type', 'application/zip')
    response.setHeader('Content-Length', String(bytes.byteLength))
    response.setHeader('Content-Disposition', `attachment; filename="workout-analyze-${new Date().toISOString().slice(0, 10)}${PORTABLE_ARCHIVE_EXTENSION}"`)
    response.end(Buffer.from(bytes))
  } catch (error) {
    response.statusCode = 500
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Archive export failed' }))
  }
}

export const localDatabasePlugin = (): Plugin => {
  let instance: DuckDBInstance | null = null
  const transactions = new Map<string, { connection: DuckDBConnection; host: DatabaseHost }>()
  const parquetExports = new Map<string, ParquetExport>()
  const database = async () => instance ??= await DuckDBInstance.create(resolve(process.env.FITNESS_DATABASE_PATH ?? 'data/fitness.duckdb'))
  const connection = async () => {
    const value = await (await database()).connect()
    return { connection: value, host: createBunDuckDbConnectionHost(value) }
  }
  return {
    name: 'workout-local-database-host', apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__workout/portable-parquet', async (request, response) => {
        response.setHeader('Cache-Control', 'no-store')
        const origin = request.headers.origin
        if (origin && allowedArchiveOrigin(origin)) response.setHeader('Access-Control-Allow-Origin', origin)
        if (request.method === 'OPTIONS') { response.statusCode = 204; response.end(); return }
        if (request.method !== 'GET') { response.statusCode = 405; response.end('Parquet archive accepts GET requests only'); return }
        for (const [id, item] of parquetExports) if (Date.now() - item.created > 15 * 60_000) { parquetExports.delete(id); rmSync(item.directory, { recursive: true, force: true }) }
        try {
          const parts = (request.url ?? '/').split('?')[0]!.split('/').filter(Boolean)
          if (parts.length === 1 && parts[0] === 'manifest.json') {
            const opened = await connection()
            try {
              const item = await createParquetExport(opened.connection)
              parquetExports.set(item.manifest.exportId, item)
              response.setHeader('Content-Type', 'application/json')
              response.end(JSON.stringify(item.manifest))
            } finally { opened.connection.closeSync() }
            return
          }
          if (parts.length === 2) {
            const item = parquetExports.get(parts[0]!)
            const file = item?.manifest.files.find((candidate) => candidate.path === parts[1])
            const path = item && file ? join(item.directory, file.path) : null
            if (!path || !existsSync(path)) { response.statusCode = 404; response.end('Parquet export is missing or expired'); return }
            response.setHeader('Content-Type', 'application/vnd.apache.parquet')
            response.setHeader('Content-Length', String(file!.sizeBytes))
            response.setHeader('Content-Disposition', `attachment; filename="${file!.path}"`)
            createReadStream(path).pipe(response)
            return
          }
          response.statusCode = 404; response.end('Unknown Parquet archive path')
        } catch (error) {
          response.statusCode = 500; response.setHeader('Content-Type', 'application/json')
          response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Parquet export failed' }))
        }
      })
      server.middlewares.use('/__workout/portable-archive', async (request, response) => {
        let temporary: DuckDBConnection | null = null
        try {
          const opened = await connection(); temporary = opened.connection
          await servePortableArchive(request, response, opened.host)
        } finally { temporary?.closeSync() }
      })
      server.middlewares.use('/__workout/database', async (request, response) => {
        response.setHeader('Content-Type', 'application/json')
        response.setHeader('Cache-Control', 'no-store')
        let temporary: DuckDBConnection | null = null
        try {
          if (request.method !== 'POST') throw new Error('Database host accepts POST requests only')
          const origin = request.headers.origin
          if (origin && new URL(origin).host !== request.headers.host) throw new Error('Cross-origin database access is not allowed')
          const operation = parse(await readBody(request))
          if (operation.op === 'begin') {
            const opened = await connection(); temporary = opened.connection
            await opened.host.execute('BEGIN TRANSACTION')
            const transactionId = crypto.randomUUID()
            transactions.set(transactionId, opened); temporary = null
            response.end(json({ transactionId })); return
          }
          if (operation.op === 'commit' || operation.op === 'rollback') {
            const active = transactions.get(operation.transactionId)
            if (!active) throw new Error('Unknown database transaction')
            transactions.delete(operation.transactionId)
            try { await active.host.execute(operation.op === 'commit' ? 'COMMIT' : 'ROLLBACK') } finally { active.connection.closeSync() }
            response.end('{}'); return
          }
          const active = operation.transactionId ? transactions.get(operation.transactionId) : await connection()
          if (!active) throw new Error('Unknown database transaction')
          if (!operation.transactionId) temporary = active.connection
          if (operation.op === 'query') response.end(json({ rows: await active.host.query(operation.sql, operation.parameters as never) }))
          else if (operation.op === 'execute') { await active.host.execute(operation.sql, operation.parameters as never); response.end('{}') }
          else if (operation.op === 'bulkInsert') { await active.host.bulkInsert(operation.table, operation.columns, operation.rows as never); response.end('{}') }
          else throw new Error('Invalid database operation')
        } catch (error) {
          response.statusCode = 400
          response.end(json({ error: error instanceof Error ? error.message : 'Database host request failed' }))
        } finally { temporary?.closeSync() }
      })
    },
    async closeBundle() {
      for (const { connection, host } of transactions.values()) { await host.execute('ROLLBACK').catch(() => undefined); connection.closeSync() }
      transactions.clear()
      for (const item of parquetExports.values()) rmSync(item.directory, { recursive: true, force: true })
      parquetExports.clear(); instance?.closeSync(); instance = null
    },
  }
}
