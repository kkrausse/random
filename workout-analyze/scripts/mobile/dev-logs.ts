import { appendFile, mkdir, rename, stat, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

export const diagnosticsRoute = '/__workout/diagnostics'
export const maxDiagnosticsBodyBytes = 128 * 1024
export const maxDiagnosticsBatchEvents = 64

const maxRecentEvents = 100
const maxRememberedEventIds = 4_096
const maxLogBytes = 1024 * 1024
const rotatedLogCount = 3
const logFileName = 'native-diagnostics.jsonl'

export type DiagnosticLevel = 'debug' | 'info' | 'warning' | 'error'

export interface DiagnosticEvent {
  id: string
  timestamp: string
  subsystem: string
  level: DiagnosticLevel
  message: string
  metadata?: Record<string, string | number | boolean | null>
}

export interface DiagnosticsUpload {
  formatVersion: 1
  uploadId: string
  events: DiagnosticEvent[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasOnlyKeys = (value: Record<string, unknown>, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key))

const isBoundedString = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max

const levels = new Set<DiagnosticLevel>(['debug', 'info', 'warning', 'error'])

const parseEvent = (value: unknown): DiagnosticEvent => {
  if (!isRecord(value) || !hasOnlyKeys(value, ['id', 'timestamp', 'subsystem', 'level', 'message', 'metadata'])) {
    throw new Error('Invalid diagnostic event')
  }
  if (!isBoundedString(value.id, 128) || !isBoundedString(value.timestamp, 64) || Number.isNaN(Date.parse(value.timestamp))) {
    throw new Error('Invalid diagnostic event identity or timestamp')
  }
  if (!isBoundedString(value.subsystem, 128) || !isBoundedString(value.message, 8_192) || typeof value.level !== 'string' || !levels.has(value.level as DiagnosticLevel)) {
    throw new Error('Invalid diagnostic event content')
  }

  let metadata: DiagnosticEvent['metadata']
  if (value.metadata !== undefined) {
    if (!isRecord(value.metadata) || Object.keys(value.metadata).length > 32) throw new Error('Invalid diagnostic metadata')
    metadata = {}
    for (const [key, item] of Object.entries(value.metadata)) {
      if (!isBoundedString(key, 128) || !(['string', 'number', 'boolean'].includes(typeof item) || item === null)) throw new Error('Invalid diagnostic metadata')
      if (typeof item === 'string' && item.length > 2_048) throw new Error('Invalid diagnostic metadata')
      if (typeof item === 'number' && !Number.isFinite(item)) throw new Error('Invalid diagnostic metadata')
      metadata[key] = item as string | number | boolean | null
    }
  }

  return { id: value.id, timestamp: value.timestamp, subsystem: value.subsystem, level: value.level as DiagnosticLevel, message: value.message, ...(metadata ? { metadata } : {}) }
}

export const parseDiagnosticsUpload = (value: unknown): DiagnosticsUpload => {
  if (!isRecord(value) || !hasOnlyKeys(value, ['formatVersion', 'uploadId', 'events']) || value.formatVersion !== 1 || !isBoundedString(value.uploadId, 128) || !Array.isArray(value.events)) {
    throw new Error('Invalid diagnostics upload')
  }
  if (value.events.length > maxDiagnosticsBatchEvents) throw new Error('Too many diagnostic events')
  return { formatVersion: 1, uploadId: value.uploadId, events: value.events.map(parseEvent) }
}

const sensitiveKey = /(?:authorization|cookie|credential|password|passwd|secret|session|token|api[-_]?key|access[-_]?key|latitude|longitude|coordinate|heart[-_ ]?rate|heartrate|\bhr\b)/i
const sensitiveQueryKey = /(?:authorization|auth|code|credential|key|password|secret|session|signature|token)/i

const redactUrls = (message: string) => message.replace(/https?:\/\/[^\s<>"']+/gi, (raw) => {
  const trailing = raw.match(/[),.;!?]+$/)?.[0] ?? ''
  const candidate = trailing ? raw.slice(0, -trailing.length) : raw
  try {
    const url = new URL(candidate)
    if (url.username) url.username = 'REDACTED'
    if (url.password) url.password = 'REDACTED'
    for (const key of url.searchParams.keys()) if (sensitiveQueryKey.test(key)) url.searchParams.set(key, 'REDACTED')
    return `${url.toString()}${trailing}`
  } catch {
    return '[REDACTED_URL]'
  }
})

export const redactDiagnosticEvent = (event: DiagnosticEvent): DiagnosticEvent => {
  const metadata = event.metadata && Object.fromEntries(Object.entries(event.metadata).map(([key, value]) => [
    key,
    sensitiveKey.test(key) ? '[REDACTED]' : typeof value === 'string' ? redactUrls(value) : value,
  ]))
  const message = redactUrls(event.message)
    .replace(/(?<![?&])\b(?:authorization|password|passwd|secret|token)\s*[:=]\s*[^\s,;&#?]+/gi, (match) => `${match.split(/[:=]/, 1)[0]}=[REDACTED]`)
    .replace(/\b(?:lat(?:itude)?|lon(?:gitude)?|heart[-_ ]?rate|heartrate|hr)\s*[:=]\s*-?\d+(?:\.\d+)?/gi, (match) => `${match.split(/[:=]/, 1)[0]}=[REDACTED]`)
  return { ...event, message, ...(metadata ? { metadata } : {}) }
}

const removeIfPresent = async (path: string) => { try { await unlink(path) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error } }
const renameIfPresent = async (from: string, to: string) => { try { await rename(from, to) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error } }

export class DiagnosticLogStore {
  readonly directory: string
  private recent: DiagnosticEvent[] = []
  private rememberedIds = new Set<string>()
  private writes: Promise<void> = Promise.resolve()
  private print: (line: string) => void

  constructor({ directory = resolve(tmpdir(), 'workout-analyze', 'dev-diagnostics'), print = console.info }: { directory?: string, print?: (line: string) => void } = {}) {
    this.directory = directory
    this.print = print
  }

  ingest(events: DiagnosticEvent[]): Promise<void> {
    const run = this.writes.then(async () => {
      const batchIds = new Set<string>()
      const unique = events.filter((event) => {
        if (this.rememberedIds.has(event.id) || batchIds.has(event.id)) return false
        batchIds.add(event.id)
        return true
      }).map(redactDiagnosticEvent)
      if (unique.length === 0) return
      await mkdir(this.directory, { recursive: true })
      const path = resolve(this.directory, logFileName)
      const content = `${unique.map((event) => JSON.stringify(event)).join('\n')}\n`
      const currentSize = await stat(path).then((value) => value.size).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? 0 : Promise.reject(error))
      if (currentSize + Buffer.byteLength(content) > maxLogBytes) {
        await removeIfPresent(resolve(this.directory, `${logFileName}.${rotatedLogCount}`))
        for (let index = rotatedLogCount - 1; index >= 1; index -= 1) await renameIfPresent(resolve(this.directory, `${logFileName}.${index}`), resolve(this.directory, `${logFileName}.${index + 1}`))
        await renameIfPresent(path, resolve(this.directory, `${logFileName}.1`))
      }
      await appendFile(path, content, { encoding: 'utf8', mode: 0o600 })
      for (const event of unique) {
        this.rememberedIds.add(event.id)
        while (this.rememberedIds.size > maxRememberedEventIds) this.rememberedIds.delete(this.rememberedIds.values().next().value!)
        this.print(`[native ${event.level}] ${event.subsystem}: ${event.message.slice(0, 500)}`)
      }
      this.recent = [...this.recent, ...unique].slice(-maxRecentEvents)
    })
    this.writes = run.catch(() => undefined)
    return run
  }

  latest(): DiagnosticEvent[] { return [...this.recent] }
}

const sendJson = (response: ServerResponse, status: number, value: unknown) => {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify(value))
}

const hasAllowedOrigin = (request: IncomingMessage) => {
  const origin = request.headers.origin
  if (!origin) return true
  try { return new URL(origin).host === request.headers.host } catch { return false }
}

export const devDiagnosticsPlugin = (): Plugin => ({
  name: 'workout-native-dev-diagnostics',
  apply: 'serve',
  configureServer(server) {
    const store = new DiagnosticLogStore()
    server.config.logger.info(`[native diagnostics] POST/GET ${diagnosticsRoute}; JSONL: ${resolve(store.directory, logFileName)}`)
    server.middlewares.use((request, response, next) => {
      if (request.url !== diagnosticsRoute) return next()
      if (!hasAllowedOrigin(request)) return sendJson(response, 403, { error: 'Cross-origin diagnostics requests are not allowed' })
      if (request.method === 'GET') return sendJson(response, 200, { events: store.latest() })
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'GET, POST')
        return sendJson(response, 405, { error: 'Method not allowed' })
      }
      if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) return sendJson(response, 415, { error: 'Content-Type must be application/json' })

      const chunks: Buffer[] = []
      let bytes = 0
      let exceeded = false
      request.on('data', (chunk: Buffer) => {
        bytes += chunk.length
        if (bytes > maxDiagnosticsBodyBytes) exceeded = true
        else chunks.push(chunk)
      })
      request.on('end', async () => {
        if (exceeded) return sendJson(response, 413, { error: 'Diagnostics body exceeds 128 KiB' })
        try {
          const upload = parseDiagnosticsUpload(JSON.parse(Buffer.concat(chunks).toString('utf8')))
          await store.ingest(upload.events)
          sendJson(response, 200, { accepted: true, uploadId: upload.uploadId })
        } catch (error) {
          server.config.logger.warn(`[native diagnostics] rejected upload: ${error instanceof Error ? error.message : 'invalid request'}`)
          sendJson(response, 400, { error: 'Invalid diagnostics upload' })
        }
      })
      request.on('error', () => { if (!response.writableEnded) sendJson(response, 400, { error: 'Unable to read diagnostics upload' }) })
    })
  },
})
