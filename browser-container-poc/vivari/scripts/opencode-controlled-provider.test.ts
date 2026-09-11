import { expect, test } from 'bun:test'
import { controlledProvider } from './opencode-controlled-provider'

test('held Responses stream flushes a comment, then records real consumer cancellation', async () => {
  const provider = controlledProvider(1000)
  const response = await provider.handle(new Request('http://fixture/api/controlled-provider/responses', {
    method: 'POST', body: JSON.stringify({ model: 'muse-spark-1.3-contributor-free', stream: true }),
  }))
  expect(response.headers.get('content-type')).toBe('text/event-stream')
  const reader = response.body!.getReader()
  expect(new TextDecoder().decode((await reader.read()).value)).toStartWith(': controlled transport')
  let settled = false
  const pending = reader.read().then(value => { settled = true; return value })
  await Bun.sleep(10)
  expect(settled).toBe(false)
  expect((await provider.wait('ready')).transportClosed).toBe(false)
  await reader.cancel()
  expect((await pending).done).toBe(true)
  expect(await provider.wait('closed')).toMatchObject({ controlledTransport: true, externalModelRequests: 0,
    localRequests: 1, headersSent: true, transportClosed: true, closeReason: 'response.cancel' })
})

test('request abort closes the held body; unsupported route never forwards', async () => {
  const rejected = controlledProvider(100)
  expect((await rejected.handle(new Request('https://upstream.invalid/api/model/opencode/responses', { method: 'POST' }))).status).toBe(409)
  expect(rejected.evidence.externalModelRequests).toBe(0)
  expect(rejected.evidence.headersSent).toBe(false)
  const provider = controlledProvider(1000), controller = new AbortController()
  const response = await provider.handle(new Request('http://fixture/api/controlled-provider/responses', { method: 'POST',
    signal: controller.signal, body: JSON.stringify({ model: 'muse-spark-1.3-contributor-free', stream: true }) }))
  const reader = response.body!.getReader()
  await reader.read()
  controller.abort()
  expect((await reader.read()).done).toBe(true)
  expect((await provider.wait('closed')).closeReason).toBe('request.abort')
})

test('provider deadlines cannot masquerade as cancellation', async () => {
  const provider = controlledProvider(10)
  await provider.handle(new Request('http://fixture/api/controlled-provider/responses', { method: 'POST',
    body: JSON.stringify({ model: 'muse-spark-1.3-contributor-free', stream: true }) }))
  expect((await provider.wait('closed')).closeReason).toBe('deadline')
  await expect(controlledProvider(5).wait('ready')).rejects.toThrow('timed out')
})
