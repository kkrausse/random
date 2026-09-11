type Endpoint = { fetch(path: string, init?: RequestInit): Promise<Response> }
export function interruptEvidence() {
  return { controlledTransport: true, realModelGeneration: false, promptRequests: 0, interruptStatus: 0,
    stepStarted: false, terminal: 'pending', reason: 'pending', assistantAborted: false, healthAfterInterrupt: false, sseCleanup: 'pending',
    stage: 'created', failedAt: '', progress: {} as Record<string, number>,
    managedStop: 'pending', cleanupExitStatus: 'pending', exit: null as { exitCode: number; forced: boolean; signal: string | null } | null }
}
export async function runInterrupt(endpoint: Endpoint, headers: Record<string, string>, runID: string, evidence = interruptEvidence(), hostFetch: typeof fetch = fetch) {
  const mark = (stage: string) => { evidence.stage = stage; evidence.progress[stage] = Date.now() }
  const subscription = new AbortController()
  const timer = setTimeout(() => subscription.abort(), 65_000)
  let drain: Promise<void> | undefined
  let assistantMessageID = '', interrupted = false, stepFailed = false, invalid = false
  let connected!: () => void, terminal!: () => void
  const ready = new Promise<void>(resolve => { connected = resolve })
  const end = new Promise<void>(resolve => { terminal = resolve })
  const awaitHost = async (phase: string) => {
    const response = await hostFetch(`/controlled-provider-wait?runID=${encodeURIComponent(runID)}&phase=${phase}`, { signal: subscription.signal })
    if (!response.ok) throw Error('Controlled transport wait failed')
    return response.json()
  }
  const wait = async (promise: Promise<unknown>) => {
    await Promise.race([promise, new Promise<never>((_, reject) => {
      if (subscription.signal.aborted) reject(Error('Interrupt deadline'))
      else subscription.signal.addEventListener('abort', () => reject(Error('Interrupt deadline')), { once: true })
    })])
  }
  try {
    mark('session.request')
    const created = await endpoint.fetch('/api/session', { method: 'POST', headers, signal: subscription.signal,
      body: JSON.stringify({ title: 'Controlled transport interrupt (not real model generation)', location: { directory: '/workspace' },
        model: { providerID: 'opencode', id: 'muse-spark-1.3-contributor-free' } }) })
    if (created.status !== 200) throw Error()
    const sessionID = (await created.json()).data?.id
    if (typeof sessionID !== 'string' || !sessionID.startsWith('ses_')) throw Error()
    mark('subscription.request')
    const response = await endpoint.fetch('/api/event', { headers, signal: subscription.signal })
    if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream') || !response.body) throw Error()
    const reader = response.body.getReader(), decoder = new TextDecoder()
    drain = (async () => {
      let pending = ''
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) { if (!interrupted) throw Error(); return }
          pending += decoder.decode(value, { stream: true })
          let index: number
          while ((index = pending.indexOf('\n')) !== -1) {
            const line = pending.slice(0, index); pending = pending.slice(index + 1)
            if (!line.startsWith('data: ')) continue
             const event = JSON.parse(line.slice(6)), data = event.data
             if (event.type === 'server.connected') { mark('subscription.ready'); connected() }
            if (data?.sessionID !== sessionID) continue
            if (event.type === 'session.step.started') {
              if (assistantMessageID || typeof data.assistantMessageID !== 'string') invalid = true
              assistantMessageID = data.assistantMessageID; evidence.stepStarted = true; mark('step.started')
            }
            if (event.type === 'session.step.failed') stepFailed = data.assistantMessageID === assistantMessageID && data.error?.type === 'aborted'
            if (event.type.startsWith('session.tool.') || ['session.execution.failed', 'session.execution.succeeded'].includes(event.type)) invalid = true
            if (event.type === 'session.execution.interrupted') {
              interrupted = true; evidence.terminal = event.type; evidence.reason = data.reason === 'user' ? 'user' : 'other'; mark('terminal.interrupted'); terminal()
            }
            if (invalid) throw Error()
          }
        }
      } catch { if (!subscription.signal.aborted) { invalid = true; subscription.abort() } }
      finally { reader.releaseLock() }
    })()
    // EventFeed installs its queue before emitting server.connected; HTTP headers alone do not prove readiness.
    await wait(ready)
    mark('prompt.request'); evidence.promptRequests++
    const prompted = await endpoint.fetch(`/api/session/${sessionID}/prompt`, { method: 'POST', headers,
      body: JSON.stringify({ text: 'Wait for interruption. Do not invoke tools.' }), signal: subscription.signal })
    if (!prompted.ok) throw Error()
    await prompted.arrayBuffer()
    mark('prompt.accepted')
    const provider = await awaitHost('ready')
    if (provider.localRequests !== 1 || !provider.headersSent || provider.transportClosed) throw Error()
    mark('provider.ready')
    // A comment-only provider has no LLM step-start. Interruption settlement starts/fails the assistant.
    mark('interrupt.request')
    const result = await endpoint.fetch(`/api/session/${sessionID}/interrupt`, { method: 'POST', headers, signal: subscription.signal })
    evidence.interruptStatus = result.status
    mark('interrupt.response')
    if (result.status !== 204) throw Error()
    await wait(end)
    if (invalid || evidence.reason !== 'user' || !stepFailed) throw Error()
    // Pinned groups/session.ts context -> SessionMessage.Info[]; assistant.error is SessionError.Error.
    mark('context.request')
    const context = await endpoint.fetch(`/api/session/${sessionID}/context`, { headers, signal: subscription.signal })
    if (!context.ok) throw Error()
    const messages = (await context.json()).data
    const assistant = Array.isArray(messages) ? messages.find(message => message.id === assistantMessageID) : undefined
    evidence.assistantAborted = assistant?.type === 'assistant' && assistant.error?.type === 'aborted' && assistant.time?.completed != null
    if (!evidence.assistantAborted) throw Error()
    mark('context.aborted')
    const health = await endpoint.fetch('/api/health', { headers, signal: subscription.signal })
    evidence.healthAfterInterrupt = health.status === 200 && (await health.json()).healthy === true
    if (!evidence.healthAfterInterrupt) throw Error()
    mark('health.verified')
    mark('transport.close.wait')
    const transport = await awaitHost('closed')
    if (!transport.transportClosed || !['request.abort', 'response.cancel'].includes(transport.closeReason)) throw Error()
    mark('transport.closed')
    return evidence
  } catch {
    evidence.failedAt = evidence.stage
    throw Error('Controlled interrupt checkpoint failed')
  } finally {
    clearTimeout(timer); subscription.abort()
    if (drain) {
      let joinTimer: ReturnType<typeof setTimeout> | undefined
      try { await Promise.race([drain, new Promise<never>((_, reject) => { joinTimer = setTimeout(() => reject(Error('SSE join timed out')), 5000) })]) }
      catch { evidence.sseCleanup = 'join timed out'; throw Error('SSE join timed out') }
      finally { clearTimeout(joinTimer) }
      evidence.sseCleanup = 'aborted and joined'
    }
  }
}
