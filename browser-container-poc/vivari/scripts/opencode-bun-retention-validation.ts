import { createHash } from 'node:crypto'
import { validateCombined } from './opencode-bun-combined-validation'
import { combinedTitle, retentionCleanup, retentionScope, retentionCheckpoints, stableJSON } from '../probes/opencode-bun-retention'

export function validateCombinedRetention(result: any, expected: Parameters<typeof validateCombined>[1] & { firstPosts: number | undefined; finalPosts: number | undefined }) {
  try {
    const r = result.retention
    if (result.combinedRetention !== true || result.restart !== true || result.scope !== retentionScope ||
      result.phases?.length !== 2 || result.checks?.length !== 21 || result.database?.length !== 2 ||
      r?.sessionID !== result.combinedEvidence?.sessionID || r.title !== combinedTitle || r.freshRegistration !== true || r.freshEndpoint !== true || r.oldEndpointRejected !== true ||
      !Number.isInteger(expected.firstPosts) || expected.firstPosts! < 1 || expected.finalPosts !== expected.firstPosts || expected.modelPosts !== expected.firstPosts ||
      stableJSON(r.providerPosts) !== stableJSON([expected.firstPosts, expected.finalPosts])) return false
    for (const [i, phase] of result.phases.entries()) {
      if (phase.phase !== (i ? 'reopened' : 'initial') || phase.checks?.length !== 10 || phase.cleanup !== retentionCleanup ||
        phase.exit?.exitCode !== 0 || phase.exit.forced !== false || phase.exit.signal !== null ||
        !Array.isArray(phase.outputBytes) || phase.outputBytes.length !== 2 || phase.outputBytes.some((n: number) => !Number.isInteger(n) || n < 0)) return false
    }
    if (!result.phases[0].checks.includes(retentionCheckpoints.captured) || !result.phases[0].checks.includes(retentionCheckpoints.endpoint) ||
      ![retentionCheckpoints.before, retentionCheckpoints.after, retentionCheckpoints.posts].every(c => result.phases[1].checks.includes(c))) return false
    for (const [i, db] of result.database.entries()) {
      if (db.path !== '/.server/data/opencode.sqlite' || db.sqliteHeader !== true || !Number.isInteger(db.bytes) || db.bytes < 100 || !/^[a-f0-9]{64}$/.test(db.sha256) ||
        db.checkpoint !== (i ? 'after reopen, before second Runtime.start' : 'after first runtime.stop and workspace.flush, before close')) return false
    }
    if (result.database[0].bytes !== result.database[1].bytes || result.database[0].sha256 !== result.database[1].sha256 ||
      r.files?.length !== 2 || r.files.some((f: any, i: number) => f.checkpoint !== (i ? 'after health' : 'before runtime') ||
        f.bytes !== result.combinedEvidence.afterBytes || f.sha256 !== result.combinedEvidence.afterSha256)) return false
    if (!r.before || stableJSON(r.before) !== stableJSON(r.after) || r.before.tools !== 4 || r.before.assistants < 1 ||
      !Array.isArray(r.before.messages) || !r.before.messages.length ||
      createHash('sha256').update(stableJSON(r.before.messages)).digest('hex') !== r.before.sha256) return false
    const digest = (v: unknown) => createHash('sha256').update(stableJSON(v)).digest('hex')
    const isHash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
    const ids = new Set<string>()
    for (const m of r.before.messages) {
      if (typeof m.id !== 'string' || !/^msg_[A-Za-z0-9_-]+$/.test(m.id) || ids.has(m.id)) return false
      ids.add(m.id)
      if (m.type === 'assistant') {
        if (m.status !== 'completed' || !isHash(m.finishSha256) || !Array.isArray(m.content) || !m.content.length ||
          stableJSON(m) !== stableJSON({ id: m.id, type: m.type, status: m.status, finishSha256: m.finishSha256, content: m.content })) return false
        for (const p of m.content) {
          if (p.type === 'tool') {
            if (stableJSON(p) !== stableJSON({ type: p.type, id: p.id, name: p.name, status: p.status, executed: p.executed, inputSha256: p.inputSha256, contentSha256: p.contentSha256 })) return false
          } else if (!['text', 'reasoning'].includes(p.type) || !isHash(p.sha256) || stableJSON(p) !== stableJSON({ type: p.type, sha256: p.sha256 })) return false
        }
      } else if (!['user', 'system', 'synthetic', 'agent-switched', 'model-switched'].includes(m.type) || !isHash(m.sha256) ||
        stableJSON(m) !== stableJSON({ id: m.id, type: m.type, sha256: m.sha256 })) return false
    }
    if (r.before.messages.filter((m: any) => m.type === 'user').length !== 1 ||
      r.before.messages.filter((m: any) => m.type === 'assistant').length !== r.before.assistants) return false
    const tools = r.before.messages.flatMap((m: any) => (m.content ?? []).filter((p: any) => p.type === 'tool').map((p: any) => ({ ...p, messageID: m.id })))
    if (tools.length !== 4 || tools.some((t: any, i: number) => t.id !== result.combinedEvidence.events[i * 3].data.id ||
      t.messageID !== result.combinedEvidence.events[i * 3].data.assistantMessageID || t.name !== result.combinedEvidence.events[i * 3].data.name ||
      t.status !== 'completed' || t.executed !== false || t.inputSha256 !== digest(result.combinedEvidence.events[i * 3 + 1].data.input) || !isHash(t.contentSha256))) return false
    return validateCombined({ ...result, restart: false, scope: 'single fresh-origin lifecycle', checks: Array(9), database: [],
      phases: [{ ...result.phases[0], checks: Array(8) }] }, expected)
  } catch { return false }
}
