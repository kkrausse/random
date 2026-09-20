import { createStore, type StoreApi } from 'zustand/vanilla'
import type {
  AppBuildStatus, DiagnosticCheckResult, DiagnosticSnapshot, HeartRateMeasurement,
  HeartRateStatus, LocationObservation, LocationProbeStatus, PermissionStatus,
} from '../../src/shared/mobile'
import type { BridgeClient, BridgeState } from './bridge/client'

export type Screen = 'settings' | 'diagnostics'
export type RequestState = { readonly status: 'pending' | 'success' | 'error'; readonly error: string | null }
type NoticeArea = 'diagnostics' | 'sensors' | 'settings'
export interface UiSourceState {
  readonly configured: { readonly kind: 'development'; readonly url: string } | { readonly kind: 'bundled' | 'installed'; readonly buildId: string }
  readonly targetUrl: string | null
  readonly loadedUrl: string | null
  readonly loadState: 'notLoaded' | 'navigating' | 'awaitingHello' | 'ready' | 'failed'
  readonly currentFailure: string | null
  readonly lastFailureHistory: string | null
  readonly generation: number
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const nullableString = (value: unknown): value is string | null => value === null || typeof value === 'string'
export const sourceStateFromDiagnostics = (diagnostics: DiagnosticSnapshot): UiSourceState | null => {
  const raw = diagnostics.rows.find((row) => row.id === 'webBuild')?.details.uiSource
  if (!record(raw) || !record(raw.configured) || !nullableString(raw.targetUrl) || !nullableString(raw.loadedUrl) || !nullableString(raw.currentFailure) || !nullableString(raw.lastFailureHistory) || !Number.isSafeInteger(raw.generation)) return null
  if (!['notLoaded', 'navigating', 'awaitingHello', 'ready', 'failed'].includes(raw.loadState as string)) return null
  const configured = raw.configured.kind === 'development' && typeof raw.configured.url === 'string'
    ? { kind: 'development' as const, url: raw.configured.url }
    : (raw.configured.kind === 'bundled' || raw.configured.kind === 'installed') && typeof raw.configured.buildId === 'string'
      ? { kind: raw.configured.kind as 'bundled' | 'installed', buildId: raw.configured.buildId }
      : null
  if (!configured) return null
  return { configured, targetUrl: raw.targetUrl, loadedUrl: raw.loadedUrl, loadState: raw.loadState as UiSourceState['loadState'], currentFailure: raw.currentFailure, lastFailureHistory: raw.lastFailureHistory, generation: raw.generation as number }
}

export interface MobileState {
  readonly screen: Screen
  readonly bridge: BridgeState
  readonly permissions: PermissionStatus | null
  readonly builds: AppBuildStatus | null
  readonly diagnostics: DiagnosticSnapshot | null
  readonly checks: readonly DiagnosticCheckResult[]
  readonly location: LocationProbeStatus | null
  readonly heartRate: HeartRateStatus | null
  readonly locations: readonly LocationObservation[]
  readonly measurements: readonly HeartRateMeasurement[]
  readonly requests: Readonly<Record<string, RequestState>>
  readonly notices: Readonly<Record<NoticeArea, string | null>>
  readonly developmentSourceDraft: string
  readonly developmentSourceDirty: boolean
  readonly configuredDevelopmentSourceUrl: string | null | undefined
  readonly uiSource: UiSourceState | null
  start(): () => void
  refresh(): Promise<void>
  setScreen(screen: Screen): void
  setDevelopmentSourceDraft(url: string): void
  requestPermission(permission: 'locationWhenInUse' | 'bluetooth'): Promise<void>
  startLocation(backgroundMode: 'foregroundOnly' | 'continueWhenBackgrounded'): Promise<void>
  stopLocation(): Promise<void>
  readLocations(): Promise<void>
  scanHeartRate(): Promise<void>
  stopHeartRateScan(): Promise<void>
  connectHeartRate(deviceId: string): Promise<void>
  disconnectHeartRate(): Promise<void>
  readHeartRate(): Promise<void>
  runChecks(): Promise<void>
  exportDiagnostics(): Promise<void>
  reload(): Promise<void>
  configureDevelopmentSource(url: string): Promise<void>
  installBuild(manifestUrl: string): Promise<void>
  rollback(target: 'previous' | 'bundled'): Promise<void>
}

const message = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback

export const createMobileStore = (client: BridgeClient): StoreApi<MobileState> => {
  let started = false
  let pollGeneration = 0
  let stopBridgeSubscription: (() => void) | null = null
  let timer: ReturnType<typeof setInterval> | null = null

  const store = createStore<MobileState>((set, get) => {
    const projectBridge = (bridge: BridgeState) => {
      const snapshot = bridge.snapshot
      set((state) => {
        if (!snapshot) return { bridge }
        const uiSource = sourceStateFromDiagnostics(snapshot.diagnostics)
        const configuredDevelopmentSourceUrl = uiSource?.configured.kind === 'development' ? uiSource.configured.url : uiSource ? null : state.configuredDevelopmentSourceUrl
        return {
          bridge, permissions: snapshot.permissions, builds: snapshot.appBuild, diagnostics: snapshot.diagnostics,
          location: snapshot.location, heartRate: snapshot.heartRate, uiSource, configuredDevelopmentSourceUrl,
          ...(!state.developmentSourceDirty && configuredDevelopmentSourceUrl ? { developmentSourceDraft: configuredDevelopmentSourceUrl } : {}),
        }
      })
    }

    const setNotice = (area: NoticeArea, value: string | null) => set((state) => ({ notices: { ...state.notices, [area]: value } }))
    const run = async (key: string, area: NoticeArea, operation: () => Promise<void>) => {
      set((state) => ({ requests: { ...state.requests, [key]: { status: 'pending', error: null } } }))
      setNotice(area, null)
      try {
        await operation()
        set((state) => ({ requests: { ...state.requests, [key]: { status: 'success', error: null } } }))
      } catch (error) {
        const detail = message(error, `${key} failed`)
        set((state) => ({ requests: { ...state.requests, [key]: { status: 'error', error: detail } } }))
        setNotice(area, detail)
      }
    }
    const synchronize = async () => { await client.refreshSnapshot() }
    const stopActiveProbes = () => {
      const { location, heartRate } = get()
      if (location?.probeId && ['starting', 'active'].includes(location.state)) void client.request('location.stop', { probeId: location.probeId }).catch(() => undefined)
      if (heartRate?.state === 'scanning') void client.request('heartRate.stopScan', {}).catch(() => undefined)
    }

    return {
      screen: 'diagnostics',
      bridge: client.getState(),
      permissions: null,
      builds: null,
      diagnostics: null,
      checks: [],
      location: null,
      heartRate: null,
      locations: [],
      measurements: [],
      requests: {},
      notices: { diagnostics: null, sensors: null, settings: null },
      developmentSourceDraft: '',
      developmentSourceDirty: false,
      configuredDevelopmentSourceUrl: undefined,
      uiSource: null,
      start() {
        if (started) return () => undefined
        started = true
        stopBridgeSubscription = client.subscribe(projectBridge)
        const onVisibility = () => { if (document.visibilityState === 'visible') void get().refresh() }
        document.addEventListener('visibilitychange', onVisibility)
        timer = setInterval(() => { if (document.visibilityState === 'visible') void get().refresh() }, 10_000)
        void client.connect().then(() => get().refresh()).catch(() => undefined)
        return () => {
          if (!started) return
          started = false
          pollGeneration += 1
          stopActiveProbes()
          stopBridgeSubscription?.(); stopBridgeSubscription = null
          document.removeEventListener('visibilitychange', onVisibility)
          if (timer) clearInterval(timer); timer = null
        }
      },
      async refresh() {
        const bridge = get().bridge
        if (bridge.phase !== 'ready') return
        if (bridge.capabilities.includes('bridge.snapshot')) {
          await synchronize().catch((error) => setNotice('diagnostics', message(error, 'Snapshot refresh failed')))
          return
        }
        const generation = ++pollGeneration
        try {
          const [permissions, builds, diagnostics] = await Promise.all([
            client.request('permissions.status', {}), client.request('appBuild.status', {}), client.request('diagnostics.snapshot', {}),
          ])
          if (generation === pollGeneration) set((state) => {
            const uiSource = sourceStateFromDiagnostics(diagnostics)
            const configuredDevelopmentSourceUrl = uiSource?.configured.kind === 'development' ? uiSource.configured.url : uiSource ? null : state.configuredDevelopmentSourceUrl
            return { permissions, builds, diagnostics, uiSource, configuredDevelopmentSourceUrl, ...(!state.developmentSourceDirty && configuredDevelopmentSourceUrl ? { developmentSourceDraft: configuredDevelopmentSourceUrl } : {}) }
          })
        } catch (error) {
          if (generation === pollGeneration) setNotice('diagnostics', message(error, 'Refresh failed'))
        }
      },
      setScreen(screen) {
        if (get().screen === 'diagnostics' && screen !== 'diagnostics') stopActiveProbes()
        set({ screen })
        if (screen === 'diagnostics') void get().refresh()
      },
      setDevelopmentSourceDraft(developmentSourceDraft) { set({ developmentSourceDraft, developmentSourceDirty: true }) },
      requestPermission(permission) { return run(`permission-${permission}`, 'sensors', async () => { await client.request('permissions.request', { permission }); await synchronize() }) },
      startLocation(backgroundMode) { return run(`location-${backgroundMode}`, 'sensors', async () => { await client.request('location.start', { desiredAccuracy: 'best', distanceFilterM: 0, backgroundMode, maxDurationSeconds: 120 }); await synchronize() }) },
      stopLocation() { return run('location-stop', 'sensors', async () => { const id = get().location?.probeId; if (id) await client.request('location.stop', { probeId: id }); await synchronize() }) },
      readLocations() { return run('location-read', 'sensors', async () => { const id = get().location?.probeId; if (!id) return; const page = await client.request('location.read', { probeId: id, afterCursor: null, limit: 50 }); set({ locations: page.items }); setNotice('sensors', `Read ${page.items.length} retained location observations${page.droppedBeforeCursor ? '; older data was dropped' : ''}.`) }) },
      scanHeartRate() { return run('hr-scan', 'sensors', async () => { await client.request('heartRate.scan', { durationSeconds: 10 }); await synchronize() }) },
      stopHeartRateScan() { return run('hr-stop-scan', 'sensors', async () => { await client.request('heartRate.stopScan', {}); await synchronize() }) },
      connectHeartRate(deviceId) { return run(`hr-connect-${deviceId}`, 'sensors', async () => { await client.request('heartRate.connect', { deviceId }); await synchronize() }) },
      disconnectHeartRate() { return run('hr-disconnect', 'sensors', async () => { const id = get().heartRate?.connectionId; if (id) await client.request('heartRate.disconnect', { connectionId: id }); await synchronize() }) },
      readHeartRate() { return run('hr-read', 'sensors', async () => { const id = get().heartRate?.connectionId; if (!id) return; const page = await client.request('heartRate.read', { connectionId: id, afterCursor: null, limit: 50 }); set({ measurements: page.items }); setNotice('sensors', `Read ${page.items.length} retained heart-rate measurements${page.droppedBeforeCursor ? '; older data was dropped' : ''}.`) }) },
      runChecks() { return run('diagnostics-checks', 'diagnostics', async () => { const result = await client.request('diagnostics.runChecks', { checks: null }); set({ checks: result.results }); setNotice('diagnostics', result.workoutStateUnchanged ? 'Checks finished. Workout state was unchanged.' : null) }) },
      exportDiagnostics() { return run('diagnostics-export', 'diagnostics', async () => { const result = await client.request('diagnostics.export', { includeWorkoutObservations: false }); setNotice('diagnostics', result.presented ? `Native share sheet opened · ${result.exportId}` : 'Native export was prepared but not presented.') }) },
      reload() { return run('ui-reload', 'settings', async () => { await client.request('ui.reload', {}); setNotice('settings', 'Native accepted the UI reload request.') }) },
      configureDevelopmentSource(url) { return run('dev-source', 'settings', async () => {
        const result = await client.request('devSource.configure', { url })
        const configuredDevelopmentSourceUrl = result.source.kind === 'development' ? result.source.url : null
        set({ configuredDevelopmentSourceUrl, developmentSourceDraft: configuredDevelopmentSourceUrl ?? '', developmentSourceDirty: false })
        await client.request('ui.reload', {})
        setNotice('settings', 'Development source configured; reload accepted.')
      }) },
      installBuild(manifestUrl) { return run('install-build', 'settings', async () => { const result = await client.request('appBuild.download', { manifestUrl }); await client.request('appBuild.activate', { buildId: result.build.buildId }); await client.request('ui.reload', {}); setNotice('settings', 'Build verified, activated, and reload accepted.') }) },
      rollback(target) { return run(`rollback-${target}`, 'settings', async () => { await client.request('appBuild.rollback', { target }); await client.request('ui.reload', {}); setNotice('settings', `${target === 'previous' ? 'Previous' : 'Bundled'} build restored; reload accepted.`) }) },
    }
  })
  return store
}

export type MobileStore = ReturnType<typeof createMobileStore>
