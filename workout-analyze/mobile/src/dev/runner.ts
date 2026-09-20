import type { BridgeClient } from '../bridge/client'
import type { MobileStore } from '../store'
import { createDevApp } from './app'

type ClientKind = 'native' | 'simulator' | 'unavailable'
type InstallOptions = { client: BridgeClient; store: MobileStore; kind: ClientKind }
type ClaimedJob = { id: string; code: string; timeoutMs: number }

const route = '/__workout/run'
const maxOutputCharacters = 200_000
const secret = /(?:bearer\s+|authorization["'\s:=]+|password["'\s:=]+|secret["'\s:=]+|token["'\s:=]+)[^\s,"'}]+/gi
const sanitize = (value: string) => value.replace(secret, (match) => `${match.split(/[\s:=]/, 1)[0]}=[REDACTED]`).slice(0, 16_000)
const errorValue = (error: unknown) => error instanceof Error
  ? { name: error.name, message: sanitize(error.message), stack: error.stack ? sanitize(error.stack) : undefined }
  : { name: 'Error', message: sanitize(String(error)) }
const serializable = (value: unknown) => {
  const seen = new WeakSet<object>()
  const text = JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === 'bigint') return `${item}n`
    if (typeof item === 'function') return `[Function ${item.name || 'anonymous'}]`
    if (typeof item === 'object' && item !== null) { if (seen.has(item)) return '[Circular]'; seen.add(item) }
    return item
  })
  if (text === undefined) return String(value)
  if (text.length > maxOutputCharacters) return { truncated: true, preview: text.slice(0, maxOutputCharacters) }
  return JSON.parse(text) as unknown
}

export const createCorrelationId = (webCrypto: Pick<Crypto, 'getRandomValues'> | null | undefined = globalThis.crypto) => {
  try {
    if (webCrypto?.getRandomValues) {
      const bytes = webCrypto.getRandomValues(new Uint8Array(12))
      return `phone-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
    }
  } catch { /* This is a correlation id, not a security token. */ }
  return `phone-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}

export const installDevRunner = ({ client, store, kind }: InstallOptions) => {
  const clientId = sessionStorage.getItem('workout-dev-runner-client') ?? createCorrelationId()
  sessionStorage.setItem('workout-dev-runner-client', clientId)
  let stopped = false
  let activeJob: string | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  const app = createDevApp(store)
  const metadata = () => ({
    clientId, kind, label: client.getState().transportLabel, sourceUrl: window.location.href,
    build: client.getState().snapshot?.appBuild.active.buildId ?? null,
  })
  const post = (path: string, value: unknown, keepalive = false) => fetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value), keepalive,
  })
  const run = async (job: ClaimedJob) => {
    activeJob = job.id
    const logs: unknown[] = []
    const capture = (level: string) => (...values: unknown[]) => {
      if (logs.length < 200) logs.push({ level, values: serializable(values) })
    }
    const scriptConsole = { log: capture('log'), info: capture('info'), warn: capture('warn'), error: capture('error'), debug: capture('debug') }
    const bridge = { request: client.request, getState: client.getState, refreshSnapshot: client.refreshSnapshot }
    const inspect = { bridgeState: client.getState, appState: app.getState }
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...args: string[]) => (...values: unknown[]) => Promise<unknown>
    const startedAt = performance.now()
    let timeout: ReturnType<typeof setTimeout> | null = null
    let timedOut = false
    try {
      const execute = new AsyncFunction('app', 'bridge', 'inspect', 'console', `"use strict";\n${job.code}`)(app, bridge, inspect, scriptConsole)
      const value = await Promise.race([execute, new Promise<never>((_, reject) => { timeout = setTimeout(() => { timedOut = true; reject(new Error(`Script timed out after ${job.timeoutMs} ms; JavaScript side effects may continue because timeout is not cancellation.`)) }, job.timeoutMs) })])
      await post(`${route}/${encodeURIComponent(job.id)}/result`, { clientId, status: 'succeeded', value: serializable(value), logs, durationMs: Math.round(performance.now() - startedAt) })
    } catch (error) {
      await post(`${route}/${encodeURIComponent(job.id)}/result`, { clientId, status: timedOut ? 'timedOut' : 'failed', logs, error: errorValue(error), durationMs: Math.round(performance.now() - startedAt) })
    } finally {
      if (timeout) clearTimeout(timeout)
      activeJob = null
      if (timedOut) stopped = true
    }
  }
  const poll = async () => {
    if (stopped) return
    if (document.visibilityState !== 'visible') { timer = setTimeout(poll, 2_000); return }
    try {
      const response = await post(`${route}/claim`, metadata())
      if (response.ok) {
        const payload = await response.json() as { job: ClaimedJob | null }
        if (payload.job) await run(payload.job)
      }
    } catch { /* A dev-server restart is expected during HMR. */ }
    if (!stopped) timer = setTimeout(poll, 1_500)
  }
  const abandon = () => {
    stopped = true
    if (timer) clearTimeout(timer)
    if (activeJob) void post(`${route}/${encodeURIComponent(activeJob)}/abandon`, { clientId }, true).catch(() => undefined)
  }
  window.addEventListener('pagehide', abandon, { once: true })
  void poll()
  return abandon
}
