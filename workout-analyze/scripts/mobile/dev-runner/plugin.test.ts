import { afterEach, describe, expect, test } from 'bun:test'
import { createServer, type Server } from 'node:http'
import { devRunnerMiddleware, devRunnerPlugin } from './plugin'
import { createRunnerStore } from './store'

let server: Server | null = null
afterEach(() => { server?.close(); server = null })

describe('iPhone runner HTTP endpoints', () => {
  test('registers only for the Vite development server', () => {
    expect(devRunnerPlugin().apply).toBe('serve')
  })
  test('creates, claims, completes, and long-polls a job', async () => {
    const store = createRunnerStore()
    const middleware = devRunnerMiddleware(store)
    server = createServer((request, response) => { void middleware(request, response, () => { response.statusCode = 404; response.end() }) })
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test server address')
    const base = `http://127.0.0.1:${address.port}/__workout/run`
    const post = (url: string, value: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) })
    const createdResponse = await post(base, { code: 'return 42', timeoutMs: 500 })
    expect(createdResponse.status).toBe(202)
    const created = await createdResponse.json() as { id: string }
    const claim = await (await post(`${base}/claim`, { clientId: 'phone', kind: 'native', label: 'iPhone', sourceUrl: 'http://device/', build: null })).json() as { job: { id: string } }
    expect(claim.job.id).toBe(created.id)
    expect((await post(`${base}/claim`, { clientId: 'phone', kind: 'native', label: 'iPhone', sourceUrl: 'http://device/', build: null }).then((response) => response.json()) as { job: null }).job).toBeNull()
    const waiting = fetch(`${base}/${created.id}?waitMs=1`)
    expect((await post(`${base}/${created.id}/result`, { clientId: 'phone', status: 'succeeded', value: 42, logs: [], durationMs: 1 })).status).toBe(200)
    expect((await waiting.then((response) => response.json()) as { status: string }).status).toBe('succeeded')
  })

  test('rejects cross-origin browser requests', async () => {
    const store = createRunnerStore()
    const middleware = devRunnerMiddleware(store)
    server = createServer((request, response) => { void middleware(request, response, () => response.end()) })
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test server address')
    const response = await fetch(`http://127.0.0.1:${address.port}/__workout/run`, { headers: { Origin: 'https://evil.invalid' } })
    expect(response.status).toBe(403)
  })
})
