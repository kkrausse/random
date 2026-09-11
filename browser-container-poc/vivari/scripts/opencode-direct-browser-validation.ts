type Asset = { file: string; bytes: number; sha256: string }
export function validateDirectBrowser(result: any, expected: { runtime: string; assets: Asset[]; channels: Record<string, { bytes: number; sha256: string }> }) {
  if (result?.status !== 'PASS' || result.primaryFailure !== null || result.secondaryFailures?.length !== 0 || result.runtime !== expected.runtime) return false
  if (result.exit?.exitCode !== 0 || result.exit.signal !== null || result.exit.forced !== false) return false
  if (JSON.stringify(result.assets) !== JSON.stringify(expected.assets)) return false
  for (const key of ['runtimeStop', 'workspaceFlush', 'workspaceClose', 'drains']) if (result.cleanup?.[key] !== 'completed') return false
  if (result.cleanup.executionStop !== 'not needed') return false
  const stages = result.stages
  if (!Array.isArray(stages)) return false
  const required = ['runtime.provenance-verified', 'opfs.fresh-durable', 'assets.verified', 'process.launched', 'listener', 'application.ready',
    'authentication.missing-rejected', 'health.authenticated', 'stdin.eof-posted', 'application.scope-closed', 'process.natural-exit',
    'cleanup.runtimeStop', 'cleanup.workspaceFlush', 'cleanup.workspaceClose', 'cleanup.drains']
  let previous = -1
  for (const name of required) {
    const index = stages.findIndex((stage: any) => stage.name === name)
    if (index <= previous) return false
    previous = index
  }
  const detail = (name: string) => stages.find((stage: any) => stage.name === name)?.detail
  if (detail('listener')?.port !== 4096 || detail('authentication.missing-rejected')?.status !== 401) return false
  const health = detail('health.authenticated')
  if (health?.status !== 200 || health.healthy !== true || health.version !== '0.0.0-beta-19425' || !Number.isInteger(health.pid) || health.pid <= 0) return false
  for (const channel of ['stdout', 'stderr']) {
    const observed = result.channels?.[channel], persisted = expected.channels[channel]
    if (!observed || observed.ended !== true || observed.errors?.length !== 0 || observed.receivedBytes !== persisted.bytes ||
      observed.acknowledgedBytes !== persisted.bytes || observed.sha256 !== persisted.sha256) return false
  }
  return expected.channels.stdout.bytes > 0 && expected.channels.stderr.bytes === 0
}
