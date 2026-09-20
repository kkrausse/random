import { createStore, type StoreApi } from 'zustand/vanilla'
import {
  RECORDING_CAPABILITIES,
  type AppBuildStatus, type AvailableSessionSnapshot, type DiagnosticCheckResult, type DiagnosticSnapshot,
  type HeartRateMeasurement, type HeartRateStatus, type LocationObservation, type LocationProbeStatus,
  type NativeEvent, type PermissionStatus, type RecorderLocationObservation, type RecorderObservation,
  type RecordingIssue, type SavedWorkoutDetail, type SavedWorkoutSummary, type SessionSnapshot,
} from '../../src/shared/mobile'
import type { BridgeClient, BridgeState } from './bridge/client'
import { createReplayController, type ReplayController } from '../../src/replay/controller'
import { createBrowserLocalRecordingSource } from '../../src/replay/source'
import type { ReplaySnapshot } from '../../src/replay/types'

export type Screen = 'home' | 'live' | 'paused' | 'recovery' | 'saved' | 'history' | 'savedDetail' | 'heartRate' | 'settings' | 'diagnostics' | 'replay'
export type RequestState = { readonly status: 'pending' | 'success' | 'error'; readonly error: string | null }
type NoticeArea = 'recording' | 'diagnostics' | 'sensors' | 'settings'
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
      ? { kind: raw.configured.kind as 'bundled' | 'installed', buildId: raw.configured.buildId } : null
  return configured ? { configured, targetUrl: raw.targetUrl, loadedUrl: raw.loadedUrl, loadState: raw.loadState as UiSourceState['loadState'], currentFailure: raw.currentFailure, lastFailureHistory: raw.lastFailureHistory, generation: raw.generation as number } : null
}

export const isAvailableSession = (session: SessionSnapshot | null): session is AvailableSessionSnapshot => session?.recorderAvailability === 'available'
const screenForSession = (session: SessionSnapshot | null): Screen => {
  if (!isAvailableSession(session)) return 'home'
  if (session.state === 'recording') return 'live'
  if (session.state === 'paused') return 'paused'
  if (session.state === 'interrupted') return 'recovery'
  if (session.state === 'finished') return 'saved'
  return 'home'
}
const boundedTrail = (observations: readonly RecorderObservation[]) => {
  const points = observations.filter((item): item is RecorderLocationObservation => item.kind === 'location' && item.horizontalAccuracyM <= 50)
  if (points.length <= 600) return points
  const stride = Math.ceil(points.length / 600)
  return points.filter((_, index) => index % stride === 0 || index === points.length - 1)
}
export const observationEventSessionId = (event: NativeEvent) => event.sessionId ?? (event.payload as import('../../src/shared/mobile').ObservationPage).items[0]?.sessionId ?? null

export interface MobileState {
  readonly screen: Screen
  readonly returnScreen: Screen
  readonly bridge: BridgeState
  readonly session: SessionSnapshot | null
  readonly recorderSupported: boolean
  readonly permissions: PermissionStatus | null
  readonly builds: AppBuildStatus | null
  readonly diagnostics: DiagnosticSnapshot | null
  readonly checks: readonly DiagnosticCheckResult[]
  readonly location: LocationProbeStatus | null
  readonly heartRate: HeartRateStatus | null
  readonly locations: readonly LocationObservation[]
  readonly measurements: readonly HeartRateMeasurement[]
  readonly trail: readonly RecorderLocationObservation[]
  readonly observationCursor: number | null
  readonly rawJournalSequence: number | null
  readonly recordingIssues: readonly RecordingIssue[]
  readonly savedWorkoutId: string | null
  readonly savedWorkouts: readonly SavedWorkoutSummary[]
  readonly savedWorkoutDetail: SavedWorkoutDetail | null
  readonly requests: Readonly<Record<string, RequestState>>
  readonly notices: Readonly<Record<NoticeArea, string | null>>
  readonly developmentSourceDraft: string
  readonly developmentSourceDirty: boolean
  readonly configuredDevelopmentSourceUrl: string | null | undefined
  readonly uiSource: UiSourceState | null
  readonly replay: ReplaySnapshot
  start(): () => void
  refresh(): Promise<void>
  setScreen(screen: Screen): void
  returnFromUtility(): void
  setDevelopmentSourceDraft(url: string): void
  startWorkout(startPolicy: 'immediate' | 'waitForReliableLocation'): Promise<void>
  pauseWorkout(): Promise<void>
  resumeWorkout(): Promise<void>
  finishWorkout(): Promise<void>
  recoverWorkout(action: 'resume' | 'finish'): Promise<void>
  exportWorkout(format: 'workoutBundleV1' | 'gpx'): Promise<void>
  loadSavedWorkouts(): Promise<void>
  openSavedWorkout(savedWorkoutId: string): Promise<void>
  exportSavedWorkout(sessionId: string, format: 'workoutBundleV1' | 'gpx'): Promise<void>
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
  loadLocalReplay(): Promise<void>
  playReplay(): void
  pauseReplay(): void
  setReplaySpeed(speed: number): void
  seekReplay(positionMs: number): Promise<void>
  closeReplay(): void
}

const message = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback

export const createMobileStore = (client: BridgeClient): StoreApi<MobileState> => {
  let started = false
  let pollGeneration = 0
  let observationGeneration = 0
  let subscribedSessionId: string | null = null
  let nativeSubscriptionId: string | null = null
  let stopBridgeSubscription: (() => void) | null = null
  let stopEventSubscription: (() => void) | null = null
  let timer: ReturnType<typeof setInterval> | null = null
  let replayController: ReplayController | null = null
  const initialReplay: ReplaySnapshot = { status: 'idle', metadata: null, checkpoint: null, observations: [], issues: [], metrics: null, positionMs: 0, durationMs: 0, speed: 1, error: null }

  const store = createStore<MobileState>((set, get) => {
    const setNotice = (area: NoticeArea, value: string | null) => set((state) => ({ notices: { ...state.notices, [area]: value } }))
    const run = async (key: string, area: NoticeArea, operation: () => Promise<void>) => {
      if (get().requests[key]?.status === 'pending') return
      set((state) => ({ requests: { ...state.requests, [key]: { status: 'pending', error: null } } }))
      setNotice(area, null)
      try {
        await operation()
        set((state) => ({ requests: { ...state.requests, [key]: { status: 'success', error: null } } }))
      } catch (error) {
        const detail = message(error, `${key} failed`)
        set((state) => ({ requests: { ...state.requests, [key]: { status: 'error', error: detail } } }))
        setNotice(area, detail)
        await client.refreshSnapshot().catch(() => undefined)
      }
    }
    const mergeObservations = (items: readonly RecorderObservation[], latest: number) => set((state) => {
      const bySequence = new Map<number, RecorderObservation>()
      state.trail.forEach((item) => bySequence.set(item.sequence, item))
      items.forEach((item) => bySequence.set(item.sequence, item))
      return { trail: boundedTrail([...bySequence.values()].sort((a, b) => a.sequence - b.sequence)), observationCursor: Math.max(state.observationCursor ?? 0, latest) }
    })
    const readObservationHistory = async (sessionId: string, generation: number, afterSequence: number | null = null) => {
      let cursor = afterSequence
      let pages = 0
      do {
        const page = await client.request('observations.read', { sessionId, afterSequence: cursor, limit: 200 })
        if (generation !== observationGeneration || subscribedSessionId !== sessionId) return
        if (page.droppedBeforeSequence && cursor !== null) {
          set({ trail: [], observationCursor: null })
          cursor = null
          pages += 1
          continue
        }
        mergeObservations(page.items, page.latestDurableSequence)
        cursor = page.nextSequence
        pages += 1
        if (!page.hasMore) return
      } while (pages < 20)
    }
    const attachObservations = async (session: SessionSnapshot | null) => {
      if (!isAvailableSession(session) || !session.sessionId || session.state === 'idle' || !get().recorderSupported) return
      if (subscribedSessionId === session.sessionId) {
        if ((get().observationCursor ?? 0) < session.observationSequence) void readObservationHistory(session.sessionId, observationGeneration, get().observationCursor)
        if (get().bridge.capabilities.includes('journal.read')) void client.request('journal.read', { sessionId: session.sessionId, afterJournalSequence: null, limit: 1 }).then((page) => set({ rawJournalSequence: page.latestJournalSequence })).catch(() => undefined)
        return
      }
      const generation = ++observationGeneration
      const previousSubscription = nativeSubscriptionId
      nativeSubscriptionId = null
      subscribedSessionId = session.sessionId
      set({ trail: [], observationCursor: null, rawJournalSequence: null, recordingIssues: [] })
      if (previousSubscription) await client.request('observations.unsubscribe', { subscriptionId: previousSubscription }).catch(() => undefined)
      try {
        const subscription = await client.request('observations.subscribe', { sessionId: session.sessionId, afterSequence: null, maxBatchSize: 200 })
        if (generation !== observationGeneration) {
          await client.request('observations.unsubscribe', { subscriptionId: subscription.subscriptionId }).catch(() => undefined)
          return
        }
        nativeSubscriptionId = subscription.subscriptionId
        await client.refreshSnapshot()
        await readObservationHistory(session.sessionId, generation)
        if (get().bridge.capabilities.includes('journal.read')) {
          const journal = await client.request('journal.read', { sessionId: session.sessionId, afterJournalSequence: null, limit: 1 })
          if (generation === observationGeneration) set({ rawJournalSequence: journal.latestJournalSequence })
        }
      } catch (error) {
        if (generation === observationGeneration) setNotice('recording', message(error, 'Could not attach to the recorded trail. Recording continues natively.'))
      }
    }
    const installSession = (session: SessionSnapshot, navigate = true) => {
      set((state) => ({ session, ...(navigate && !['settings', 'diagnostics', 'heartRate', 'replay'].includes(state.screen) ? { screen: screenForSession(session) } : {}) }))
      void attachObservations(session)
    }
    const projectBridge = (bridge: BridgeState) => {
      const snapshot = bridge.snapshot
      const recorderSupported = RECORDING_CAPABILITIES.every((capability) => bridge.capabilities.includes(capability))
      set((state) => {
        if (!snapshot) return { bridge, recorderSupported, session: bridge.session }
        const uiSource = sourceStateFromDiagnostics(snapshot.diagnostics)
        const configuredDevelopmentSourceUrl = uiSource?.configured.kind === 'development' ? uiSource.configured.url : uiSource ? null : state.configuredDevelopmentSourceUrl
        return {
          bridge, recorderSupported, session: snapshot.session, permissions: snapshot.permissions, builds: snapshot.appBuild,
          diagnostics: snapshot.diagnostics, location: snapshot.location, heartRate: snapshot.heartRate, uiSource, configuredDevelopmentSourceUrl,
          ...(!state.developmentSourceDirty && configuredDevelopmentSourceUrl ? { developmentSourceDraft: configuredDevelopmentSourceUrl } : {}),
          ...(!['settings', 'diagnostics', 'heartRate', 'history', 'savedDetail', 'replay'].includes(state.screen) && !(snapshot.session.state === 'finished' && state.screen === 'home') ? { screen: screenForSession(snapshot.session) } : {}),
        }
      })
      if (snapshot) void attachObservations(snapshot.session)
    }
    const onEvent = (event: NativeEvent) => {
      if (event.type === 'session.updated') installSession(event.payload as SessionSnapshot)
      if (event.type === 'observations.appended') {
        const page = event.payload as import('../../src/shared/mobile').ObservationPage
        const eventSessionId = observationEventSessionId(event)
        if (eventSessionId === subscribedSessionId) {
          const expected = (get().observationCursor ?? 0) + 1
          const first = page.items[0]?.sequence
          if (first !== undefined && first > expected) void readObservationHistory(eventSessionId, observationGeneration, get().observationCursor)
          else mergeObservations(page.items, page.latestDurableSequence)
        }
      }
      if (event.type === 'recording.issue') set((state) => ({ recordingIssues: [...state.recordingIssues.filter((item) => item.issueId !== (event.payload as RecordingIssue).issueId), event.payload as RecordingIssue].slice(-8) }))
    }
    const synchronize = async () => { await client.refreshSnapshot() }
    const stopActiveProbes = () => {
      const { location, heartRate } = get()
      if (location?.probeId && ['starting', 'active'].includes(location.state)) void client.request('location.stop', { probeId: location.probeId }).catch(() => undefined)
      if (heartRate?.state === 'scanning') void client.request('heartRate.stopScan', {}).catch(() => undefined)
    }
    const currentAvailableSession = () => {
      const session = get().session
      if (!isAvailableSession(session) || !session.sessionId) throw new Error('No active workout session')
      return session
    }

    return {
      screen: 'home', returnScreen: 'home', bridge: client.getState(), session: client.getState().session, recorderSupported: false,
      permissions: null, builds: null, diagnostics: null, checks: [], location: null, heartRate: null, locations: [], measurements: [],
      trail: [], observationCursor: null, rawJournalSequence: null, recordingIssues: [], savedWorkoutId: null, requests: {},
      savedWorkouts: [], savedWorkoutDetail: null, notices: { recording: null, diagnostics: null, sensors: null, settings: null }, developmentSourceDraft: '', developmentSourceDirty: false,
      configuredDevelopmentSourceUrl: undefined, uiSource: null, replay: initialReplay,
      start() {
        if (started) return () => undefined
        started = true
        stopBridgeSubscription = client.subscribe(projectBridge)
        stopEventSubscription = client.subscribeEvents(onEvent)
        const onVisibility = () => { if (document.visibilityState === 'visible') void get().refresh() }
        document.addEventListener('visibilitychange', onVisibility)
        timer = setInterval(() => { if (document.visibilityState === 'visible') void get().refresh() }, 10_000)
        void client.connect().then(async () => { await get().refresh(); if (client.getState().capabilities.includes('archive.list')) await get().loadSavedWorkouts() }).catch(() => undefined)
        return () => {
          if (!started) return
          started = false; pollGeneration += 1; observationGeneration += 1
          if (nativeSubscriptionId) void client.request('observations.unsubscribe', { subscriptionId: nativeSubscriptionId }).catch(() => undefined)
          stopActiveProbes(); stopBridgeSubscription?.(); stopEventSubscription?.(); stopBridgeSubscription = null; stopEventSubscription = null
          document.removeEventListener('visibilitychange', onVisibility)
          if (timer) clearInterval(timer); timer = null; replayController?.dispose(); replayController = null
        }
      },
      async refresh() {
        const bridge = get().bridge
        if (bridge.phase !== 'ready') return
        if (bridge.capabilities.includes('bridge.snapshot')) { await synchronize().catch((error) => setNotice('diagnostics', message(error, 'Snapshot refresh failed'))); return }
        const generation = ++pollGeneration
        try {
          const [permissions, builds, diagnostics] = await Promise.all([client.request('permissions.status', {}), client.request('appBuild.status', {}), client.request('diagnostics.snapshot', {})])
          if (generation === pollGeneration) {
            set((state) => {
              const uiSource = sourceStateFromDiagnostics(diagnostics)
              const configuredDevelopmentSourceUrl = uiSource?.configured.kind === 'development' ? uiSource.configured.url : uiSource ? null : state.configuredDevelopmentSourceUrl
              return { permissions, builds, diagnostics, uiSource, configuredDevelopmentSourceUrl, ...(!state.developmentSourceDirty && configuredDevelopmentSourceUrl ? { developmentSourceDraft: configuredDevelopmentSourceUrl } : {}) }
            })
          }
        } catch (error) { if (generation === pollGeneration) setNotice('diagnostics', message(error, 'Refresh failed')) }
      },
      setScreen(screen) {
        const previous = get().screen
        if (screen !== 'diagnostics' && (previous === 'diagnostics' || get().location?.probeId)) stopActiveProbes()
        set({ screen, ...(['settings', 'diagnostics', 'heartRate'].includes(screen) && !['settings', 'diagnostics', 'heartRate'].includes(previous) ? { returnScreen: previous } : {}) })
        if (screen === 'diagnostics') void get().refresh()
      },
      returnFromUtility() { set((state) => ({ screen: state.returnScreen })) },
      setDevelopmentSourceDraft(developmentSourceDraft) { set({ developmentSourceDraft, developmentSourceDirty: true }) },
      startWorkout(startPolicy) { return run('workout-start', 'recording', async () => { const result = await client.request('workout.start', { expectedRevision: get().session?.revision ?? 0, sport: 'cycling', startPolicy }); set({ savedWorkoutId: null }); installSession(result) }) },
      pauseWorkout() { return run('workout-pause', 'recording', async () => { const session = currentAvailableSession(); installSession(await client.request('workout.pause', { sessionId: session.sessionId!, expectedRevision: session.revision })) }) },
      resumeWorkout() { return run('workout-resume', 'recording', async () => { const session = currentAvailableSession(); installSession(await client.request('workout.resume', { sessionId: session.sessionId!, expectedRevision: session.revision })) }) },
      finishWorkout() { return run('workout-finish', 'recording', async () => { const session = currentAvailableSession(); const result = await client.request('workout.finish', { sessionId: session.sessionId!, expectedRevision: session.revision }); set({ savedWorkoutId: result.savedWorkoutId }); installSession(result.session); if (get().bridge.capabilities.includes('archive.list')) await get().loadSavedWorkouts() }) },
      recoverWorkout(action) { return run(`workout-recover-${action}`, 'recording', async () => { const session = currentAvailableSession(); const result = await client.request('workout.recover', { sessionId: session.sessionId!, expectedRevision: session.revision, action }); if ('session' in result) { set({ savedWorkoutId: result.savedWorkoutId }); installSession(result.session) } else installSession(result) }) },
      exportWorkout(format) { return run(`workout-export-${format}`, 'recording', async () => { const session = currentAvailableSession(); const result = await client.request('workout.export', { sessionId: session.sessionId!, format }); setNotice('recording', result.presented ? `${format === 'gpx' ? 'GPX' : 'Lossless workout bundle'} share sheet opened.` : 'Export was prepared but the share sheet was not presented.') }) },
      loadSavedWorkouts() { return run('archive-list', 'recording', async () => { if (!get().bridge.capabilities.includes('archive.list')) return; const page = await client.request('archive.list', { afterCursor: null, limit: 50 }); set({ savedWorkouts: page.items }) }) },
      openSavedWorkout(savedWorkoutId) { return run('archive-detail', 'recording', async () => { const detail = await client.request('archive.detail', { savedWorkoutId, afterSequence: null, limit: 200 }); set({ savedWorkoutDetail: detail, screen: 'savedDetail' }) }) },
      exportSavedWorkout(sessionId, format) { return run(`archive-export-${format}`, 'recording', async () => { const result = await client.request('workout.export', { sessionId, format }); setNotice('recording', result.presented ? `${format === 'gpx' ? 'GPX' : 'Lossless raw bundle'} share sheet opened.` : 'Export prepared but share sheet was not presented.') }) },
      requestPermission(permission) { return run(`permission-${permission}`, 'sensors', async () => { await client.request('permissions.request', { permission }); await synchronize() }) },
      startLocation(backgroundMode) { return run(`location-${backgroundMode}`, 'sensors', async () => { await client.request('location.start', { desiredAccuracy: 'best', distanceFilterM: 0, backgroundMode, maxDurationSeconds: 120 }); await synchronize() }) },
      stopLocation() { return run('location-stop', 'sensors', async () => { const id = get().location?.probeId; if (id) await client.request('location.stop', { probeId: id }); await synchronize() }) },
      readLocations() { return run('location-read', 'sensors', async () => { const id = get().location?.probeId; if (!id) return; const page = await client.request('location.read', { probeId: id, afterCursor: null, limit: 50 }); set({ locations: page.items }); setNotice('sensors', `Read ${page.items.length} retained location observations${page.droppedBeforeCursor ? '; older data was dropped' : ''}.`) }) },
      scanHeartRate() { return run('hr-scan', 'sensors', async () => { await client.request('heartRate.scan', { durationSeconds: 10 }); await synchronize() }) },
      stopHeartRateScan() { return run('hr-stop-scan', 'sensors', async () => { await client.request('heartRate.stopScan', {}); await synchronize() }) },
      connectHeartRate(deviceId) { return run(`hr-connect-${deviceId}`, 'sensors', async () => { await client.request('heartRate.connect', { deviceId }); await synchronize() }) },
      disconnectHeartRate() { return run('hr-disconnect', 'sensors', async () => { const id = get().heartRate?.connectionId; if (id) await client.request('heartRate.disconnect', { connectionId: id }); await synchronize() }) },
      readHeartRate() { return run('hr-read', 'sensors', async () => { const id = get().heartRate?.connectionId; if (!id) return; const page = await client.request('heartRate.read', { connectionId: id, afterCursor: null, limit: 50 }); set({ measurements: page.items }); setNotice('sensors', `Read ${page.items.length} retained heart-rate measurements${page.droppedBeforeCursor ? '; older data was dropped' : ''}.`) }) },
      runChecks() { return run('diagnostics-checks', 'diagnostics', async () => { const result = await client.request('diagnostics.runChecks', { checks: null }); set({ checks: result.results }); setNotice('diagnostics', 'Checks finished. Workout state was unchanged.') }) },
      exportDiagnostics() { return run('diagnostics-export', 'diagnostics', async () => { const result = await client.request('diagnostics.export', { includeWorkoutObservations: false }); setNotice('diagnostics', result.presented ? `Native share sheet opened · ${result.exportId}` : 'Native export was prepared but not presented.') }) },
      reload() { return run('ui-reload', 'settings', async () => { await client.request('ui.reload', {}); setNotice('settings', 'Native accepted the UI reload request. Recording remains native-owned.') }) },
      configureDevelopmentSource(url) { return run('dev-source', 'settings', async () => { const result = await client.request('devSource.configure', { url }); const configuredDevelopmentSourceUrl = result.source.kind === 'development' ? result.source.url : null; set({ configuredDevelopmentSourceUrl, developmentSourceDraft: configuredDevelopmentSourceUrl ?? '', developmentSourceDirty: false }); await client.request('ui.reload', {}) }) },
      installBuild(manifestUrl) { return run('install-build', 'settings', async () => { const result = await client.request('appBuild.download', { manifestUrl }); await client.request('appBuild.activate', { buildId: result.build.buildId }); await client.request('ui.reload', {}) }) },
      rollback(target) { return run(`rollback-${target}`, 'settings', async () => { await client.request('appBuild.rollback', { target }); await client.request('ui.reload', {}) }) },
      async loadLocalReplay() {
        if (!import.meta.env.DEV) return
        replayController?.dispose()
        const namespace = `replay:${Date.now()}`
        replayController = createReplayController({ source: createBrowserLocalRecordingSource(), namespace, onChange: (replay) => {
          const metadata = replay.metadata
          const metrics = replay.metrics
          const observations = replay.observations
          set((current) => {
            const bySequence = replay.positionMs < current.replay.positionMs || replay.status === 'loading' && replay.positionMs === 0 ? new Map<number, RecorderObservation>() : new Map(current.trail.map((item) => [item.sequence, item] as const))
            observations.forEach((item) => bySequence.set(item.sequence, item))
            const trail = boundedTrail([...bySequence.values()].sort((a, b) => a.sequence - b.sequence))
            const session: AvailableSessionSnapshot | null = metadata && metrics ? {
              recorderAvailability: 'available', recorderUnavailableReason: '', sessionId: `${namespace}:${metadata.sessionId}`, state: replay.checkpoint?.engine.state ?? 'idle', revision: 0,
              durableSequence: replay.checkpoint?.throughJournalSequence ?? 0, capturedAt: new Date(Date.parse(metadata.startedAt) + replay.positionMs).toISOString(),
              pinnedEngine: { buildId: replay.checkpoint?.engine.engineBuildId ?? 'recording-engine-v1', apiVersion: 1, checkpointSchemaVersion: 1 }, sport: 'cycling', startedAt: metadata.startedAt,
              finishedAt: replay.status === 'finished' ? metadata.finishedAt : null, lastTransitionAt: null, observationSequence: replay.checkpoint?.projector.observationSequence ?? 0,
              recovery: { required: false, interruptionStartedAt: null, reason: null }, metrics: { ...metrics, heartRateQuality: metrics.heartRateQuality },
            } : null
            return { replay, screen: 'replay', trail, session: session ?? current.session, rawJournalSequence: replay.checkpoint?.throughJournalSequence ?? null, observationCursor: replay.checkpoint?.projector.observationSequence ?? null }
          })
        } })
        await replayController.load()
      },
      playReplay() { replayController?.play() },
      pauseReplay() { replayController?.pause() },
      setReplaySpeed(speed) { replayController?.setSpeed(speed) },
      seekReplay(positionMs) { return replayController?.seek(positionMs) ?? Promise.resolve() },
      closeReplay() { replayController?.dispose(); replayController = null; set({ replay: initialReplay, trail: [], session: client.getState().session, rawJournalSequence: null, observationCursor: null, screen: 'home' }) },
    }
  })
  return store
}

export type MobileStore = ReturnType<typeof createMobileStore>
