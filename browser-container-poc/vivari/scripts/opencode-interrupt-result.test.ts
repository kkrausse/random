import { expect, test } from 'bun:test'
import { interruptFailure } from './opencode-interrupt-result'

test('failed acceptance preserves independent checkpoints and removes arbitrary payloads', () => {
  const result = interruptFailure({ status: 'FAIL', error: 'secret', interruptEvidence: {
    stage: 'transport.close.wait', failedAt: 'transport.close.wait', stepStarted: true, interruptStatus: 204,
    terminal: 'session.execution.interrupted', reason: 'user', assistantAborted: true, healthAfterInterrupt: true,
    managedStop: 'accepted', cleanupExitStatus: 'natural exit verified', exit: { exitCode: 0, forced: false, signal: null },
    progress: { 'subscription.ready': 1, 'prompt.accepted': 2, 'context.aborted': 3, 'exit.settled': 4, secret: 'authorization' },
    prompt: 'secret', authorization: 'secret',
  } })
  expect(result.interruptEvidence).toMatchObject({ failedAt: 'transport.close.wait', interruptStatus: 204,
    assistantAborted: true, healthAfterInterrupt: true, exit: { exitCode: 0, forced: false, signal: null },
    progress: { 'subscription.ready': 1, 'prompt.accepted': 2, 'context.aborted': 3, 'exit.settled': 4 } })
  expect(JSON.stringify(result)).not.toContain('secret')
  expect(JSON.stringify(result)).not.toContain('authorization')
})

test('malformed evidence cannot inject raw labels or timestamps into failure receipts', () => {
  expect(interruptFailure({ interruptEvidence: { stage: 'raw body', reason: 'raw error', interruptStatus: Infinity,
    progress: { 'subscription.ready': 'raw text', 'prompt.accepted': NaN } } }).interruptEvidence).toEqual({ progress: {} })
  expect(interruptFailure(null).status).toBe('FAIL')
})
