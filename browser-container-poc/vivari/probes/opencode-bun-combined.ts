import { combinedFixture, combinedPrompt, combinedSteps } from './opencode-bun-fixtures'

export type CombinedEvent = { type: string; data: { sessionID: string; id: string; assistantMessageID: string; name?: string; input?: unknown; executed?: boolean; content?: unknown } }
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value)
function exactInput(actual: unknown, expected: object) {
  return !!actual && typeof actual === 'object' && !Array.isArray(actual) &&
    Object.keys(actual).length === Object.keys(expected).length &&
    Object.entries(expected).every(([key, value]) => (actual as Record<string, unknown>)[key] === value)
}

// Canonical Started/Called/Success shapes from pinned schema/session-event.ts.
// Retain only validated evidence, never raw provider content or errors.
export function combinedValidator(sessionID: string) {
  const events: CombinedEvent[] = [], ids = new Set<string>()
  let index = 0, active: CombinedEvent['data'] | undefined, called = false, rejected = false
  return {
    events,
    accept(event: CombinedEvent) {
      if (rejected) throw Error('Combined tool event rejected')
      try {
        const d = event.data, step = combinedSteps[index]
        if (!step || d.sessionID !== sessionID || !identifier(d.id) || !identifier(d.assistantMessageID)) throw Error()
        if (event.type === 'session.tool.input.started') {
          if (active || ids.has(d.id) || d.name !== step.name) throw Error()
          ids.add(d.id); active = d; called = false
          events.push({ type: event.type, data: { sessionID, id: d.id, assistantMessageID: d.assistantMessageID, name: step.name } })
          return
        }
        if (!active || d.id !== active.id || d.assistantMessageID !== active.assistantMessageID) throw Error()
        if (event.type === 'session.tool.called') {
          if (called || d.executed !== false || !exactInput(d.input, step.input)) throw Error()
          called = true
          events.push({ type: event.type, data: { sessionID, id: d.id, assistantMessageID: d.assistantMessageID, input: step.input, executed: false } })
        } else if (event.type === 'session.tool.success') {
          if (!called || d.executed !== false || !Array.isArray(d.content) || !d.content.length) throw Error()
          if ('content' in step && (d.content.length !== 1 || d.content[0]?.type !== 'text' || d.content[0]?.text !== step.content)) throw Error()
          events.push({ type: event.type, data: { sessionID, id: d.id, assistantMessageID: d.assistantMessageID, executed: false,
            content: 'content' in step ? [{ type: 'text', text: step.content }] : [{ type: 'text', text: 'validated local edit success' }] } })
          index++; active = undefined
        } else if (event.type === 'session.tool.progress') {
          if (!called) throw Error()
        } else if (!['session.tool.input.delta', 'session.tool.input.ended'].includes(event.type) || called) throw Error()
      } catch { rejected = true; throw Error('Combined tool event rejected') }
    },
    complete: () => !rejected && index === 4 && !active && events.length === 12,
  }
}

export function combinedEvidence() {
  return { sessionID: '', events: [] as CombinedEvent[], beforeBytes: 0, beforeSha256: '', afterBytes: 0, afterSha256: '', bytesMatched: false }
}
type Evidence = ReturnType<typeof combinedEvidence>
type Endpoint = { fetch(path: string, init?: RequestInit): Promise<Response> }
type ModelEvidence = { providerID: string; id: string; promptRequests: number; terminal: string; sseCleanup: string; deltas: number; toolEvents: number; textBlocks: number; textLength: number }
export async function runCombined(endpoint: Endpoint, headers: Record<string, string>, evidence: Evidence, model: ModelEvidence) {
  const created = await endpoint.fetch('/api/session', { method: 'POST', headers, body: JSON.stringify({ title: 'Combined tools probe', location: { directory: '/workspace' }, model: { providerID: model.providerID, id: model.id } }), signal: AbortSignal.timeout(20_000) })
  if (!created.ok) throw Error()
  const data = (await created.json()).data
  if (!identifier(data?.id) || !data.id.startsWith('ses_') || data.title !== 'Combined tools probe') throw Error()
  evidence.sessionID = data.id
  const validator = combinedValidator(data.id)
  evidence.events = validator.events
  const subscription = new AbortController()
  const deadline = setTimeout(() => { model.terminal = 'deadline exceeded'; subscription.abort() }, 180_000)
  let drain: Promise<void> | undefined, complete = false, failed = false
  try {
    const response = await endpoint.fetch('/api/event', { headers, signal: subscription.signal })
    if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream') || !response.body) throw Error()
    const reader = response.body.getReader(), decoder = new TextDecoder()
    drain = (async () => {
      let pending = ''
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) { if (!complete) throw Error(); break }
          pending += decoder.decode(value, { stream: true })
          let end: number
          while ((end = pending.indexOf('\n')) !== -1) {
            const line = pending.slice(0, end); pending = pending.slice(end + 1)
            if (!line.startsWith('data: ')) continue
            const event = JSON.parse(line.slice(6))
            if (event.data?.sessionID !== evidence.sessionID) continue
            if (event.type.startsWith('session.tool.')) { model.toolEvents++; validator.accept(event) }
            if (event.type === 'session.execution.failed') throw Error()
            if (event.type === 'session.text.delta') model.deltas++
            if (event.type === 'session.text.ended' && typeof event.data.text === 'string') { model.textBlocks++; model.textLength += event.data.text.length }
            if (event.type === 'session.execution.succeeded') {
              if (complete || !validator.complete()) throw Error()
              complete = true; model.terminal = event.type
            }
          }
        }
      } catch {
        if (!subscription.signal.aborted) { failed = true; model.terminal = 'combined stream or tool event rejected'; subscription.abort() }
      } finally { reader.releaseLock() }
    })()
    model.promptRequests++
    const prompted = await endpoint.fetch('/api/session/' + encodeURIComponent(evidence.sessionID) + '/prompt', { method: 'POST', headers, body: JSON.stringify({ text: combinedPrompt }), signal: subscription.signal })
    if (!prompted.ok) throw Error()
    await prompted.arrayBuffer()
    while (!complete && !failed && !subscription.signal.aborted) await new Promise(resolve => setTimeout(resolve, 50))
    if (!complete || failed || subscription.signal.aborted || !validator.complete()) throw Error()
  } finally {
    clearTimeout(deadline); subscription.abort()
    if (drain) {
      let timer: ReturnType<typeof setTimeout> | undefined
      try { await Promise.race([drain, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('Combined SSE cleanup timed out')), 5_000) })]); model.sseCleanup = 'aborted and joined' }
      finally { clearTimeout(timer) }
    }
  }
  if (failed || !validator.complete()) throw Error('Combined terminal evidence rejected')
}

export async function combinedBytes(evidence: Evidence, phase: 'before' | 'after', bytes: Uint8Array, hash: (bytes: Uint8Array) => Promise<string>) {
  const expected = new TextEncoder().encode(combinedFixture[phase])
  evidence[`${phase}Bytes`] = bytes.length
  evidence[`${phase}Sha256`] = await hash(bytes)
  const matched = bytes.length === expected.length && bytes.every((byte, i) => byte === expected[i])
  if (phase === 'after') evidence.bytesMatched = matched
  if (!matched) throw Error('Combined file bytes rejected')
}
