import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { combinedSteps, combinedFixture } from '../probes/opencode-bun-fixtures'
import { projectHistory, sameHistory, retentionCheckpoints, retentionCleanup, retentionScope, combinedTitle } from '../probes/opencode-bun-retention'
import { combinedBytes, combinedEvidence } from '../probes/opencode-bun-combined'
import { validateCombinedRetention } from './opencode-bun-retention-validation'

const sha = (v: string | Uint8Array) => createHash('sha256').update(v).digest('hex')
const hash = async (v: Uint8Array) => sha(v)
const events = combinedSteps.flatMap((s, i) => {
  const data = { sessionID: 'ses_test', id: 'tool_' + i, assistantMessageID: 'msg_' + i }
  return [{ type: 'session.tool.input.started', data: { ...data, name: s.name } },
    { type: 'session.tool.called', data: { ...data, input: s.input, executed: false } },
    { type: 'session.tool.success', data: { ...data, executed: false, content: [{ type: 'text', text: 'content' in s ? s.content : 'edit done' }] } }]
})
function context() {
  return [{ id: 'msg_user', type: 'user', text: 'synthetic prompt', time: { created: 1 } }, ...combinedSteps.map((s, i) => ({
    id: 'msg_' + i, type: 'assistant', time: { created: 1, completed: 2 }, finish: 'tool-calls',
    content: [{ type: 'reasoning', text: 'SECRET_REASONING', state: { secret: 'AUTH_SECRET' } },
      { type: 'tool', id: 'tool_' + i, name: s.name, executed: false, state: { status: 'completed', input: s.input,
        content: [{ type: 'text', text: 'content' in s ? s.content : 'edit done' }] } }],
  }))]
}
test('pinned nested tools project to stable sanitized hashes; timestamps/provider state omitted', async () => {
  const before = await projectHistory(context(), events, hash), changed: any = context()
  changed[1].time.completed = 99; changed[1].content[0].state = { other: 'changed' }
  sameHistory(before, await projectHistory(changed, events, hash))
  expect(JSON.stringify(before)).not.toContain('SECRET')
  expect(before.tools).toBe(4)
})
test('changed prose/edit result, missing history, incomplete and foreign tools reject', async () => {
  const before = await projectHistory(context(), events, hash)
  for (const mutate of [
    (c: any) => { c[1].content[0].text = 'changed' },
    (c: any) => { c[2].content[1].state.content[0].text = 'different edit result' },
  ]) {
    const c = context(); mutate(c)
    const after = await projectHistory(c, events, hash)
    expect(() => sameHistory(before, after)).toThrow('history changed')
  }
  for (const mutate of [(c: any) => c.pop(), (c: any) => { delete c[1].time.completed },
    (c: any) => { c[1].content[1].id = 'tool_foreign' }, (c: any) => { c[1].content[1].state.status = 'running' }]) {
    const c = context(); mutate(c)
    await expect(projectHistory(c, events, hash)).rejects.toThrow('Combined retention history rejected')
  }
})
test('reopened file check accepts edited bytes and rejects reseed or missing newline', async () => {
  await combinedBytes(combinedEvidence(), 'after', new TextEncoder().encode(combinedFixture.after), hash)
  for (const text of [combinedFixture.before, combinedFixture.after.trimEnd()]) {
    await expect(combinedBytes(combinedEvidence(), 'after', new TextEncoder().encode(text), hash)).rejects.toThrow('Combined file bytes rejected')
  }
})
async function result() {
  const exit = { exitCode: 0, forced: false, signal: null }, history = await projectHistory(context(), events, hash)
  const combined = combinedEvidence(); combined.sessionID = 'ses_test'; combined.events = events
  await combinedBytes(combined, 'before', new TextEncoder().encode(combinedFixture.before), hash)
  await combinedBytes(combined, 'after', new TextEncoder().encode(combinedFixture.after), hash)
  return { status: 'PASS', mode: 'combined-tools', model: true, restart: true, sessionRetention: false, combinedRetention: true,
    runtime: 'runtime', assets: 1, exit, checks: Array(21), scope: retentionScope,
    phases: ['initial', 'reopened'].map((phase, i) => ({ phase, exit, cleanup: retentionCleanup, outputBytes: [10, 0],
      checks: i ? [retentionCheckpoints.before, retentionCheckpoints.after, retentionCheckpoints.posts, ...Array(7)] : [retentionCheckpoints.captured, retentionCheckpoints.endpoint, ...Array(8)] })),
    database: ['after first runtime.stop and workspace.flush, before close', 'after reopen, before second Runtime.start'].map(checkpoint => ({ checkpoint, path: '/.server/data/opencode.sqlite', bytes: 4096, sha256: sha('db'), sqliteHeader: true })),
    modelEvidence: { providerID: 'opencode', id: 'muse-spark-1.3-contributor-free', promptRequests: 1, toolEvents: 12, terminal: 'session.execution.succeeded', sseCleanup: 'aborted and joined', cleanup: retentionCleanup },
    deliveryEvidence: { packageFiles: 9, manifestSha256: 'manifest', installerSha256: 'installer', setupCheckpoint: true, setupStderrBytes: 0, setupExit: exit, exit, managedStop: 'accepted', cleanupExitStatus: 'natural exit verified' },
    combinedEvidence: combined, retention: { sessionID: 'ses_test', title: combinedTitle, before: history, after: structuredClone(history),
      files: ['before runtime', 'after health'].map(checkpoint => ({ checkpoint, bytes: combined.afterBytes, sha256: combined.afterSha256 })),
      providerPosts: [5, 5], freshRegistration: true, freshEndpoint: true, oldEndpointRejected: true } }
}
const expected = { runtime: 'runtime', assets: 1, modelPosts: 5, firstPosts: 5, finalPosts: 5, manifestSha256: 'manifest', installerSha256: 'installer' }
test('dedicated host validator requires both cleanup phases, unchanged history/file/db and host POST checkpoints', async () => {
  expect(validateCombinedRetention(await result(), expected)).toBe(true)
  for (const mutate of [(r: any) => { r.retention.after.messages.pop() }, (r: any) => { r.retention.files[0].sha256 = sha(combinedFixture.before) },
    (r: any) => { r.database[1].bytes++ }, (r: any) => { r.phases[1].exit = { exitCode: 0, forced: true, signal: null } },
    (r: any) => { r.retention.freshRegistration = false }, (r: any) => { r.retention.oldEndpointRejected = false },
    (r: any) => { r.modelEvidence.promptRequests = 2 }]) {
    const r = await result(); mutate(r)
    expect(validateCombinedRetention(r, expected)).toBe(false)
  }
  expect(validateCombinedRetention(await result(), { ...expected, modelPosts: 6 })).toBe(false)
  expect(validateCombinedRetention(await result(), { ...expected, firstPosts: undefined })).toBe(false)
})
