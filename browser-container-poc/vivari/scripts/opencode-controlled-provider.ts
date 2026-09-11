// Transport-only fixture: no upstream URL, fetch dependency, or generated content.
export function controlledProvider(waitMs = 30_000) {
  const evidence = { controlledTransport: true, externalModelRequests: 0, localRequests: 0,
    headersSent: false, transportClosed: false, closeReason: 'pending' }
  let ready!: () => void, closed!: () => void
  const readiness = new Promise<void>(resolve => { ready = resolve })
  const closure = new Promise<void>(resolve => { closed = resolve })
  const wait = async (phase: 'ready' | 'closed') => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([phase === 'ready' ? readiness : closure, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error('Controlled transport wait timed out')), waitMs)
      })])
      return { ...evidence }
    } finally { clearTimeout(timer) }
  }
  async function handle(request: Request) {
    evidence.localRequests++
    if (evidence.localRequests !== 1 || request.method !== 'POST' || new URL(request.url).pathname !== '/api/controlled-provider/responses')
      return new Response('Controlled transport rejects this request', { status: 409 })
    const body = await request.json().catch(() => null)
    if (body?.model !== 'muse-spark-1.3-contributor-free' || body.stream !== true)
      return new Response('Expected pinned streaming Responses request', { status: 400 })
    let timer: ReturnType<typeof setTimeout>
    let controller: ReadableStreamDefaultController<Uint8Array>
    const finish = (reason: string) => {
      if (evidence.transportClosed) return
      evidence.transportClosed = true; evidence.closeReason = reason
      clearTimeout(timer)
      request.signal.removeEventListener('abort', abort)
      if (reason !== 'response.cancel') controller.close()
      closed()
    }
    const abort = () => finish('request.abort')
    const stream = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value
        // Native Responses SSE ignores comments. No fabricated model/session events.
        controller.enqueue(new TextEncoder().encode(': controlled transport; not real model generation\n\n'))
        evidence.headersSent = true
        timer = setTimeout(() => finish('deadline'), waitMs)
        request.signal.addEventListener('abort', abort, { once: true })
        if (request.signal.aborted) abort()
        ready()
      },
      cancel() { finish('response.cancel') },
    })
    return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' } })
  }
  return { evidence, handle, wait }
}
