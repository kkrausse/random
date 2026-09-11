import { resolve, sep } from 'node:path'
import { readdir, readFile, stat } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { modelProxy } from './model-proxy'
import catalog from '../src/provider-upstreams.json'
import { directAssets } from './ripgrep-direct-assets.mjs'
import { globSeed, globSeedBytes } from '../probes/opencode-bun-fixtures'
import { validateCombined } from './opencode-bun-combined-validation'

const read = process.argv.includes('--read')
const edit = process.argv.includes('--edit')
const grep = process.argv.includes('--grep')
const glob = process.argv.includes('--glob')
const mode = process.argv.includes('--combined-tools') ? 'combined-tools' : 'single'
if (mode === 'combined-tools' && [read, edit, grep, glob, process.argv.includes('--restart'), process.argv.includes('--session-retention')].some(Boolean)) throw Error('--combined-tools requires its own single phase')
const search = grep || glob || mode === 'combined-tools'
if ([read, edit, grep, glob].filter(Boolean).length > 1) throw Error('--read, --edit, --grep and --glob are separate single-prompt modes')
const model = read || edit || search || process.argv.includes('--model')
const sessionRetention = process.argv.includes('--session-retention')
const once = process.argv.includes('--once'), restart = sessionRetention || process.argv.includes('--restart'), runID = crypto.randomUUID()
if (model && restart) throw Error('--model/--read/--edit/--grep/--glob require a single phase; omit --restart and --session-retention')
const proxy = modelProxy(new Map(model ? [['opencode', { baseURL: catalog.upstreams.opencode, headers: { authorization: 'Bearer public' } }]] : []))
let modelPosts = 0

const root = resolve(import.meta.dir, '..')
const output = resolve(root, '.runtime/opencode-bun-server')
const source = resolve(root, '.runtime/opencode-v2-source')
const runtimeDirectory = resolve(root, '../workspace-api/dist/runtime')
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
const ripgrepFiles = new Map<string, Uint8Array>()
const ripgrepAssets = search ? directAssets().filter(asset => asset.file.startsWith('ripgrep/')).map(asset => {
  ripgrepFiles.set(asset.file, asset.bytes)
  return { file: asset.file, destination: asset.path, bytes: asset.bytes.length, sha256: asset.sha256 }
}) : []
if (search && (ripgrepAssets.length !== 9 || JSON.parse(new TextDecoder().decode(ripgrepFiles.get('ripgrep/package.json'))).version !== '0.3.1')) throw Error('Expected nine ripgrep@0.3.1 package files')
const installer = search ? new Uint8Array(await readFile(resolve(root, 'probes/runtime/opencode-ripgrep-install.cjs'))) : undefined
const ripgrepManifest = search ? { package: 'ripgrep', version: '0.3.1', transforms: [], assets: ripgrepAssets,
  installer: { file: 'opencode-ripgrep-install.cjs', destination: '/direct/opencode-ripgrep-install.cjs', bytes: installer!.length, sha256: sha256(installer!) },
  manifestSha256: sha256(JSON.stringify(ripgrepAssets)) } : undefined
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
if (model) {
  const file = resolve(root, '.runtime/opencode-server-package/models.json'), bytes = await readFile(file)
  const hash = sha256(bytes)
  if (hash !== '93c9a67396a5a459c4cd6c4ea3514ef86652019ed2bc1a3589dbc624c4a42ea9') throw Error('Model catalog integrity mismatch')
  if (files.has('models.json')) throw Error('Model catalog collides with app output')
  files.set('models.json', bytes)
  assets.push({ file: 'models.json', destination: '/app/models.json', bytes: bytes.length, sha256: hash, modifiedAt: (await stat(file)).mtime.toISOString() })
}
for (const file of ['server.ts', 'build.ts', 'package.json', 'bun.lock']) {
  const path = resolve(root, 'experiments/opencode-bun-server', file)
  const bytes = await readFile(path).catch(error => { if (error.code === 'ENOENT') return null; throw error })
  inputs.push({ file: 'experiments/opencode-bun-server/' + file, sha256: bytes ? sha256(bytes) : null })
}
const runtimeManifest = await Bun.file(resolve(runtimeDirectory, 'distribution.json')).json()
const sourceStatus = git('status', '--short')
const manifest = {
  observedAt: new Date().toISOString(), assets, ...(search ? { ripgrep: ripgrepManifest } : {}),
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
const timeoutSeconds = mode === 'combined-tools' ? 300 : restart ? 360 : 180
const receipt = resolve(root, '.runtime', `opencode-bun-${runID}.json`)
let finished = false, timer: ReturnType<typeof setTimeout> | undefined
type Result = { status: string; runtime?: string; error?: string; checks?: string[] }
async function report(result: Result) {
  if (finished) return
  finished = true
  clearTimeout(timer)
  try {
    await Bun.write(receipt, JSON.stringify({ runID, restart, sessionRetention, model, ...(mode === 'combined-tools' ? { mode } : {}), ...(read ? { read } : {}), ...(edit ? { edit } : {}), ...(grep ? { grep } : {}), ...(glob ? { glob } : {}), modelPosts, manifest, result }, null, 2) + '\n')
    console.log(JSON.stringify({ status: result.status, runtime: result.runtime, checks: result.checks, error: result.error, receipt }))
    if (once) process.exitCode = result.status === 'PASS' ? 0 : 1
  } catch { process.exitCode = 1; console.error('Could not write qualification receipt') }
  finally { if (once) setTimeout(() => { void server.stop(true) }, 100) }
}
const server = Bun.serve({ hostname: '127.0.0.1', port: Number(process.env.PORT || 0), async fetch(request) {
  const path = new URL(request.url).pathname
  if (path.startsWith('/api/model/')) {
    if (finished) return new Response('Run finished', { status: 409 })
    if (model && path.startsWith('/api/model/opencode/') && request.method === 'POST') modelPosts++
    return proxy(request)
  }
  if (path === '/run-config') return Response.json({ runID, restart, sessionRetention, model, ...(mode === 'combined-tools' ? { mode } : {}), ...(read ? { read } : {}), ...(edit ? { edit } : {}), ...(grep ? { grep } : {}), ...(glob ? { glob } : {}) }, { headers })
  if (path === '/result' && request.method === 'POST') {
    if (finished) return new Response('Run already finished', { status: 409, headers })
    let body
    try { body = await request.json() } catch { return new Response('Invalid result', { status: 400, headers }) }
    if (!body || body.runID !== runID || !body.result || !['PASS', 'FAIL'].includes(body.result.status)) return new Response('Invalid result', { status: 400, headers })
    if (mode === 'combined-tools') {
      const accepted = validateCombined(body.result, { runtime: runtimeManifest.version, assets: assets.length, modelPosts,
        manifestSha256: ripgrepManifest!.manifestSha256, installerSha256: ripgrepManifest!.installer.sha256 })
      await report(accepted ? body.result : { status: 'FAIL', error: 'Host rejected combined result: incomplete acceptance checkpoints' })
      return Response.json({ received: true, status: accepted ? 'PASS' : 'FAIL' }, { headers })
    }
    if (body.result.status === 'PASS' && (body.result.runtime !== runtimeManifest.version || body.result.assets !== assets.length ||
      body.result.exit?.exitCode !== 0 || body.result.exit?.forced !== false || body.result.exit?.signal !== null || body.result.checks?.length !== (sessionRetention ? 14 : restart ? 12 : search ? 9 : model ? 8 : 6) ||
      body.result.model !== model ||
      (body.result.read ?? false) !== read ||
      (body.result.edit ?? false) !== edit ||
      (body.result.grep ?? false) !== grep ||
      (body.result.glob ?? false) !== glob ||
      (glob && (body.result.globEvidence?.calls !== 1 || body.result.globEvidence.successes !== 1 ||
        body.result.globEvidence.inputMatched !== true || body.result.globEvidence.pathMatched !== true || body.result.globEvidence.correlationMatched !== true ||
        body.result.globEvidence.contentMatched !== true || body.result.globEvidence.contentItems !== 1 || body.result.globEvidence.matchedFiles !== 1 ||
        body.result.globEvidence.fixtureFiles !== 2 || body.result.globEvidence.target !== '/workspace/glob-probe' || body.result.globEvidence.providerExecuted !== false ||
        body.result.globEvidence.seedBytes !== globSeedBytes || body.result.globEvidence.seedSha256 !== sha256(globSeed) ||
        body.result.globEvidence.contentSha256 !== sha256('/workspace/glob-probe/match.ts') ||
        body.result.globEvidence.packageFiles !== 9 || body.result.globEvidence.manifestSha256 !== ripgrepManifest?.manifestSha256 ||
        body.result.globEvidence.installerSha256 !== ripgrepManifest?.installer.sha256 || body.result.globEvidence.setupCheckpoint !== true ||
        body.result.globEvidence.setupStderrBytes !== 0 || body.result.globEvidence.setupExit?.exitCode !== 0 ||
        body.result.globEvidence.setupExit?.forced !== false || body.result.globEvidence.setupExit?.signal !== null ||
        body.result.globEvidence.managedStop !== 'accepted' || body.result.globEvidence.cleanupExitStatus !== 'natural exit verified' ||
        body.result.globEvidence.exit?.exitCode !== 0 || body.result.globEvidence.exit?.forced !== false || body.result.globEvidence.exit?.signal !== null ||
        !Number.isInteger(body.result.modelEvidence?.toolEvents) || body.result.modelEvidence.toolEvents < 3 ||
        !Number.isInteger(body.result.modelEvidence?.textBlocks) || body.result.modelEvidence.textBlocks < 1 || modelPosts < 2)) ||
      (grep && (body.result.grepEvidence?.calls !== 1 || body.result.grepEvidence.successes !== 1 ||
        body.result.grepEvidence.inputMatched !== true || body.result.grepEvidence.contentMatched !== true || body.result.grepEvidence.contentItems !== 1 ||
        body.result.grepEvidence.target !== '/workspace/grep-probe.txt' || body.result.grepEvidence.providerExecuted !== false ||
        body.result.grepEvidence.seedBytes !== 32 || body.result.grepEvidence.seedSha256 !== sha256('before\nVIVARI_GREP_NEEDLE\nafter\n') ||
        body.result.grepEvidence.contentSha256 !== sha256('Found 1 matches\n/workspace/grep-probe.txt:\n  Line 2: VIVARI_GREP_NEEDLE\n') ||
        body.result.grepEvidence.packageFiles !== 9 || body.result.grepEvidence.manifestSha256 !== ripgrepManifest?.manifestSha256 ||
        body.result.grepEvidence.installerSha256 !== ripgrepManifest?.installer.sha256 || body.result.grepEvidence.setupCheckpoint !== true ||
        body.result.grepEvidence.setupStderrBytes !== 0 || body.result.grepEvidence.setupExit?.exitCode !== 0 ||
        body.result.grepEvidence.setupExit?.forced !== false || body.result.grepEvidence.setupExit?.signal !== null ||
        body.result.grepEvidence.managedStop !== 'accepted' || body.result.grepEvidence.cleanupExitStatus !== 'natural exit verified' ||
        body.result.grepEvidence.exit?.exitCode !== 0 || body.result.grepEvidence.exit?.forced !== false || body.result.grepEvidence.exit?.signal !== null ||
        !Number.isInteger(body.result.modelEvidence?.toolEvents) || body.result.modelEvidence.toolEvents < 3 ||
        !Number.isInteger(body.result.modelEvidence?.textBlocks) || body.result.modelEvidence.textBlocks < 1 || modelPosts < 2)) ||
      (read && (body.result.readEvidence?.target !== '/workspace/read-probe.txt' || body.result.readEvidence.calls !== 1 ||
        body.result.readEvidence.successes !== 1 || body.result.readEvidence.targetMatched !== true || body.result.readEvidence.providerExecuted !== false || body.result.readEvidence.managedStop !== 'accepted' ||
        !Number.isInteger(body.result.modelEvidence?.toolEvents) || body.result.modelEvidence.toolEvents < 3 || modelPosts < 2)) ||
      (edit && (body.result.editEvidence?.target !== '/workspace/edit-probe.txt' || body.result.editEvidence.calls !== 1 ||
        body.result.editEvidence.successes !== 1 || body.result.editEvidence.targetMatched !== true || body.result.editEvidence.inputMatched !== true ||
        body.result.editEvidence.providerExecuted !== false || body.result.editEvidence.bytesMatched !== true ||
        body.result.editEvidence.beforeBytes !== 19 || body.result.editEvidence.beforeSha256 !== sha256('VIVARI_EDIT_BEFORE\n') ||
        body.result.editEvidence.afterBytes !== 18 || body.result.editEvidence.afterSha256 !== sha256('VIVARI_EDIT_AFTER\n') ||
        !Number.isInteger(body.result.editEvidence.readCalls) || body.result.editEvidence.readCalls < 0 || body.result.editEvidence.readCalls > 2 ||
        body.result.editEvidence.readSuccesses !== body.result.editEvidence.readCalls || body.result.editEvidence.managedStop !== 'accepted' ||
        body.result.editEvidence.cleanupExitStatus !== 'natural exit verified' || body.result.editEvidence.exit?.exitCode !== 0 ||
        body.result.editEvidence.exit?.forced !== false || body.result.editEvidence.exit?.signal !== null ||
        !Number.isInteger(body.result.modelEvidence?.toolEvents) || body.result.modelEvidence.toolEvents < 3 * (1 + body.result.editEvidence.readCalls) ||
        !Number.isInteger(body.result.modelEvidence?.textBlocks) || body.result.modelEvidence.textBlocks < 1 || body.result.modelEvidence.textLength < 1 || modelPosts < 2)) ||
      (model && (body.result.modelEvidence?.providerID !== 'opencode' || body.result.modelEvidence?.id !== 'muse-spark-1.3-contributor-free' ||
        !Number.isInteger(body.result.modelEvidence?.deltas) || body.result.modelEvidence.deltas < 1 || (!read && !edit && !search && body.result.modelEvidence.toolEvents !== 0) ||
        body.result.modelEvidence.promptRequests !== 1 || (!edit && !search && body.result.modelEvidence.textMatched !== true) ||
        body.result.modelEvidence.terminal !== 'session.execution.succeeded' || body.result.modelEvidence.sseCleanup !== 'aborted and joined' ||
        body.result.modelEvidence.cleanup !== 'runtime.stop + workspace.flush + workspace.close completed')) ||
      body.result.sessionRetention !== sessionRetention ||
      (sessionRetention && (typeof body.result.session?.id !== 'string' || !body.result.session.id.startsWith('ses_') ||
        body.result.session.title !== 'Browser OPFS retention probe' || body.result.session.created !== true ||
        body.result.session.idTitleChecked !== true || body.result.session.modelRequests !== 0 || body.result.session.toolRequests !== 0)) ||
      body.result.restart !== restart || body.result.scope !== (restart ? 'same-page full workspace/runtime reopen; no page reload' : 'single fresh-origin lifecycle') ||
      !Array.isArray(body.result.phases) || body.result.phases.length !== (restart ? 2 : 1) ||
      body.result.phases.some((phase: any, index: number) => !phase || phase.phase !== (index === 0 ? 'initial' : 'reopened') ||
        phase.exit?.exitCode !== 0 || phase.exit?.forced !== false || phase.exit?.signal !== null ||
        phase.checks?.length !== (index === 0 ? 5 : 6) + (sessionRetention ? 1 : 0) + (model ? 2 : 0) + (search ? 1 : 0) || phase.cleanup !== 'runtime.stop + workspace.flush + workspace.close completed') ||
      !Array.isArray(body.result.database) || body.result.database.length !== (restart ? 2 : 0) ||
      (restart && (body.result.database.some((db: any) => !db || db.path !== '/.server/data/opencode.sqlite' || db.sqliteHeader !== true ||
        !Number.isInteger(db.bytes) || db.bytes < 100 || !/^[a-f0-9]{64}$/.test(db.sha256)) ||
        body.result.database[0].checkpoint !== 'after first runtime.stop and workspace.flush, before close' ||
        body.result.database[1].checkpoint !== 'after reopen, before second Runtime.start' ||
        body.result.database[0].bytes !== body.result.database[1].bytes || body.result.database[0].sha256 !== body.result.database[1].sha256)))) {
      // Retain no rejected payload: even evidence/check strings may contain secrets.
      await report({ status: 'FAIL', error: 'Host rejected browser PASS: incomplete acceptance checkpoints' })
      return Response.json({ received: true, status: 'FAIL' }, { headers })
    }
    await report(body.result)
    return Response.json({ received: true }, { headers })
  }
  if (path === '/') return new Response('<!doctype html><title>OpenCode Bun OPFS service qualification</title><pre>OpenCode Bun health + managed stop\n</pre><script type="module" src="/probe.js"></script>', { headers: { ...headers, 'content-type': 'text/html' } })
  if (path === '/probe.js') return new Response(code, { headers: { ...headers, 'content-type': 'text/javascript' } })
  if (path === '/package-manifest') return Response.json(manifest, { headers })
  if (search && path === '/ripgrep-manifest') return Response.json(ripgrepManifest, { headers })
  if (search && path === '/ripgrep-installer') return new Response(installer!, { headers })
  if (search && path.startsWith('/ripgrep-package/')) {
    const bytes = ripgrepFiles.get(decodeURIComponent(path.slice('/ripgrep-package/'.length)))
    if (bytes) return new Response(new Uint8Array(bytes), { headers })
  }
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
console.log(`OpenCode Bun OPFS: ${server.url}?autorun=1&runID=${runID}${restart ? '&restart=1' : ''}${sessionRetention ? '&session-retention=1' : ''}${model ? '&model=1' : ''}${read ? '&read=1' : ''}${edit ? '&edit=1' : ''}${grep ? '&grep=1' : ''}${glob ? '&glob=1' : ''}${mode === 'combined-tools' ? '&combined-tools=1' : ''}`)
if (once) timer = setTimeout(() => { void report({ status: 'FAIL', error: `Browser qualification timed out after ${timeoutSeconds} seconds` }) }, timeoutSeconds * 1000)
