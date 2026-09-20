import {
  MOBILE_BRIDGE_HANDLER,
  MOBILE_NATIVE_RECEIVER,
  MOBILE_PROTOCOL_VERSION,
  parseNativeEvent,
  parseReply,
  type Command,
  type CommandParams,
  type CommandResults,
  type Capability,
  type MobileMethod,
  type NativeEvent,
  type Reply,
  type SessionSnapshot,
} from '../../../src/shared/mobile'

export interface BridgeTransport {
  readonly kind: 'native' | 'simulator'
  readonly label: string
  post(command: Command): void
}

export interface BridgeState {
  readonly phase: 'connecting' | 'ready' | 'error'
  readonly transport: BridgeTransport['kind']
  readonly transportLabel: string
  readonly lastSequence: number | null
  readonly resyncCount: number
  readonly session: SessionSnapshot | null
  readonly capabilities: readonly Capability[]
  readonly snapshot: CommandResults['bridge.snapshot'] | null
  readonly error: string | null
}

export class BridgeRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'BridgeRequestError'
  }
}

type Pending = {
  readonly method: MobileMethod
  readonly resolve: (value: unknown) => void
  readonly reject: (reason: unknown) => void
  readonly timeout: ReturnType<typeof setTimeout>
}

declare global {
  interface Window {
    WorkoutAnalyzeNative?: {
      receiveReply(value: unknown): void
      receiveEvent(value: unknown): void
    }
    webkit?: { messageHandlers?: Record<string, { postMessage(value: unknown): void } | undefined> }
  }
}

export const nativeTransport = (): BridgeTransport | null => {
  const handler = window.webkit?.messageHandlers?.[MOBILE_BRIDGE_HANDLER]
  if (!handler) return null
  return { kind: 'native', label: 'Native iPhone shell', post: (command) => handler.postMessage(command) }
}

export const unavailableNativeTransport = (): BridgeTransport => ({
  kind: 'native',
  label: 'Native bridge unavailable',
  post() { throw new BridgeRequestError('The native iPhone bridge is not installed', 'bridgeUnavailable', true) },
})

export const createBridgeClient = (transport: BridgeTransport, timeoutMs = 8_000) => {
  let counter = 0
  let resyncing: Promise<void> | null = null
  let connecting: Promise<void> | null = null
  let bufferedEvents: NativeEvent[] = []
  let consecutiveResyncFailures = 0
  let lastMalformedEventResyncAt = 0
  const lastInvalidEventReportAt = new Map<string, number>()
  const pending = new Map<string, Pending>()
  const listeners = new Set<(state: BridgeState) => void>()
  const eventListeners = new Set<(event: NativeEvent) => void>()
  let state: BridgeState = {
    phase: 'connecting', transport: transport.kind, transportLabel: transport.label,
    lastSequence: null, resyncCount: 0, session: null, error: null,
    capabilities: [], snapshot: null,
  }

  const publish = (next: Partial<BridgeState>) => {
    state = { ...state, ...next }
    listeners.forEach((listener) => listener(state))
  }

  const reportInvalidEvent = (value: unknown, error: unknown) => {
    const candidate = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
    const eventType = typeof candidate.type === 'string' ? candidate.type : 'unknown'
    const sequence = Number.isSafeInteger(candidate.sequence) ? candidate.sequence as number : null
    const detail = error instanceof Error ? error.message : 'Invalid native event'
    const signature = `${eventType}:${detail}`
    const now = Date.now()
    if (now - (lastInvalidEventReportAt.get(signature) ?? 0) < 10_000) return
    lastInvalidEventReportAt.set(signature, now)
    const event = { id: `web-native-event-${Date.now()}-${counter}`, timestamp: new Date().toISOString(), subsystem: 'web-bridge', level: 'error', message: detail, metadata: { eventType, sequence } }
    void fetch('/__workout/diagnostics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ formatVersion: 1, uploadId: event.id, events: [event] }) }).catch(() => undefined)
  }

  const request = <M extends MobileMethod>(method: M, params: CommandParams[M]): Promise<CommandResults[M]> => {
    counter += 1
    const requestId = `web-${Date.now().toString(36)}-${counter}`
    const command = { protocolVersion: MOBILE_PROTOCOL_VERSION, requestId, method, params } as Command<M>
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(requestId)
        reject(new BridgeRequestError(`${method} timed out`, 'timeout', true))
      }, timeoutMs)
      pending.set(requestId, { method, resolve: (value) => resolve(value as CommandResults[M]), reject, timeout })
      try { transport.post(command as Command) } catch (error) {
        clearTimeout(timeout)
        pending.delete(requestId)
        reject(error)
      }
    })
  }

  const commitEvent = (event: NativeEvent) => {
    const snapshot = state.snapshot ? {
      ...state.snapshot,
      sequence: event.sequence,
      ...(event.type === 'session.updated' ? { session: event.payload as CommandResults['bridge.snapshot']['session'] } : {}),
      ...(event.type === 'permissions.updated' ? { permissions: event.payload as CommandResults['bridge.snapshot']['permissions'] } : {}),
      ...(event.type === 'location.updated' ? { location: event.payload as CommandResults['bridge.snapshot']['location'] } : {}),
      ...(event.type === 'heartRate.updated' ? { heartRate: event.payload as CommandResults['bridge.snapshot']['heartRate'] } : {}),
      ...(event.type === 'diagnostics.updated' ? { diagnostics: event.payload as CommandResults['bridge.snapshot']['diagnostics'] } : {}),
      ...(event.type === 'appBuild.updated' ? { appBuild: event.payload as CommandResults['bridge.snapshot']['appBuild'] } : {}),
    } : null
    publish({ lastSequence: event.sequence, snapshot, session: event.type === 'session.updated' ? event.payload as SessionSnapshot : state.session })
    eventListeners.forEach((listener) => listener(event))
  }

  const applyEvent = (event: NativeEvent) => {
    if (resyncing) { bufferedEvents.push(event); return }
    if (state.lastSequence === null) { bufferedEvents.push(event); return }
    if (event.sequence <= state.lastSequence) return
    if (event.sequence !== state.lastSequence + 1) {
      bufferedEvents.push(event)
      void resync(true)
      return
    }
    commitEvent(event)
  }

  const resync = (countAsGap = false) => {
    if (resyncing) return resyncing
    resyncing = (async () => {
      try {
        if (state.capabilities.includes('bridge.snapshot')) {
          const snapshot = await request('bridge.snapshot', {})
          publish({ phase: 'ready', error: null, snapshot, session: snapshot.session, lastSequence: snapshot.sequence, resyncCount: state.resyncCount + (countAsGap ? 1 : 0) })
        } else {
          const snapshot = await request('session.snapshot', {})
          publish({ phase: 'ready', error: null, session: snapshot, lastSequence: snapshot.durableSequence, resyncCount: state.resyncCount + (countAsGap ? 1 : 0) })
        }
        consecutiveResyncFailures = 0
        const queued = bufferedEvents.sort((a, b) => a.sequence - b.sequence)
        bufferedEvents = []
        for (const event of queued) {
          if (event.sequence <= state.lastSequence!) continue
          if (event.sequence === state.lastSequence! + 1) commitEvent(event)
          else bufferedEvents.push(event)
        }
      } catch (error) {
        consecutiveResyncFailures += 1
        publish({ phase: 'error', error: error instanceof Error ? error.message : 'Snapshot resync failed' })
      } finally {
        resyncing = null
        const arrivedDuringInstall = bufferedEvents.sort((a, b) => a.sequence - b.sequence)
        bufferedEvents = []
        if (consecutiveResyncFailures < 3) arrivedDuringInstall.forEach(applyEvent)
        else bufferedEvents = arrivedDuringInstall.slice(-200)
      }
    })()
    return resyncing
  }

  window[MOBILE_NATIVE_RECEIVER] = {
    receiveReply(value) {
      let envelope: Reply
      try {
        const requestId = typeof value === 'object' && value !== null && 'requestId' in value ? String(value.requestId) : ''
        const item = pending.get(requestId)
        if (!item) return
        envelope = parseReply(item.method, value)
        clearTimeout(item.timeout)
        pending.delete(requestId)
        if (envelope.ok) item.resolve(envelope.result)
        else item.reject(new BridgeRequestError(envelope.error.message, envelope.error.code, envelope.error.retryable))
      } catch (error) {
        const requestId = typeof value === 'object' && value !== null && 'requestId' in value ? String(value.requestId) : ''
        const item = pending.get(requestId)
        if (item) {
          clearTimeout(item.timeout); pending.delete(requestId); item.reject(error)
          if (item.method !== 'bridge.snapshot' && item.method !== 'session.snapshot' && consecutiveResyncFailures < 3) void resync(false)
        }
      }
    },
    receiveEvent(value) {
      try { applyEvent(parseNativeEvent(value)) } catch (error) {
        const detail = error instanceof Error ? error.message : 'Invalid native event'
        publish({ phase: 'error', error: detail })
        reportInvalidEvent(value, error)
        const now = Date.now()
        if (consecutiveResyncFailures < 3 && now - lastMalformedEventResyncAt >= 5_000) {
          lastMalformedEventResyncAt = now
          void resync(true)
        }
      }
    },
  }

  const establishConnection = async () => {
    publish({ phase: 'connecting', error: null })
    try {
      const hello = await request('bridge.hello', { clientName: 'mobile-web', clientVersion: '0.1.0', supportedProtocolVersions: [1] })
      publish({ capabilities: hello.capabilities })
      if (hello.capabilities.includes('bridge.snapshot')) {
        const snapshot = await request('bridge.snapshot', {})
        publish({ phase: 'ready', snapshot, session: snapshot.session, lastSequence: snapshot.sequence, error: null })
      } else {
        const snapshot = await request('session.snapshot', {})
        publish({ phase: 'ready', session: snapshot, lastSequence: snapshot.durableSequence, error: null })
      }
      const queued = bufferedEvents.sort((a, b) => a.sequence - b.sequence)
      bufferedEvents = []
      queued.forEach(applyEvent)
    } catch (error) {
      publish({ phase: 'error', error: error instanceof Error ? error.message : 'Bridge connection failed' })
      throw error
    }
  }

  const connect = () => {
    if (state.phase === 'ready') return Promise.resolve()
    if (connecting) return connecting
    connecting = establishConnection().finally(() => { connecting = null })
    return connecting
  }

  return {
    connect, request, refreshSnapshot: () => resync(false), getState: () => state,
    subscribe(listener: (value: BridgeState) => void) { listeners.add(listener); listener(state); return () => { listeners.delete(listener) } },
    subscribeEvents(listener: (event: NativeEvent) => void) { eventListeners.add(listener); return () => { eventListeners.delete(listener) } },
    dispose() {
      pending.forEach((item) => { clearTimeout(item.timeout); item.reject(new Error('Bridge disposed')) })
      pending.clear(); listeners.clear(); eventListeners.clear()
      if (window[MOBILE_NATIVE_RECEIVER]) delete window[MOBILE_NATIVE_RECEIVER]
    },
  }
}

export type BridgeClient = ReturnType<typeof createBridgeClient>
