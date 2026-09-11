import { createHash } from 'node:crypto'
import { combinedFixture } from '../probes/opencode-bun-fixtures'
import { combinedValidator } from '../probes/opencode-bun-combined'

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')
const cleanExit = (exit: any) => exit?.exitCode === 0 && exit.forced === false && exit.signal === null
const cleanup = 'runtime.stop + workspace.flush + workspace.close completed'
export function validateCombined(result: any, expected: { runtime: string; assets: number; modelPosts: number; manifestSha256: string; installerSha256: string }) {
  try {
    if (result.status !== 'PASS' || result.mode !== 'combined-tools' || result.model !== true || result.restart !== false || result.sessionRetention !== false ||
      ['read', 'edit', 'grep', 'glob'].some(name => result[name] !== undefined && result[name] !== false) ||
      result.runtime !== expected.runtime || result.assets !== expected.assets || !cleanExit(result.exit) ||
      result.scope !== 'single fresh-origin lifecycle' || !Array.isArray(result.checks) || result.checks.length !== 9 ||
      !Array.isArray(result.database) || result.database.length !== 0 || !Array.isArray(result.phases) || result.phases.length !== 1) return false
    const phase = result.phases[0], model = result.modelEvidence, delivery = result.deliveryEvidence, evidence = result.combinedEvidence
    if (phase?.phase !== 'initial' || !cleanExit(phase.exit) || phase.cleanup !== cleanup || phase.checks?.length !== 8 ||
      model?.providerID !== 'opencode' || model.id !== 'muse-spark-1.3-contributor-free' || model.promptRequests !== 1 ||
      model.terminal !== 'session.execution.succeeded' || model.sseCleanup !== 'aborted and joined' || model.cleanup !== cleanup ||
      !Number.isInteger(model.toolEvents) || model.toolEvents < 12 || !Number.isInteger(expected.modelPosts) || expected.modelPosts < 1) return false
    if (delivery?.packageFiles !== 9 || delivery.manifestSha256 !== expected.manifestSha256 || delivery.installerSha256 !== expected.installerSha256 ||
      delivery.setupCheckpoint !== true || delivery.setupStderrBytes !== 0 || !cleanExit(delivery.setupExit) ||
      delivery.managedStop !== 'accepted' || delivery.cleanupExitStatus !== 'natural exit verified' || !cleanExit(delivery.exit)) return false
    if (!/^ses_[A-Za-z0-9_-]{1,196}$/.test(evidence?.sessionID) || evidence.bytesMatched !== true ||
      evidence.beforeBytes !== new TextEncoder().encode(combinedFixture.before).length || evidence.beforeSha256 !== sha256(combinedFixture.before) ||
      evidence.afterBytes !== new TextEncoder().encode(combinedFixture.after).length || evidence.afterSha256 !== sha256(combinedFixture.after) ||
      !Array.isArray(evidence.events) || evidence.events.length !== 12) return false
    const validator = combinedValidator(evidence.sessionID)
    for (const event of evidence.events) validator.accept(event)
    return validator.complete()
  } catch { return false }
}
