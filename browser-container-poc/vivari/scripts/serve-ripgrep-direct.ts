import { createHash } from 'node:crypto'
import { readdirSync } from 'node:fs'
import { resolve, sep } from 'node:path'

const root = resolve(import.meta.dir, '..')
const pkg = resolve(root, 'probes/ripgrep/node_modules/ripgrep')
const metadata = await Bun.file(resolve(pkg, 'package.json')).json()
if (metadata.version !== '0.3.1') throw Error('Requires ripgrep@0.3.1')
const assets: { file: string; bytes: number; sha256: string }[] = []
async function collect(directory: string, relative = '') {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = relative ? `${relative}/${entry.name}` : entry.name
    if (entry.isDirectory()) await collect(resolve(directory, entry.name), file)
    else {
      if (!entry.isFile()) throw Error('Unexpected package entry: ' + file)
      const bytes = new Uint8Array(await Bun.file(resolve(directory, entry.name)).arrayBuffer())
      assets.push({ file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
    }
  }
}
await collect(pkg)
// Bundle only the embedding harness. Guest package files are delivered verbatim.
const built = await Bun.build({ entrypoints: [resolve(root, 'probes/ripgrep-direct.ts')], target: 'browser', format: 'esm' })
if (!built.success) throw new AggregateError(built.logs)
const code = await built.outputs[0].text()
const headers = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Service-Worker-Allowed': '/', 'Cache-Control': 'no-store' }
const server = Bun.serve({ hostname: '127.0.0.1', port: Number(process.env.PORT || 43930), async fetch(request) {
  const path = new URL(request.url).pathname
  if (path === '/') return new Response('<!doctype html><title>Unmodified ripgrep qualification</title><pre>Direct package loading\n</pre><script type="module" src="/probe.js"></script>', {headers:{...headers,'content-type':'text/html'}})
  if (path === '/probe.js') return new Response(code, {headers:{...headers,'content-type':'text/javascript'}})
  if (path === '/package-manifest') return Response.json({package:'ripgrep@0.3.1',transforms:[],assets}, {headers})
  if (path === '/guest-probe.mjs') return new Response(Bun.file(resolve(root, 'probes/runtime/ripgrep-direct.mjs')), {headers})
  for (const [prefix, directory] of [['/runtime/', resolve(root, '../workspace-api/dist/runtime')], ['/package/', pkg]]) {
    if (!path.startsWith(prefix!)) continue
    const target = resolve(directory!, decodeURIComponent(path.slice(prefix!.length)))
    if (!target.startsWith(directory + sep)) return new Response('Invalid path', {status:400,headers})
    const file = Bun.file(target)
    if (await file.exists()) return new Response(file, {headers})
  }
  return new Response('Not found', {status:404,headers})
} })
console.log(`Unmodified ripgrep: ${server.url}`)
