import { resolve, sep } from 'node:path'
import { readdir, readFile, stat } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const root = resolve(import.meta.dir, '..')
const output = resolve(root, '.runtime/opencode-bun-server')
const source = resolve(root, '.runtime/opencode-v2-source')
const runtimeDirectory = resolve(root, '../workspace-api/dist/runtime')
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
const git = (...args: string[]) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim()
const files = new Map<string, Uint8Array>()
const assets = []
for (const entry of (await readdir(output, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
  if (!entry.isFile()) throw Error('Unexpected build output: ' + entry.name)
  const file = resolve(output, entry.name), bytes = await readFile(file)
  files.set(entry.name, bytes)
  assets.push({ file: entry.name, destination: '/app/' + entry.name, bytes: bytes.length, sha256: sha256(bytes), modifiedAt: (await stat(file)).mtime.toISOString() })
}
for (const name of ['server.js', 'tree-sitter.wasm', 'tree-sitter-bash.wasm', 'tree-sitter-powershell.wasm']) {
  if (!files.has(name)) throw Error('Missing app output: ' + name)
}
const inputs = []
for (const file of ['server.ts', 'build.ts', 'package.json', 'bun.lock']) {
  const path = resolve(root, 'experiments/opencode-bun-server', file)
  const bytes = await readFile(path).catch(error => { if (error.code === 'ENOENT') return null; throw error })
  inputs.push({ file: 'experiments/opencode-bun-server/' + file, sha256: bytes ? sha256(bytes) : null })
}
const runtimeManifest = await Bun.file(resolve(runtimeDirectory, 'distribution.json')).json()
const sourceStatus = git('status', '--short')
const manifest = {
  observedAt: new Date().toISOString(), assets,
  provenance: {
    note: 'Observed current source and build recipe; no build-time attestation exists linking these inputs to the emitted files. Dirty upstream state, including any preexisting TUI edit, is retained below.',
    source: { path: source, revision: git('rev-parse', 'HEAD'), status: sourceStatus, dirty: !!sourceStatus,
      diffSha256: sha256(git('diff', 'HEAD', '--binary')), lockSha256: sha256(await readFile(resolve(source, 'bun.lock'))) },
    inputs, buildReceipt: null, hostBunVersion: Bun.version,
    runtime: { version: runtimeManifest.version, receipt: runtimeManifest.runtimeBuild ?? null },
  },
}
// Bundle only the browser harness; guest app and runtime distributions are prebuilt inputs.
const built = await Bun.build({ entrypoints: [resolve(root, 'probes/opencode-bun-server.ts')], target: 'browser', format: 'esm' })
if (!built.success) throw new AggregateError(built.logs)
const code = await built.outputs[0].text()
const headers = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Service-Worker-Allowed': '/', 'Cache-Control': 'no-store' }
const sessionRetention = process.argv.includes('--session-retention')
const once = process.argv.includes('--once'), restart = sessionRetention || process.argv.includes('--restart'), runID = crypto.randomUUID()
const timeoutSeconds = restart ? 360 : 180
const receipt = resolve(root, '.runtime', `opencode-bun-${runID}.json`)
let finished = false, timer: ReturnType<typeof setTimeout> | undefined
type Result = { status: string; runtime?: string; error?: string; checks?: string[] }
async function report(result: Result) {
  if (finished) return
  finished = true
  clearTimeout(timer)
  try {
    await Bun.write(receipt, JSON.stringify({ runID, restart, sessionRetention, manifest, result }, null, 2) + '\n')
    console.log(JSON.stringify({ status: result.status, runtime: result.runtime, checks: result.checks, error: result.error, receipt }))
    if (once) process.exitCode = result.status === 'PASS' ? 0 : 1
  } catch { process.exitCode = 1; console.error('Could not write qualification receipt') }
  finally { if (once) setTimeout(() => { void server.stop(true) }, 100) }
}
const server = Bun.serve({ hostname: '127.0.0.1', port: Number(process.env.PORT || 0), async fetch(request) {
  const path = new URL(request.url).pathname
  if (path === '/run-config') return Response.json({ runID, restart, sessionRetention }, { headers })
  if (path === '/result' && request.method === 'POST') {
    const body = await request.json()
    if (finished) return new Response('Run already finished', { status: 409, headers })
    if (body.runID !== runID || !['PASS', 'FAIL'].includes(body.result?.status)) return new Response('Invalid result', { status: 400, headers })
    if (body.result.status === 'PASS' && (body.result.runtime !== runtimeManifest.version || body.result.assets !== assets.length ||
      body.result.exit?.exitCode !== 0 || body.result.exit?.forced !== false || body.result.exit?.signal !== null || body.result.checks?.length !== (sessionRetention ? 14 : restart ? 12 : 6) ||
      body.result.sessionRetention !== sessionRetention ||
      (sessionRetention && (typeof body.result.session?.id !== 'string' || !body.result.session.id.startsWith('ses_') ||
        body.result.session.title !== 'Browser OPFS retention probe' || body.result.session.created !== true ||
        body.result.session.idTitleChecked !== true || body.result.session.modelRequests !== 0 || body.result.session.toolRequests !== 0)) ||
      body.result.restart !== restart || body.result.scope !== (restart ? 'same-page full workspace/runtime reopen; no page reload' : 'single fresh-origin lifecycle') ||
      !Array.isArray(body.result.phases) || body.result.phases.length !== (restart ? 2 : 1) ||
      body.result.phases.some((phase: any, index: number) => phase.phase !== (index === 0 ? 'initial' : 'reopened') ||
        phase.exit?.exitCode !== 0 || phase.exit?.forced !== false || phase.exit?.signal !== null ||
        phase.checks?.length !== (index === 0 ? 5 : 6) + (sessionRetention ? 1 : 0) || phase.cleanup !== 'runtime.stop + workspace.flush + workspace.close completed') ||
      !Array.isArray(body.result.database) || body.result.database.length !== (restart ? 2 : 0) ||
      (restart && (body.result.database.some((db: any) => db.path !== '/.server/data/opencode.sqlite' || db.sqliteHeader !== true ||
        !Number.isInteger(db.bytes) || db.bytes < 100 || !/^[a-f0-9]{64}$/.test(db.sha256)) ||
        body.result.database[0].checkpoint !== 'after first runtime.stop and workspace.flush, before close' ||
        body.result.database[1].checkpoint !== 'after reopen, before second Runtime.start' ||
        body.result.database[0].bytes !== body.result.database[1].bytes || body.result.database[0].sha256 !== body.result.database[1].sha256)))) {
      return new Response('Incomplete acceptance checkpoints', { status: 400, headers })
    }
    await report(body.result)
    return Response.json({ received: true }, { headers })
  }
  if (path === '/') return new Response('<!doctype html><title>OpenCode Bun OPFS service qualification</title><pre>OpenCode Bun health + managed stop\n</pre><script type="module" src="/probe.js"></script>', { headers: { ...headers, 'content-type': 'text/html' } })
  if (path === '/probe.js') return new Response(code, { headers: { ...headers, 'content-type': 'text/javascript' } })
  if (path === '/package-manifest') return Response.json(manifest, { headers })
  if (path === '/runtime/distribution.json') return Response.json(runtimeManifest, { headers })
  if (path.startsWith('/package/')) {
    const bytes = files.get(decodeURIComponent(path.slice('/package/'.length)))
    if (bytes) return new Response(new Uint8Array(bytes), { headers })
  }
  if (path.startsWith('/runtime/')) {
    const target = resolve(runtimeDirectory, decodeURIComponent(path.slice('/runtime/'.length)))
    if (!target.startsWith(runtimeDirectory + sep)) return new Response('Invalid path', { status: 400, headers })
    const file = Bun.file(target)
    if (await file.exists()) return new Response(file, { headers })
  }
  return new Response('Not found', { status: 404, headers })
} })
console.log(`OpenCode Bun OPFS: ${server.url}?autorun=1&runID=${runID}${restart ? '&restart=1' : ''}${sessionRetention ? '&session-retention=1' : ''}`)
if (once) timer = setTimeout(() => { void report({ status: 'FAIL', error: `Browser qualification timed out after ${timeoutSeconds} seconds` }) }, timeoutSeconds * 1000)
