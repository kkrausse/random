// Failure receipts accept only known diagnostic labels and scalar observations.
const stages = ['created', 'session.request', 'subscription.request', 'subscription.ready', 'prompt.request', 'prompt.accepted',
  'provider.ready', 'step.started', 'interrupt.request', 'interrupt.response', 'terminal.interrupted', 'context.request',
  'context.aborted', 'health.verified', 'transport.close.wait', 'transport.closed', 'managedStop.request', 'managedStop.settled', 'exit.settled',
  ...['runtime.stop', 'workspace.flush', 'workspace.close', 'output.drain'].flatMap(name => [name + '.completed', name + '.failed'])]
export function interruptFailure(input: unknown) {
  const source = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  const raw = source.interruptEvidence
  const e = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const evidence: Record<string, unknown> = {}
  for (const key of ['controlledTransport', 'realModelGeneration', 'stepStarted', 'assistantAborted', 'healthAfterInterrupt'])
    if (typeof e[key] === 'boolean') evidence[key] = e[key]
  for (const key of ['promptRequests', 'interruptStatus'])
    if (typeof e[key] === 'number' && Number.isFinite(e[key])) evidence[key] = e[key]
  const labels: Record<string, string[]> = { stage: stages, failedAt: ['', ...stages], terminal: ['pending', 'session.execution.interrupted'],
    reason: ['pending', 'user', 'other'], sseCleanup: ['pending', 'aborted and joined', 'join timed out'],
    managedStop: ['pending', 'accepted', 'failed'], cleanupExitStatus: ['pending', 'natural exit verified', 'unexpected exit', 'exit unavailable within bound'] }
  for (const [key, values] of Object.entries(labels)) if (typeof e[key] === 'string' && values.includes(e[key])) evidence[key] = e[key]
  const progress = e.progress && typeof e.progress === 'object' ? e.progress as Record<string, unknown> : {}
  evidence.progress = Object.fromEntries(stages.filter(key => typeof progress[key] === 'number' && Number.isFinite(progress[key])).map(key => [key, progress[key]]))
  const exit = e.exit as Record<string, unknown> | null
  if (exit && typeof exit.exitCode === 'number' && Number.isFinite(exit.exitCode) && typeof exit.forced === 'boolean')
    evidence.exit = { exitCode: exit.exitCode, forced: exit.forced, signal: exit.signal === null ? null : 'present' }
  return { status: 'FAIL', error: 'Controlled interrupt incomplete or rejected', interruptEvidence: evidence }
}
