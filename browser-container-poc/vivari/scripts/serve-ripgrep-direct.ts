import { resolve, sep } from 'node:path'
import { directAssets, installation } from './ripgrep-direct-assets.mjs'

const root = resolve(import.meta.dir, '..')
const pkg = resolve(installation, 'ripgrep')
const metadata = await Bun.file(resolve(pkg, 'package.json')).json()
if (metadata.version !== '0.3.1') throw Error('Requires ripgrep@0.3.1')
const assets = directAssets().map(asset => ({file:asset.file,bytes:asset.bytes.length,sha256:asset.sha256}))
// Bundle only the embedding harness. Guest package files are delivered verbatim.
const built = await Bun.build({ entrypoints: [resolve(root, 'probes/ripgrep-direct.ts')], target: 'browser', format: 'esm' })
if (!built.success) throw new AggregateError(built.logs)
const code = await built.outputs[0].text()
const headers = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Service-Worker-Allowed': '/', 'Cache-Control': 'no-store' }
const once = process.argv.includes('--once')
const runID = crypto.randomUUID()
const receipt = resolve(root, '.runtime', `ripgrep-direct-${runID}.json`)
let finished = false
let timer: ReturnType<typeof setTimeout> | undefined
async function report(result: { status: string; runtime?: string; error?: string; results?: { mode: string }[] }, log: string) {
  if (finished) return
  finished = true
  clearTimeout(timer)
  await Bun.write(receipt, JSON.stringify({ runID, result, log }, null, 2) + '\n')
  console.log(JSON.stringify({ status: result.status, runtime: result.runtime,
    checks: result.results?.map(item => item.mode), error: result.error?.split('\n')[0], receipt }))
  if (once) {
    process.exitCode = result.status === 'PASS' ? 0 : 1
    // Let the receipt POST response finish before closing the test host.
    setTimeout(() => { void server.stop(true) }, 100)
  }
}
const server = Bun.serve({ hostname: '127.0.0.1', port: Number(process.env.PORT || (once ? 0 : 43930)), async fetch(request) {
  const path = new URL(request.url).pathname
  if (path === '/run-config') return Response.json({ runID }, {headers})
  if (path === '/result' && request.method === 'POST') {
    const body = await request.json()
    if (body.runID !== runID || !['PASS', 'FAIL'].includes(body.result?.status)) return new Response('Invalid result', {status:400,headers})
    await report(body.result, String(body.log || ''))
    return Response.json({received:true}, {headers})
  }
  if (path === '/') return new Response('<!doctype html><title>Unmodified ripgrep qualification</title><pre>Direct package loading\n</pre><script type="module" src="/probe.js"></script>', {headers:{...headers,'content-type':'text/html'}})
  if (path === '/probe.js') return new Response(code, {headers:{...headers,'content-type':'text/javascript'}})
  if (path === '/package-manifest') return Response.json({package:'ripgrep@0.3.1',transforms:[],assets}, {headers})
  if (path === '/guest-probe.mjs') return new Response(Bun.file(resolve(root, 'probes/runtime/ripgrep-direct.mjs')), {headers})
  if (path === '/guest-command.cjs') return new Response(Bun.file(resolve(root, 'probes/runtime/ripgrep-command.cjs')), {headers})
  for (const [prefix, directory] of [['/runtime/', resolve(root, '../workspace-api/dist/runtime')], ['/package/', installation]]) {
    if (!path.startsWith(prefix!)) continue
    const target = resolve(directory!, decodeURIComponent(path.slice(prefix!.length)))
    if (!target.startsWith(directory + sep)) return new Response('Invalid path', {status:400,headers})
    const file = Bun.file(target)
    if (await file.exists()) return new Response(file, {headers})
  }
  return new Response('Not found', {status:404,headers})
} })
console.log(`Unmodified ripgrep: ${server.url}${once ? '?autorun=1' : ''}`)
if (once) timer = setTimeout(() => { void report({status:'FAIL',error:'Browser qualification timed out after 120 seconds'}, '') }, 120_000)
