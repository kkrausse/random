import { expect, test } from 'bun:test'
import { interruptEvidence, runInterrupt } from '../probes/opencode-bun-interrupt'

// Isolated harness contract: no server, runtime, provider, or network is started.
test('subscription barrier precedes prompt; provider readiness permits interrupt before step-start', async () => {
  const evidence = interruptEvidence()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  let connect!: () => void
  const subscribed = new Promise<void>(resolve => { connect = resolve })
  const send = (type: string, data = {}) => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type, data })}\n\n`))
  const endpoint = { async fetch(path: string, init?: RequestInit) {
    if (path === '/api/session') return Response.json({ data: { id: 'ses_test' } })
    if (path === '/api/event') {
      const body = new ReadableStream<Uint8Array>({ start(c) { controller = c } })
      init!.signal!.addEventListener('abort', () => controller.close(), { once: true })
      connect()
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
    }
    if (path.endsWith('/prompt')) return new Response(null, { status: 204 })
    if (path.endsWith('/interrupt')) {
      expect(evidence.stepStarted).toBe(false)
      const data = { sessionID: 'ses_test', assistantMessageID: 'msg_test' }
      send('session.step.started', data)
      send('session.step.failed', { ...data, error: { type: 'aborted' } })
      send('session.execution.interrupted', { sessionID: 'ses_test', reason: 'user' })
      return new Response(null, { status: 204 })
    }
    if (path.endsWith('/context')) return Response.json({ data: [{ id: 'msg_test', type: 'assistant', error: { type: 'aborted' }, time: { completed: 1 } }] })
    if (path === '/api/health') return Response.json({ healthy: true })
    throw Error('Unexpected fixture request')
  } }
  const hostFetch = (async (url: string) => Response.json(url.includes('phase=ready')
    ? { localRequests: 1, headersSent: true, transportClosed: false }
    : { transportClosed: true, closeReason: 'response.cancel' })) as typeof fetch
  const pending = runInterrupt(endpoint, {}, 'test', evidence, hostFetch)
  await subscribed
  await Bun.sleep(5)
  expect(evidence.promptRequests).toBe(0)
  send('server.connected')
  await pending
  expect(evidence.assistantAborted).toBe(true)
  expect(evidence.progress['interrupt.request']).toBeLessThanOrEqual(evidence.progress['step.started'])
  expect(evidence.sseCleanup).toBe('aborted and joined')
})
