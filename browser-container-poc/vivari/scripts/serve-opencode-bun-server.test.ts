import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { globSeed, globSeedBytes } from '../probes/opencode-bun-fixtures'

// Exercise the actual host route and report function in isolation. No host startup,
// model traffic, browser, generated assets, or qualification receipts are involved.
const source = await Bun.file(new URL('./serve-opencode-bun-server.ts', import.meta.url)).text()
const report = source.slice(source.indexOf('async function report('), source.indexOf('const server = Bun.serve('))
const route = source.slice(source.indexOf("  if (path === '/result'"), source.indexOf("  if (path === '/')"))
const code = new Bun.Transpiler({ loader: 'ts' }).transformSync(`
function harness(context: any) {
  const { Bun, process, console, setTimeout, clearTimeout, server, sha256, globSeed, globSeedBytes } = context
  const runID = 'synthetic-only', restart = false, sessionRetention = false,
    model = true, read = false, edit = false, grep = false, glob = true, search = true,
    once = true, receipt = 'in-memory-only', modelPosts = 2, manifest = {},
    runtimeManifest = { version: 'synthetic-runtime' }, assets = [{}],
    ripgrepManifest = { manifestSha256: 'manifest-hash', installer: { sha256: 'installer-hash' } }, headers = {}
  let finished = false, timer
  ${report}
  return async (request: Request) => {
    const path = '/result'
    ${route}
  }
}`)
const factory = new Function(code + '; return harness')()
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')
const exit = { exitCode: 0, forced: false, signal: null }
const cleanup = 'runtime.stop + workspace.flush + workspace.close completed'
function validResult() {
  return {
    status: 'PASS', runtime: 'synthetic-runtime', assets: 1, exit, checks: Array(9).fill('synthetic checkpoint'),
    model: true, glob: true, restart: false, sessionRetention: false,
    scope: 'single fresh-origin lifecycle', database: [],
    phases: [{ phase: 'initial', exit, checks: Array(8).fill('synthetic checkpoint'), cleanup }],
    globEvidence: {
      calls: 1, successes: 1, inputMatched: true, pathMatched: true, correlationMatched: true,
      contentMatched: true, contentItems: 1, matchedFiles: 1, fixtureFiles: 2,
      target: '/workspace/glob-probe', providerExecuted: false,
      seedBytes: 39, seedSha256: sha256('VIVARI_GLOB_MATCH\nVIVARI_GLOB_NONMATCH\n'),
      contentSha256: sha256('/workspace/glob-probe/match.ts'), packageFiles: 9,
      manifestSha256: 'manifest-hash', installerSha256: 'installer-hash', setupCheckpoint: true,
      setupStderrBytes: 0, setupExit: exit, managedStop: 'accepted', cleanupExitStatus: 'natural exit verified', exit,
    },
    modelEvidence: {
      providerID: 'opencode', id: 'muse-spark-1.3-contributor-free', toolEvents: 3, textBlocks: 1,
      deltas: 1, promptRequests: 1, terminal: 'session.execution.succeeded',
      sseCleanup: 'aborted and joined', cleanup,
    },
  }
}
function host() {
  const receipts: any[] = [], stops: boolean[] = [], scheduled: (() => void)[] = []
  const process = { exitCode: undefined as number | undefined }
  let cleared = false
  const handle = factory({
    Bun: { write: async (_path: string, data: string) => { receipts.push(JSON.parse(data)) } },
    process, console: { log() {}, error() {} }, sha256, globSeed, globSeedBytes,
    setTimeout: (callback: () => void) => { scheduled.push(callback) },
    clearTimeout: () => { cleared = true }, server: { stop: (force: boolean) => { stops.push(force) } },
  }) as (request: Request) => Promise<Response>
  return { receipts, process, stops, scheduled, cleared: () => cleared,
    send: (body: unknown, raw = false) => handle(new Request('http://synthetic.invalid/result', {
      method: 'POST', body: raw ? String(body) : JSON.stringify(body),
    })),
  }
}

test('39-byte glob fixture and matching hash pass all host acceptance checks', async () => {
  expect(globSeedBytes).toBe(39)
  const h = host(), result = validResult()
  expect((await h.send({ runID: 'synthetic-only', result })).status).toBe(200)
  expect(h.receipts[0].result).toEqual(result)
  expect(h.process.exitCode).toBe(0)
})

for (const mismatch of ['length', 'hash', 'cleanup'] as const) {
  test(`${mismatch} mismatch writes sanitized FAIL and completes --once with exit 1`, async () => {
    const h = host(), result = { ...validResult(), rawLogs: 'SECRET_PAYLOAD' }
    if (mismatch === 'length') result.globEvidence.seedBytes = 37
    if (mismatch === 'hash') result.globEvidence.seedSha256 = 'SECRET_PAYLOAD'
    if (mismatch === 'cleanup') result.modelEvidence.cleanup = 'SECRET_PAYLOAD'
    result.checks[0] = 'SECRET_PAYLOAD'
    const response = await h.send({ runID: 'synthetic-only', result })
    expect(await response.json()).toEqual({ received: true, status: 'FAIL' })
    expect(h.receipts).toHaveLength(1)
    expect(h.receipts[0].result).toEqual({ status: 'FAIL', error: 'Host rejected browser PASS: incomplete acceptance checkpoints' })
    expect(JSON.stringify(h.receipts)).not.toContain('SECRET_PAYLOAD')
    expect(h.process.exitCode).toBe(1)
    expect(h.cleared()).toBe(true)
    expect(h.scheduled).toHaveLength(1)
    h.scheduled[0]()
    expect(h.stops).toEqual([true])
    expect((await h.send({ runID: 'synthetic-only', result })).status).toBe(409)
    expect(h.receipts).toHaveLength(1)
  })
}

test('malformed and unrelated requests are rejected without completing the run', async () => {
  const h = host()
  for (const body of [null, {}, { runID: 'other-run', result: validResult() }, { runID: 'synthetic-only', result: { status: 'unknown' } }]) {
    expect((await h.send(body)).status).toBe(400)
  }
  expect((await h.send('{broken json', true)).status).toBe(400)
  expect(h.receipts).toEqual([])
  expect(h.process.exitCode).toBeUndefined()
  expect(h.scheduled).toEqual([])
})
