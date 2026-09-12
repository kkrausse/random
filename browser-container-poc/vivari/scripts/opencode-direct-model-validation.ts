import { combinedValidator } from '../probes/opencode-bun-combined'
import { stableJSON } from '../probes/opencode-bun-retention'
import { createHash } from 'node:crypto'
import { combinedFixture } from '../probes/opencode-bun-fixtures'

export function validateDirectModel(model: any, requests: { method: string; path: string; status: number }[]) {
  if (!model || model.failure !== null || !model.catalogVerified || !model.configVerified || model.providerID !== 'opencode' ||
    model.id !== 'muse-spark-1.3-contributor-free' || model.promptRequests !== 1 || model.terminal !== 'session.execution.succeeded' ||
    model.sseCleanup !== 'aborted and joined' || model.deltas < 1 || model.textBlocks < 1 || model.textLength < 1) return false
  const c = model.combined
  try {
    const validator = combinedValidator(c.sessionID)
    for (const event of c.events) validator.accept(event)
    if (!validator.complete()) return false
  } catch { return false }
  const hash = (text: string) => createHash('sha256').update(text).digest('hex')
  if (!c.bytesMatched || c.beforeSha256 !== hash(combinedFixture.before) || c.afterSha256 !== hash(combinedFixture.after) ||
    c.beforeBytes !== Buffer.byteLength(combinedFixture.before) || c.afterBytes !== Buffer.byteLength(combinedFixture.after) ||
    model.fileBeforeReopen !== c.afterSha256) return false
  if (!model.before || model.before.tools !== 4 || model.before.assistants < 1 || stableJSON(model.before) !== stableJSON(model.after)) return false
  const tools = model.before.messages.flatMap((m: any) => m.content ?? []).filter((p: any) => p.type === 'tool')
  if (tools.length !== 4 || tools.some((p: any, i: number) => p.status !== 'completed' || p.executed !== false || p.id !== c.events[i * 3].data.id)) return false
  const setup = model.setup
  return setup?.checkpoint === true && setup.assets?.length === 10 && setup.stderrBytes === 0 && setup.exit?.exitCode === 0 &&
    setup.exit.forced === false && setup.exit.signal === null && requests.filter(r => r.method === 'POST').length >= 5 &&
    requests.every(r => r.status === 200 && r.path.startsWith('/api/model/opencode/'))
}
