import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { combinedFixture, combinedSteps, globSeed, globSeedBytes } from '../probes/opencode-bun-fixtures'
import { validateCombined } from './opencode-bun-combined-validation'
import { validateCombinedRetention } from './opencode-bun-retention-validation'
import { combinedBytes, combinedEvidence, combinedValidator } from '../probes/opencode-bun-combined'

// Exercise the actual host route and report function in isolation. No host startup,
// model traffic, browser, generated assets, or qualification receipts are involved.
const source = await Bun.file(new URL('./serve-opencode-bun-server.ts', import.meta.url)).text()
const report = source.slice(source.indexOf('async function report('), source.indexOf('const server = Bun.serve('))
const route = source.slice(source.indexOf("  if (path === '/result'"), source.indexOf("  if (path === '/')"))
const code = new Bun.Transpiler({ loader: 'ts' }).transformSync(`
function harness(context: any) {
  const { Bun, process, console, setTimeout, clearTimeout, server, sha256, globSeed, globSeedBytes, mode, validateCombined, validateCombinedRetention, combinedRetention } = context
  const controlled = undefined, interrupt = false
  const runID = 'synthetic-only', restart = combinedRetention, sessionRetention = false, firstPosts = 2, finalPosts = 2,
    model = true, read = false, edit = false, grep = false, glob = mode === 'single', search = true,
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
function host(mode = 'single', combinedRetention = false) {
  const receipts: any[] = [], stops: boolean[] = [], scheduled: (() => void)[] = []
  const process = { exitCode: undefined as number | undefined }
  let cleared = false
  const handle = factory({
    Bun: { write: async (_path: string, data: string) => { receipts.push(JSON.parse(data)) } },
    process, console: { log() {}, error() {} }, sha256, globSeed, globSeedBytes, mode, validateCombined, validateCombinedRetention, combinedRetention,
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

function validCombined(): any {
  const result: any = validResult()
  delete result.glob
  result.mode = 'combined-tools'
  result.deliveryEvidence = result.globEvidence
  delete result.globEvidence
  result.modelEvidence.toolEvents = 12
  // Prose is diagnostic only, even when absent.
  result.modelEvidence.deltas = 0
  result.modelEvidence.textBlocks = 0
  const sessionID = 'ses_combined'
  result.combinedEvidence = { sessionID, bytesMatched: true,
    beforeBytes: new TextEncoder().encode(combinedFixture.before).length, beforeSha256: sha256(combinedFixture.before),
    afterBytes: new TextEncoder().encode(combinedFixture.after).length, afterSha256: sha256(combinedFixture.after),
    events: combinedSteps.flatMap((step, index) => {
      const data = { sessionID, id: 'tool_' + index, assistantMessageID: 'msg_' + index }
      return [
        { type: 'session.tool.input.started', data: { ...data, name: step.name } },
        { type: 'session.tool.called', data: { ...data, input: { ...step.input }, executed: false } },
        { type: 'session.tool.success', data: { ...data, executed: false, content: [{ type: 'text', text: 'content' in step ? step.content : 'edit successful' }] } },
      ]
    }),
  }
  return result
}

test('combined route accepts four ordered local successes and exact bytes without prose', async () => {
  const h = host('combined-tools'), result = validCombined()
  expect(await (await h.send({ runID: 'synthetic-only', result })).json()).toEqual({ received: true, status: 'PASS' })
  expect(h.receipts[0].result).toEqual(result)
  expect(h.receipts[0].modelPosts).toBe(2)
  expect(h.process.exitCode).toBe(0)
})

test('retention route rejects incomplete evidence with sanitized receipt and --once exit', async () => {
  const h = host('combined-tools', true)
  const response = await h.send({ runID: 'synthetic-only', result: { ...validCombined(), retention: { secret: 'SECRET_HISTORY' } } })
  expect(await response.json()).toEqual({ received: true, status: 'FAIL' })
  expect(h.receipts[0].result).toEqual({ status: 'FAIL', error: 'Host rejected combined result: incomplete acceptance checkpoints' })
  expect(JSON.stringify(h.receipts)).not.toContain('SECRET_HISTORY')
  expect(h.process.exitCode).toBe(1)
  h.scheduled[0]()
  expect(h.stops).toEqual([true])
})

const combinedMutations: Record<string, (r: any) => void> = {
  session: r => { r.combinedEvidence.events[2].data.sessionID = 'ses_other' },
  tool: r => { r.combinedEvidence.events[2].data.id = 'tool_other' },
  assistant: r => { r.combinedEvidence.events[2].data.assistantMessageID = 'msg_other' },
  order: r => { [r.combinedEvidence.events[2], r.combinedEvidence.events[3]] = [r.combinedEvidence.events[3], r.combinedEvidence.events[2]] },
  editBeforeGrep: r => { [r.combinedEvidence.events[5], r.combinedEvidence.events[6]] = [r.combinedEvidence.events[6], r.combinedEvidence.events[5]] },
  input: r => { r.combinedEvidence.events[7].data.input.limit = 11 },
  extraInput: r => { r.combinedEvidence.events[1].data.input.limit = 10 },
  readAfter: r => { r.combinedEvidence.events[2].data.content[0].text = 'BASELINE_AFTER' },
  grepBefore: r => { r.combinedEvidence.events[8].data.content[0].text = 'BASELINE_BEFORE' },
  globPath: r => { r.combinedEvidence.events[11].data.content[0].text += '\n' },
  provider: r => { r.combinedEvidence.events[5].data.executed = true },
  extraTool: r => { r.combinedEvidence.events.push(r.combinedEvidence.events[0]) },
  length: r => { r.combinedEvidence.afterBytes-- },
  hash: r => { r.combinedEvidence.afterSha256 = sha256('BASELINE_AFTER') },
  prompt: r => { r.modelEvidence.promptRequests = 2 },
  terminal: r => { r.modelEvidence.terminal = 'pending' },
  cleanup: r => { r.deliveryEvidence.exit = { exitCode: 0, forced: true, signal: null } },
  browserFailure: r => { r.status = 'FAIL' },
}
for (const [name, mutate] of Object.entries(combinedMutations)) {
  test(`combined ${name} rejection is sanitized and finishes --once`, async () => {
    const h = host('combined-tools'), result = validCombined()
    mutate(result)
    result.rawLogs = 'SECRET_PAYLOAD'
    result.checks[0] = 'SECRET_PAYLOAD'
    expect(await (await h.send({ runID: 'synthetic-only', result })).json()).toEqual({ received: true, status: 'FAIL' })
    expect(h.receipts[0].result).toEqual({ status: 'FAIL', error: 'Host rejected combined result: incomplete acceptance checkpoints' })
    expect(JSON.stringify(h.receipts)).not.toContain('SECRET_PAYLOAD')
    expect(h.process.exitCode).toBe(1)
    expect(h.cleared()).toBe(true)
    h.scheduled[0]()
    expect(h.stops).toEqual([true])
    expect((await h.send({ runID: 'synthetic-only', result })).status).toBe(409)
  })
}

test('combined public-fs byte check rejects a missing trailing newline', async () => {
  const evidence = combinedEvidence()
  const hash = async (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
  await combinedBytes(evidence, 'before', new TextEncoder().encode(combinedFixture.before), hash)
  await expect(combinedBytes(evidence, 'after', new TextEncoder().encode('BASELINE_AFTER'), hash)).rejects.toThrow('Combined file bytes rejected')
  expect(evidence.bytesMatched).toBe(false)
})

test('combined validator rejects a late fifth tool permanently', () => {
  const result = validCombined(), validator = combinedValidator(result.combinedEvidence.sessionID)
  for (const event of result.combinedEvidence.events) validator.accept(event)
  expect(validator.complete()).toBe(true)
  expect(() => validator.accept(result.combinedEvidence.events[0])).toThrow()
  expect(validator.complete()).toBe(false)
})

test('combined host requires observed proxy POSTs without imposing a fixed cap', () => {
  const expected = { runtime: 'synthetic-runtime', assets: 1, modelPosts: 1000, manifestSha256: 'manifest-hash', installerSha256: 'installer-hash' }
  expect(validateCombined(validCombined(), expected)).toBe(true)
  expect(validateCombined(validCombined(), { ...expected, modelPosts: 0 })).toBe(false)
})
