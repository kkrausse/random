import { test, expect } from 'bun:test'
import { validateDirectBrowser } from './opencode-direct-browser-validation'

const expected = { runtime: 'runtime-pin', assets: [{ file: 'server.js', bytes: 10, sha256: 'app-hash' }],
  channels: { stdout: { bytes: 10, sha256: 'stdout-hash' }, stderr: { bytes: 0, sha256: 'stderr-hash' } } }
function complete() {
  const names = ['runtime.provenance-verified', 'opfs.fresh-durable', 'assets.verified', 'process.launched', 'listener', 'application.ready',
    'authentication.missing-rejected', 'health.authenticated', 'stdin.eof-posted', 'application.scope-closed', 'process.natural-exit',
    'cleanup.runtimeStop', 'cleanup.workspaceFlush', 'cleanup.workspaceClose', 'cleanup.drains']
  return { status: 'PASS', primaryFailure: null, secondaryFailures: [], runtime: expected.runtime, assets: expected.assets,
    exit: { exitCode: 0, signal: null, forced: false },
    cleanup: { executionStop: 'not needed', runtimeStop: 'completed', workspaceFlush: 'completed', workspaceClose: 'completed', drains: 'completed' },
    channels: Object.fromEntries(Object.entries(expected.channels).map(([key, value]) => [key, { receivedBytes: value.bytes, acknowledgedBytes: value.bytes,
      sha256: value.sha256, errors: [], ended: true }])),
    stages: names.map(name => ({ name, detail: name === 'listener' ? { port: 4096 } : name === 'authentication.missing-rejected' ? { status: 401 }
      : name === 'health.authenticated' ? { status: 200, healthy: true, version: '0.0.0-beta-19425', pid: 1 } : {} })),
  }
}
test('accepts complete ordered direct-server evidence', () => expect(validateDirectBrowser(complete(), expected)).toBe(true))
test('retention requires a second natural lifecycle and identical persisted session data', () => {
  const result: any = complete()
  const retained = { sessionID: 'ses_retained', title: 'retention', fileSha256: 'a'.repeat(64), entries: [{ key: 'retention', value: { runID: 'run' } }] }
  result.retention = { ...retained, exits: [result.exit, result.exit], oldEndpoint: 'CLOSED' }
  result.stages.splice(8, 0, { name: 'retention.created', detail: retained })
  const second: { name: string; detail: unknown }[] = complete().stages.slice(3, 11)
  second.splice(5, 0, { name: 'retention.verified', detail: retained })
  result.stages.splice(12, 0, ...['retention.first-runtime-stopped', 'retention.first-workspace-flushed',
    'retention.first-workspace-closed', 'retention.old-endpoint-closed', 'retention.workspace-reopened'].map(name => ({ name, detail: {} })), ...second)
  const target = { ...expected, retention: true }
  expect(validateDirectBrowser(result, target)).toBe(true)
  expect(validateDirectBrowser(complete(), target)).toBe(false)
  const mismatch = structuredClone(result)
  mismatch.stages.find((s: any) => s.name === 'retention.verified').detail = { ...retained, sessionID: 'other' }
  expect(validateDirectBrowser(mismatch, target)).toBe(false)
  const incomplete = structuredClone(result)
  incomplete.stages = incomplete.stages.filter((s: any) => s.name !== 'retention.first-workspace-closed')
  expect(validateDirectBrowser(incomplete, target)).toBe(false)
  const forced = structuredClone(result); forced.retention.exits[0].forced = true
  expect(validateDirectBrowser(forced, target)).toBe(false)
})
test('rejects missing, early or forced shutdown and incomplete cleanup', () => {
  const missing = complete(); missing.stages = missing.stages.filter(stage => stage.name !== 'application.ready')
  expect(validateDirectBrowser(missing, expected)).toBe(false)
  const early = complete(); [early.stages[5], early.stages[8]] = [early.stages[8], early.stages[5]]
  expect(validateDirectBrowser(early, expected)).toBe(false)
  const forced = complete(); forced.exit.forced = true
  expect(validateDirectBrowser(forced, expected)).toBe(false)
  const cleanup = complete(); cleanup.cleanup.workspaceClose = 'incomplete'
  expect(validateDirectBrowser(cleanup, expected)).toBe(false)
})
test('rejects output loss, unjoined streams, wrong provenance and authentication', () => {
  const output = complete(); output.channels.stdout.acknowledgedBytes--
  expect(validateDirectBrowser(output, expected)).toBe(false)
  const hash = complete(); hash.channels.stdout.sha256 = 'wrong'
  expect(validateDirectBrowser(hash, expected)).toBe(false)
  const ended = complete(); ended.channels.stderr.ended = false
  expect(validateDirectBrowser(ended, expected)).toBe(false)
  const pin = complete(); pin.runtime = 'old-pin'
  expect(validateDirectBrowser(pin, expected)).toBe(false)
  const auth = complete(); auth.stages.find(stage => stage.name === 'authentication.missing-rejected')!.detail = { status: 200 }
  expect(validateDirectBrowser(auth, expected)).toBe(false)
})
