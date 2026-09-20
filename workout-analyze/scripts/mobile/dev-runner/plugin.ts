import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { createRunnerStore, maxResultBytes, type RunnerStore } from './store.ts'

export const runnerRoute = '/__workout/run'
const maxRequestBytes = maxResultBytes

const send = (response: ServerResponse, status: number, value: unknown) => {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify(value))
}
const sameOrigin = (request: IncomingMessage) => {
  const origin = request.headers.origin
  if (!origin) return true
  try { return new URL(origin).host === request.headers.host } catch { return false }
}
const body = (request: IncomingMessage) => new Promise<unknown>((resolve, reject) => {
  const chunks: Buffer[] = []
  let bytes = 0
  request.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes <= maxRequestBytes) chunks.push(chunk) })
  request.on('end', () => {
    if (bytes > maxRequestBytes) return reject(new Error('Request body is too large'))
    try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { reject(new Error('Invalid JSON')) }
  })
  request.on('error', reject)
})
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const bounded = (value: unknown, maximum: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= maximum
const clientKinds = new Set(['native', 'simulator', 'unavailable'])
const completionStatuses = new Set(['succeeded', 'failed', 'timedOut', 'unknown'])

export const devRunnerMiddleware = (store: RunnerStore) => async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
  if (!url.pathname.startsWith(runnerRoute)) return next()
  if (!sameOrigin(request)) return send(response, 403, { error: 'Cross-origin runner requests are not allowed' })
  try {
    if (url.pathname === runnerRoute && request.method === 'GET') return send(response, 200, store.list())
    if (url.pathname === runnerRoute && request.method === 'POST') {
      const value = await body(request)
      if (!record(value)) throw new Error('Invalid job')
      return send(response, 202, store.create({ code: value.code as string, timeoutMs: value.timeoutMs as number | undefined, targetKind: value.targetKind as never, targetClientId: value.targetClientId as string | undefined }))
    }
    if (url.pathname === `${runnerRoute}/claim` && request.method === 'POST') {
      const value = await body(request)
      if (!record(value) || !bounded(value.clientId, 128) || !bounded(value.kind, 32) || !clientKinds.has(value.kind) || !bounded(value.label, 128) || !bounded(value.sourceUrl, 2_048)) throw new Error('Invalid client metadata')
      return send(response, 200, { job: store.claim({ clientId: value.clientId, kind: value.kind as never, label: value.label, sourceUrl: value.sourceUrl, build: typeof value.build === 'string' ? value.build : null }) })
    }
    const match = url.pathname.match(/^\/__workout\/run\/([^/]+)(?:\/(result|abandon))?$/)
    if (match?.[2] === 'result' && request.method === 'POST') {
      const value = await body(request)
      if (!record(value) || !bounded(value.clientId, 128) || typeof value.status !== 'string' || !completionStatuses.has(value.status) || typeof value.durationMs !== 'number' || !Number.isFinite(value.durationMs) || value.durationMs < 0) throw new Error('Invalid result')
      const accepted = store.complete(decodeURIComponent(match[1]!), value.clientId, value as never)
      return send(response, accepted ? 200 : 409, { accepted })
    }
    if (match?.[2] === 'abandon' && request.method === 'POST') {
      const value = await body(request)
      if (!record(value) || typeof value.clientId !== 'string') throw new Error('Invalid abandonment')
      const accepted = store.abandon(decodeURIComponent(match[1]!), value.clientId)
      return send(response, accepted ? 200 : 409, { accepted })
    }
    if (match && request.method === 'GET') {
      const job = await store.wait(decodeURIComponent(match[1]!), Number(url.searchParams.get('waitMs') ?? 0))
      return send(response, job ? 200 : 404, job ?? { error: 'Job not found' })
    }
    response.setHeader('Allow', 'GET, POST')
    return send(response, 405, { error: 'Method not allowed' })
  } catch (error) {
    return send(response, error instanceof Error && error.message.includes('large') ? 413 : 400, { error: error instanceof Error ? error.message : 'Invalid request' })
  }
}

export const devRunnerPlugin = (): Plugin => ({
  name: 'workout-iphone-dev-runner',
  apply: 'serve',
  configureServer(server) {
    const store = createRunnerStore()
    server.config.logger.info(`[iphone runner] POST ${runnerRoute}; GET ${runnerRoute}/:id`)
    server.middlewares.use(devRunnerMiddleware(store))
  },
})
