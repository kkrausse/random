import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { validateDirectModel } from './opencode-direct-model-validation'
import { combinedSteps, combinedFixture } from '../probes/opencode-bun-fixtures'
import { combinedBytes, combinedEvidence } from '../probes/opencode-bun-combined'
import { projectHistory } from '../probes/opencode-bun-retention'

const hash = async (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
async function fixture() {
  const c = combinedEvidence(); c.sessionID = 'ses_validator'
  c.events = combinedSteps.flatMap((step, i) => {
    const data = { sessionID: c.sessionID, id: 'tool_' + i, assistantMessageID: 'msg_' + i }
    return [{ type: 'session.tool.input.started', data: { ...data, name: step.name } },
      { type: 'session.tool.called', data: { ...data, input: step.input, executed: false } },
      { type: 'session.tool.success', data: { ...data, executed: false, content: [{ type: 'text', text: 'content' in step ? step.content : 'edit done' }] } }]
  })
  const context = [{ id: 'msg_user', type: 'user', text: 'validator fixture' }, ...combinedSteps.map((step, i) => ({
    id: 'msg_' + i, type: 'assistant', time: { completed: 1 }, content: [{
      type: 'tool', id: 'tool_' + i, name: step.name, executed: false,
      state: { status: 'completed', input: step.input, content: [{ type: 'text', text: 'content' in step ? step.content : 'edit done' }] },
    }],
  }))]
  const before = await projectHistory(context, c.events, hash)
  for (const phase of ['before', 'after'] as const) await combinedBytes(c, phase, new TextEncoder().encode(combinedFixture[phase]), hash)
  return { providerID: 'opencode', id: 'muse-spark-1.3-contributor-free', failure: null, catalogVerified: true, configVerified: true,
    promptRequests: 1, terminal: 'session.execution.succeeded', sseCleanup: 'aborted and joined', deltas: 1, textBlocks: 1, textLength: 17,
    combined: c, before, after: structuredClone(before), fileBeforeReopen: c.afterSha256,
    setup: { checkpoint: true, assets: Array(10), stderrBytes: 0, exit: { exitCode: 0, forced: false, signal: null } } }
}
const requests = Array.from({ length: 5 }, () => ({ method: 'POST', path: '/api/model/opencode/responses', status: 200 }))
test('accepts full model, correlated local tools, exact file and retained conversation evidence', async () => {
  expect(validateDirectModel(await fixture(), requests)).toBe(true)
})
test('rejects provider failures, prose-only, incomplete tools, reseeded files and changed conversation', async () => {
  for (const mutate of [
    (m: any) => { m.catalogVerified = false }, (m: any) => { m.textLength = 0 },
    (m: any) => { m.combined.events[2].data.executed = true }, (m: any) => { m.combined.events.pop() },
    (m: any) => { m.fileBeforeReopen = m.combined.beforeSha256 },
    (m: any) => { m.after.messages.pop() }, (m: any) => { m.setup.exit.forced = true },
    (m: any) => { m.failure = 'model failed' },
  ]) { const m = await fixture(); mutate(m); expect(validateDirectModel(m, requests)).toBe(false) }
  expect(validateDirectModel(await fixture(), [{ ...requests[0], status: 401 }])).toBe(false)
  expect(validateDirectModel(await fixture(), [])).toBe(false)
})
