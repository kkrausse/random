import { resolve } from 'node:path'
import { readFileSync, readdirSync, mkdirSync, openSync, writeSync, fsyncSync, closeSync, renameSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { runtimeSourcePath } from './runtime-source.mjs'
import { preservePreviewQuery } from '../../workspace-api/scripts/preview-query'
import { validateDirectBrowser } from './opencode-direct-browser-validation'

const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
const integration = resolve(import.meta.dir, '..')
const retained = resolve(process.argv[2] || '')
if (!process.argv[2]) throw Error('Expected retained build root argument')
const runID = crypto.randomUUID()
const retention = process.argv.includes('--retention')
const runRoot = resolve(integration, '.runtime/browser-direct', runID)
mkdirSync(runRoot, { recursive: true })
const source = resolve(retained, '.runtime/opencode-v2-source'), artifact = resolve(retained, '.runtime/opencode-bun-server')
const git = (path: string, ...args: string[]) => execFileSync('git', ['-C', path, ...args], { encoding: 'utf8' }).trim()
const equal = (actual: unknown, expected: unknown, label: string) => { if (actual !== expected) throw Error(label + ' mismatch') }
const buildBytes = readFileSync(resolve(retained, 'build-receipt.json'))
equal(hash(buildBytes), 'd6dcd8f0458d7bb3238229eebb0d01766eb4bd8861abc8e74646fe65fe8d7949', 'Build receipt')
const build = JSON.parse(buildBytes.toString())
equal(git(source, 'rev-parse', 'HEAD'), '20aff6d9f643afe9abf8a048e68f019d049f5329', 'Source revision')
equal(git(source, 'rev-parse', 'HEAD^{tree}'), 'e4148bd22397254c48e64e11d60a158d7be9586f', 'Source tree')
equal(git(source, 'status', '--short'), '', 'Source clean')
equal(hash(readFileSync(resolve(source, 'bun.lock'))), '07711d25b2378d9a3491f6eb960b8386c7bd1831a15d401c04a3c77070cd2e75', 'Lock')
const revision = '80d5cdd599fce4fa4817128461c865e009109d34'
equal(git(runtimeSourcePath(), 'rev-parse', 'HEAD'), revision, 'Runtime source')
equal(git(runtimeSourcePath(), 'status', '--short'), '', 'Runtime clean')
equal(readdirSync(artifact).sort().join(), Object.keys(build.outputs).sort().join(), 'Artifact set')
const appFiles = new Map<string, Uint8Array>()
const assets = Object.entries(build.outputs).map(([file, value]) => {
  const expected = value as { bytes: number; sha256: string }, bytes = readFileSync(resolve(artifact, file))
  equal(bytes.length, expected.bytes, file + ' length'); equal(hash(bytes), expected.sha256, file + ' hash')
  appFiles.set(file, bytes)
  return { file, ...expected }
})
equal(assets.length, 5, 'Five app assets')
equal(hash(appFiles.get('server.js')!), '55be88221d3d21dc373fb7ad7f80fdda3974a4a0be6453001e8e3df0957fc4fb', 'Exact app JS')
for (const [file, expected] of Object.entries(build.recipe)) equal(hash(readFileSync(resolve(retained, 'experiments/opencode-bun-server', file))), expected, 'Recipe ' + file)
const runtimeRoot = resolve(integration, '../workspace-api/dist/runtime')
const distributionBytes = readFileSync(resolve(runtimeRoot, 'distribution.json'))
const distribution = JSON.parse(distributionBytes.toString())
equal(distribution.runtimeBuild.revision, revision, 'Distribution revision')
equal(distribution.runtimeBuild.source.dirty, false, 'Distribution clean build')
const runtimeReceiptBytes = readFileSync(resolve(integration, '.runtime/patched-build.json'))
equal(hash(runtimeReceiptBytes), distribution.runtimeBuildSha256, 'Runtime build receipt')
equal(JSON.stringify(JSON.parse(runtimeReceiptBytes.toString())), JSON.stringify(distribution.runtimeBuild), 'Embedded runtime receipt')
const sw = readFileSync(resolve(runtimeRoot, distribution.serviceWorker))
equal(sw.toString(), preservePreviewQuery(readFileSync(runtimeSourcePath('packages/core/dist/assets/sw.js'), 'utf8')), 'Delivered service worker')
equal(createHash('sha256').update(runtimeReceiptBytes).update(sw).digest('hex'), distribution.version, 'Distribution version')
const runtimeAssets = new Map<string, string>(distribution.runtimeBuild.assets.filter((a: any) => a.name.startsWith('assets/')).map((a: any) => [a.name, a.sha256]))
runtimeAssets.set(distribution.serviceWorker, hash(sw))
for (const item of distribution.runtimeBuild.assets.filter((a: any) => a.name.startsWith('assets/') && !a.retained && a.name !== distribution.serviceWorker))
  equal(hash(readFileSync(resolve(runtimeRoot, item.name))), item.sha256, 'Runtime asset ' + item.name)
equal(hash(readFileSync(resolve(runtimeRoot, distribution.kernelWorker))), distribution.kernelSha256, 'Active kernel')
const manifest = { runID, retention, assets, runtime: { version: distribution.version, revision,
  manifestSha256: hash(distributionBytes), runtimeBuildSha256: distribution.runtimeBuildSha256,
  kernelWorker: distribution.kernelWorker, kernelSha256: distribution.kernelSha256, serviceWorkerSha256: hash(sw) },
  provenance: { artifact, source, buildReceiptSha256: hash(buildBytes), build, runtimeBuild: distribution.runtimeBuild } }
const built = await Bun.build({ entrypoints: [resolve(integration, 'probes/opencode-direct-browser.ts')], target: 'browser', format: 'esm' })
if (!built.success) throw new AggregateError(built.logs)
const browserCode = new Uint8Array(await built.outputs[0].arrayBuffer())
const headers = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Service-Worker-Allowed': '/', 'Cache-Control': 'no-store' }
const files: Record<string, { fd: number; bytes: number; path: string }> = {}
for (const channel of ['stdout', 'stderr', 'stages']) {
  const path = resolve(runRoot, channel === 'stages' ? 'stages.jsonl' : channel + '.bin')
  files[channel] = { path, fd: openSync(path, 'wx', 0o600), bytes: 0 }
}
const append = (channel: string, bytes: Uint8Array) => {
  const file = files[channel]
  for (let offset = 0; offset < bytes.length;) {
    const count = writeSync(file.fd, bytes, offset, bytes.length - offset)
    if (!count) throw Error('Sink made no progress')
    offset += count; file.bytes += count
  }
  fsyncSync(file.fd)
}
const stages: unknown[] = [], requests: { path: string; sha256: string; bytes: number }[] = []
let finished = false, timer: ReturnType<typeof setTimeout>
let sinkError: string | undefined
const report = (browser: any, reason?: string) => {
  if (finished) return
  finished = true; clearTimeout(timer)
  const sinkErrors: string[] = sinkError ? [sinkError] : []
  for (const file of Object.values(files)) {
    try { fsyncSync(file.fd) } catch (error) { sinkErrors.push(String(error)) }
    try { closeSync(file.fd) } catch (error) { sinkErrors.push(String(error)) }
  }
  const channels = Object.fromEntries(['stdout', 'stderr'].map(channel => [channel, { bytes: files[channel].bytes, sha256: hash(readFileSync(files[channel].path)), path: files[channel].path }]))
   const accepted = !reason && !sinkErrors.length && validateDirectBrowser(browser, { runtime: distribution.version, assets, channels, retention })
  const receipt = { runID, result: accepted ? 'PASS' : 'FAIL', reason: reason ?? (accepted ? null : 'Browser acceptance incomplete or rejected'),
    manifest, browser: browser ?? null, stages, channels, sinkErrors, runtimeRequests: requests,
    harness: { browserSha256: hash(browserCode), host: 'serve-opencode-direct-browser.ts' },
    cleanup: browser?.cleanup ?? { status: 'unreported; browser completion unavailable' }, finishedAt: new Date().toISOString() }
  const path = resolve(runRoot, 'receipt.json')
  try {
    const fd = openSync(path + '.tmp', 'wx', 0o600)
    try {
      const bytes = Buffer.from(JSON.stringify(receipt, null, 2) + '\n')
      for (let offset = 0; offset < bytes.length;) {
        const count = writeSync(fd, bytes, offset, bytes.length - offset)
        if (!count) throw Error('Receipt sink made no progress')
        offset += count
      }
      fsyncSync(fd)
    } finally { closeSync(fd) }
    renameSync(path + '.tmp', path)
    console.log(JSON.stringify({ result: receipt.result, reason: receipt.reason, runID, path, sha256: hash(readFileSync(path)), channels, cleanup: receipt.cleanup }))
  } catch (error) { console.error('FINAL RECEIPT WRITE FAILED', String(error)); process.exitCode = 1 }
  if (!process.exitCode) process.exitCode = accepted ? 0 : 1
  setTimeout(() => { void server.stop(true) }, 250)
  return receipt.result
}
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
  const url = new URL(request.url), path = url.pathname
  try {
    if (path === '/') return new Response('<!doctype html><title>Direct server OPFS qualification</title><pre>Starting one isolated qualification\n</pre><script type="module" src="/probe.js"></script>', { headers: { ...headers, 'content-type': 'text/html' } })
    if (path === '/probe.js') return new Response(browserCode, { headers: { ...headers, 'content-type': 'text/javascript' } })
    if (path === '/manifest') return Response.json(manifest, { headers })
    if (path === '/runtime/distribution.json') return new Response(distributionBytes, { headers: { ...headers, 'content-type': 'application/json' } })
    if (path.startsWith('/runtime/')) {
      const name = decodeURIComponent(path.slice('/runtime/'.length)), expected = runtimeAssets.get(name)
      if (!expected) return new Response('Unknown runtime asset', { status: 404, headers })
      const bytes = readFileSync(resolve(runtimeRoot, name))
      equal(hash(bytes), expected, 'Requested runtime asset ' + name)
      requests.push({ path: name, sha256: expected, bytes: bytes.length })
      return new Response(bytes, { headers: { ...headers, 'content-type': name.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' } })
    }
    if (path.startsWith('/app/')) {
      const bytes = appFiles.get(decodeURIComponent(path.slice(5)))
      return bytes ? new Response(bytes, { headers }) : new Response('Unknown app asset', { status: 404, headers })
    }
    if (finished) return new Response('Already finished', { status: 409, headers })
    if (path.startsWith('/output/') && request.method === 'POST') {
      const channel = path.slice(8)
      if (!['stdout', 'stderr'].includes(channel) || url.searchParams.get('runID') !== runID || Number(url.searchParams.get('offset')) !== files[channel].bytes)
        return new Response('Output identity/offset mismatch', { status: 400, headers })
      const bytes = new Uint8Array(await request.arrayBuffer())
      if (bytes.length > 1048576) return new Response('Output chunk too large', { status: 413, headers })
      append(channel, bytes)
      return Response.json({ persistedBytes: files[channel].bytes }, { headers })
    }
    if (path === '/stage' && request.method === 'POST') {
      const body = await request.json()
      if (body.runID !== runID || typeof body.event?.name !== 'string') return new Response('Invalid stage', { status: 400, headers })
      stages.push(body.event); append('stages', new TextEncoder().encode(JSON.stringify(body.event) + '\n'))
      return Response.json({ received: true }, { headers })
    }
    if (path === '/result' && request.method === 'POST') {
      const body = await request.json()
      if (body.runID !== runID || body.result?.runID !== runID) return new Response('Invalid result', { status: 400, headers })
      return Response.json({ status: report(body.result) }, { headers })
    }
    return new Response('Not found', { status: 404, headers })
  } catch (error) {
    sinkError = String(error)
    report(null, String(error))
    return new Response('Qualification host failure', { status: 500, headers })
  }
} })
timer = setTimeout(() => report(null, 'Host deadline; last durable stage retained, browser cleanup unreported'), retention ? 240000 : 180000)
process.once('SIGTERM', () => report(null, 'Host terminated; browser cleanup unreported'))
console.log(JSON.stringify({ url: server.url.href, runID, runRoot, runtime: manifest.runtime, assets, browserHarnessSha256: hash(browserCode) }))
