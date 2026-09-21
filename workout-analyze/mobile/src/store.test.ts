import { afterEach, describe, expect, test } from 'bun:test'
import { PHASE1_BASE_CAPABILITIES, type AppBuildStatus, type CommandResults, type MobileMethod, type PermissionStatus } from '../../src/shared/mobile'
import { createBridgeClient, type BridgeClient, type BridgeState } from './bridge/client'
import { createSimulatorTransport } from './bridge/simulator'
import { createMobileStore, observationEventSessionId, sourceStateFromDiagnostics } from './store'
import { recommendedDevelopmentUrl } from './config'

const browser = globalThis as unknown as { window: Window; document: Document }
const cleanups: Array<() => void> = []
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))

const installDomStubs = () => {
  browser.window = { setTimeout } as unknown as Window
  browser.document = {
    visibilityState: 'visible',
    addEventListener() {},
    removeEventListener() {},
  } as unknown as Document
}

describe('mobile store', () => {
  test('recovers the recording session identity from native observation pages', () => {
    const item = { kind: 'location' as const, sessionId: 'ride-1', sequence: 2, source: 'coreLocation' as const, sourceTimestamp: '2026-09-20T00:00:00Z', receivedAt: '2026-09-20T00:00:00Z', monotonicTimestampMs: 1, latitudeDegrees: 1, longitudeDegrees: 2, horizontalAccuracyM: 5, altitudeM: null, verticalAccuracyM: null, speedMps: null, speedAccuracyMps: null, courseDegrees: null, courseAccuracyDegrees: null, floorLevel: null, isSimulatedBySoftware: false, isProducedByAccessory: false }
    const event = { protocolVersion: 1 as const, sessionId: null, sequence: 8, type: 'observations.appended' as const, payload: { items: [item], nextSequence: 2, oldestAvailableSequence: 1, latestDurableSequence: 2, hasMore: false, droppedBeforeSequence: false } }
    expect(observationEventSessionId(event)).toBe('ride-1')
  })

  test('projects the authoritative native UI source details without conflating history and current failure', () => {
    const source = sourceStateFromDiagnostics({ capturedAt: '2026-09-20T00:00:00Z', eventSequence: 1, rows: [{
      id: 'webBuild', label: 'Web build', status: 'ok', reason: 'ready', observedAt: '2026-09-20T00:00:00Z', freshness: 'fresh',
      details: { uiSource: { configured: { kind: 'development', url: 'http://100.86.29.19:4317/' }, targetUrl: 'http://100.86.29.19:4317/', loadedUrl: 'http://100.86.29.19:4317/', loadState: 'ready', currentFailure: null, lastFailureHistory: 'old failure', generation: 7 } },
    }] })
    expect(source).toEqual({ configured: { kind: 'development', url: 'http://100.86.29.19:4317/' }, targetUrl: 'http://100.86.29.19:4317/', loadedUrl: 'http://100.86.29.19:4317/', loadState: 'ready', currentFailure: null, lastFailureHistory: 'old failure', generation: 7 })
  })

  test('projects atomic snapshots and owns sensor actions and cleanup', async () => {
    installDomStubs()
    const client = createBridgeClient(createSimulatorTransport(), 250)
    const store = createMobileStore(client)
    cleanups.push(store.getState().start(), () => client.dispose())
    await new Promise((resolve) => setTimeout(resolve, 110))
    expect(store.getState()).toMatchObject({ bridge: { phase: 'ready', lastSequence: 4 }, location: { state: 'inactive' }, heartRate: { state: 'inactive' } })

    await store.getState().requestPermission('locationWhenInUse')
    await store.getState().startLocation('continueWhenBackgrounded')
    expect(store.getState()).toMatchObject({ permissions: { location: { details: { authorization: 'whenInUse' } } }, location: { state: 'active', backgroundDeliveryActive: true } })
    await store.getState().readLocations()
    expect(store.getState().locations[0]?.isSimulatedBySoftware).toBe(true)

    store.getState().setScreen('settings')
    await new Promise((resolve) => setTimeout(resolve, 40))
    await store.getState().refresh()
    expect(store.getState().location?.state).toBe('inactive')
  })

  test('projects validated native events through the bridge subscription', async () => {
    installDomStubs()
    const client = createBridgeClient(createSimulatorTransport(), 250)
    const store = createMobileStore(client)
    cleanups.push(store.getState().start(), () => client.dispose())
    await new Promise((resolve) => setTimeout(resolve, 110))
    const bundled = store.getState().builds!.bundled
    const builds: AppBuildStatus = { active: { buildId: 'event-build', source: 'installed', engineBuildId: 'phase1-engine-v2' }, previous: bundled, bundled, downloaded: [], pendingActivationBuildId: null, lastFailure: null }
    browser.window.WorkoutAnalyzeNative?.receiveEvent({ protocolVersion: 1, sessionId: null, sequence: 5, type: 'appBuild.updated', payload: builds })
    expect(store.getState().builds?.active.buildId).toBe('event-build')
    expect(store.getState().bridge.lastSequence).toBe(5)
  })

  test('runs the raw recorder lifecycle, attaches one bounded trail projection, and saves', async () => {
    installDomStubs()
    const client = createBridgeClient(createSimulatorTransport(), 500)
    const store = createMobileStore(client)
    cleanups.push(store.getState().start(), () => client.dispose())
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(store.getState()).toMatchObject({ recorderSupported: true, screen: 'home', session: { state: 'idle' } })

    await store.getState().requestPermission('locationWhenInUse')
    await store.getState().startWorkout('waitForReliableLocation')
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(store.getState()).toMatchObject({ screen: 'live', session: { sessionId: 'sim-ride-1', state: 'recording', observationSequence: 6 }, observationCursor: 6, rawJournalSequence: 6 })
    expect(store.getState().trail.map((item) => item.sequence)).toEqual([1, 2, 3, 4, 5, 6])

    await store.getState().pauseWorkout()
    expect(store.getState().screen).toBe('paused')
    await store.getState().resumeWorkout()
    expect(store.getState().screen).toBe('live')
    await store.getState().finishWorkout()
    expect(store.getState()).toMatchObject({ screen: 'saved', savedWorkoutId: 'sim-saved-ride-1', session: { state: 'finished' } })
    await store.getState().loadSavedWorkouts()
    expect(store.getState().savedWorkouts[0]).toMatchObject({ savedWorkoutId: 'sim-saved-ride-1', observationCount: 6 })
    await store.getState().openSavedWorkout('sim-saved-ride-1')
    expect(store.getState()).toMatchObject({ screen: 'savedDetail', savedWorkoutDetail: { recordingFormatVersion: 1, units: 'SI', observations: { latestDurableSequence: 6 } } })
  })

  test('gates recording on legacy shells while leaving utilities available', async () => {
    installDomStubs()
    const client = createBridgeClient(createSimulatorTransport('legacy-shell'), 500)
    const store = createMobileStore(client)
    cleanups.push(store.getState().start(), () => client.dispose())
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(store.getState()).toMatchObject({ recorderSupported: false, screen: 'home', session: { recorderAvailability: 'unavailable' } })
    expect(store.getState().bridge.capabilities).not.toContain('workout.start')
  })

  test('keeps the source draft user-owned and only records a validated configure result', async () => {
    installDomStubs()
    const client = createBridgeClient(createSimulatorTransport(), 250)
    const store = createMobileStore(client)
    cleanups.push(() => client.dispose())
    expect(store.getState()).toMatchObject({ developmentSourceDraft: recommendedDevelopmentUrl, developmentSourceDirty: false, configuredDevelopmentSourceUrl: undefined })
    store.getState().setDevelopmentSourceDraft('http://100.86.29.19:4317/')
    expect(store.getState()).toMatchObject({ developmentSourceDraft: 'http://100.86.29.19:4317/', developmentSourceDirty: true })
    await store.getState().configureDevelopmentSource('http://100.86.29.19:4317/')
    expect(store.getState()).toMatchObject({ developmentSourceDraft: 'http://100.86.29.19:4317/', developmentSourceDirty: false, configuredDevelopmentSourceUrl: 'http://100.86.29.19:4317/' })
  })

  test('retries a failed bridge connection through the centralized store action', async () => {
    installDomStubs()
    let attempts = 0
    let bridge: BridgeState = { phase: 'error', transport: 'native', transportLabel: 'Native iPhone shell', lastSequence: null, resyncCount: 0, session: null, capabilities: [], snapshot: null, error: 'bridge.hello timed out' }
    const listeners = new Set<(state: BridgeState) => void>()
    const client = {
      request: (() => Promise.reject(new Error('unexpected request'))) as BridgeClient['request'],
      async connect() { attempts += 1; bridge = { ...bridge, phase: 'ready', error: null }; listeners.forEach((listener) => listener(bridge)) },
      async refreshSnapshot() {},
      getState: () => bridge,
      subscribe(listener: (state: BridgeState) => void) { listeners.add(listener); listener(bridge); return () => listeners.delete(listener) },
      subscribeEvents: () => () => {}, dispose() {},
    } as BridgeClient
    const store = createMobileStore(client)
    cleanups.push(store.getState().start())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(attempts).toBe(1)
    bridge = { ...bridge, phase: 'error', error: 'connection lost' }
    listeners.forEach((listener) => listener(bridge))
    await store.getState().reconnectBridge()
    expect(attempts).toBe(2)
    expect(store.getState()).toMatchObject({ bridge: { phase: 'ready', error: null }, requests: { 'bridge-connect': { status: 'success', error: null } } })
  })

  test('ignores slower legacy poll results after a newer refresh completes', async () => {
    const permission = (authorization: 'notDetermined' | 'denied'): PermissionStatus => ({
      location: { id: 'location', label: 'Location', status: 'waiting', reason: authorization, observedAt: null, freshness: 'never', details: { authorization, precise: null } },
      bluetooth: { id: 'bluetooth', label: 'Bluetooth', status: 'waiting', reason: 'Waiting', observedAt: null, freshness: 'never', details: { authorization: 'notDetermined', power: 'unknown' } },
      promptsAutomatically: false,
    })
    const bundled = { buildId: 'bundled', source: 'bundled' as const, engineBuildId: 'phase1-engine-v1' }
    const builds = (id: string): AppBuildStatus => ({ active: { ...bundled, buildId: id }, previous: null, bundled, downloaded: [], pendingActivationBuildId: null, lastFailure: null })
    const diagnostics = (capturedAt: string): CommandResults['diagnostics.snapshot'] => ({ capturedAt, eventSequence: 0, rows: [] })
    const batches = [
      { permissions: permission('denied'), builds: builds('old'), diagnostics: diagnostics('2026-09-19T12:00:00Z') },
      { permissions: permission('notDetermined'), builds: builds('new'), diagnostics: diagnostics('2026-09-19T12:00:01Z') },
    ]
    const resolvers: Array<() => void> = []
    let call = 0
    const request = ((method: MobileMethod) => {
      const batch = batches[Math.floor(call / 3)]!
      call += 1
      const value = method === 'permissions.status' ? batch.permissions : method === 'appBuild.status' ? batch.builds : batch.diagnostics
      return new Promise((resolve) => resolvers.push(() => resolve(value as never)))
    }) as BridgeClient['request']
    const bridge: BridgeState = { phase: 'ready', transport: 'native', transportLabel: 'Test', lastSequence: 0, resyncCount: 0, session: null, capabilities: PHASE1_BASE_CAPABILITIES, snapshot: null, error: null }
    const client = { request, connect: async () => {}, refreshSnapshot: async () => {}, getState: () => bridge, subscribe: (listener: (state: BridgeState) => void) => { listener(bridge); return () => {} }, subscribeEvents: () => () => {}, dispose() {} } as BridgeClient
    const store = createMobileStore(client)
    const older = store.getState().refresh()
    const newer = store.getState().refresh()
    resolvers.slice(3).forEach((resolve) => resolve())
    await newer
    resolvers.slice(0, 3).forEach((resolve) => resolve())
    await older
    expect(store.getState()).toMatchObject({ builds: { active: { buildId: 'new' } }, diagnostics: { capturedAt: '2026-09-19T12:00:01Z' } })
  })
})
