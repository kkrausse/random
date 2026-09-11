import { resolve, sep } from 'node:path'
import { modelProxy } from './model-proxy'
import catalog from '../src/provider-upstreams.json'
import { runtimeSourcePath } from './runtime-source.mjs'
const proxy = modelProxy(new Map([['opencode', { baseURL: catalog.upstreams.opencode, headers: { authorization: 'Bearer public' } }]]))
const root = resolve(import.meta.dir, '..')
const built = await Bun.build({ entrypoints: [resolve(root, 'probes/opencode-server.ts')], target: 'browser', format: 'esm' })
if (!built.success) throw new AggregateError(built.logs)
const code = await built.outputs[0].text()
const httpBuilt = await Bun.build({ entrypoints: [resolve(root, 'probes/http-stream.ts')], target: 'browser', format: 'esm' })
if (!httpBuilt.success) throw new AggregateError(httpBuilt.logs)
const httpCode = await httpBuilt.outputs[0].text()
const headers = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Service-Worker-Allowed': '/', 'Cache-Control': 'no-store' }
const server = Bun.serve({ hostname: '127.0.0.1', port: Number(process.env.PORT || 43918), async fetch(request) {
  const path = new URL(request.url).pathname
  if (path.startsWith('/api/model/')) return proxy(request)
  if (path === '/') return new Response('<!doctype html><title>OpenCode server baseline</title><pre>Server-only qualification\n</pre><script type="module" src="/probe.js"></script>', { headers: { ...headers, 'content-type': 'text/html' } })
  if (path === '/probe.js') return new Response(code, { headers: { ...headers, 'content-type': 'text/javascript' } })
  if (path === '/http-stream') return new Response('<!doctype html><title>Runtime HTTP streaming</title><pre>HTTP streaming qualification\n</pre><script type="module" src="/http-stream.js"></script>', { headers: { ...headers, 'content-type': 'text/html' } })
  if (path === '/http-stream.js') return new Response(httpCode, { headers: { ...headers, 'content-type': 'text/javascript' } })
  if (path === '/http-stream-checks.js') return new Response(Bun.file(runtimeSourcePath('scripts/lib/http-stream-checks.mjs')), { headers: { ...headers, 'content-type': 'text/javascript' } })
  if (path === '/http-stream-server.cjs') return new Response(Bun.file(runtimeSourcePath('scripts/fixtures/runtime-contracts/http-stream-server.cjs')), { headers })
  for (const [prefix, directory] of [['/runtime/', '../workspace-api/dist/runtime'], ['/package/', '.runtime/opencode-server-package']]) {
    if (!path.startsWith(prefix!)) continue
    const base = resolve(root, directory!), target = resolve(base, decodeURIComponent(path.slice(prefix!.length)))
    if (!target.startsWith(base + sep)) return new Response('Invalid path', { status: 400 })
    const file = Bun.file(target)
    if (await file.exists()) return new Response(file, { headers })
  }
  return new Response('Not found', { status: 404, headers })
} })
console.log(`Server baseline: ${server.url}`)
