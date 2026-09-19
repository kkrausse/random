import { afterEach, describe, expect, test } from 'bun:test'
import { PHASE1_BASE_CAPABILITIES, type AppBuildStatus, type CommandResults, type MobileMethod, type PermissionStatus } from '../../src/shared/mobile'
import { createBridgeClient, type BridgeClient, type BridgeState } from './bridge/client'
import { createSimulatorTransport } from './bridge/simulator'
import { createMobileStore } from './store'

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
