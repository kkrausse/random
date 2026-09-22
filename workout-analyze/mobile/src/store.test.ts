import { afterEach, describe, expect, test } from 'bun:test'
import { PHASE1_BASE_CAPABILITIES, type AppBuildStatus, type CommandResults, type MobileMethod, type PermissionStatus } from '../../src/shared/mobile'
import { createBridgeClient, type BridgeClient, type BridgeState } from './bridge/client'
import { createSimulatorTransport } from './bridge/simulator'
import { createMobileStore, loadSavedWorkoutDetail, observationEventSessionId, sourceStateFromDiagnostics } from './store'
import { recommendedDevelopmentUrl } from './config'
import { withBunDuckDbHost } from '../../src/hosts/bun/DuckDbHost'
import { ensureIphoneNormalizationSchema } from '../../src/engine/iphone-normalization'
import type { DatabaseHost, DatabaseValue } from '../../src/engine/database'
import type { SavedArchiveClient } from './archive/client'
import type { RouteDetector } from '../../src/engine/analysis'
import { createParquetExport } from '../../scripts/mobile/local-database'
import { DuckDBInstance } from '@duckdb/node-api'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const browser = globalThis as unknown as { window: Window; document: Document }
const originalFetch = globalThis.fetch
const cleanups: Array<() => void> = []
afterEach(() => { cleanups.splice(0).forEach((cleanup) => cleanup()); globalThis.fetch = originalFetch })

const installDomStubs = () => {
  browser.window = { setTimeout } as unknown as Window
  browser.document = {
    visibilityState: 'visible',
    addEventListener() {},
    removeEventListener() {},
  } as unknown as Document
}

describe('mobile store', () => {
  test('keeps saved-workout import separate from analysis and reports a clean analysis retry lifecycle', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'mobile-analysis-actions-'))
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }))
    await withBunDuckDbHost(join(directory, 'analysis.duckdb'), async (database) => {
      await ensureIphoneNormalizationSchema(database)
      await database.bulkInsert('activities', ['id', 'source', 'source_activity_id', 'sport', 'started_at', 'duration_seconds', 'distance_m', 'ascent_m', 'avg_hr_bpm', 'max_hr_bpm'], [['garmin:existing', 'garmin', 'existing', 'cycling', { type: 'timestamp', value: '2026-09-20T10:00:00.000Z' }, 60, 100, 2, null, null]])
      let archiveLists = 0
      let archiveDetails = 0
      const archive: SavedArchiveClient = {
        label: 'Test archive',
        async list() { archiveLists += 1; return { afterCursor: null, items: [], nextCursor: null, hasMore: false, snapshotAt: '2026-09-21T00:00:00.000Z' } },
        async detail() { archiveDetails += 1; throw new Error('No saved workout should be loaded') },
      }
      let detections = 0
      const detect: RouteDetector = async (_activities, _config, progress) => {
        detections += 1
        progress?.({ phase: 'prepare-paths', completed: 1, total: 1 })
        if (detections === 2) throw new Error('detector test failure')
        return { routes: [], traversals: [], coverages: [] }
      }
      const bridge: BridgeState = { phase: 'ready', transport: 'native', transportLabel: 'Test', lastSequence: 0, resyncCount: 0, session: null, capabilities: [], snapshot: null, error: null }
      const client = { request: (() => Promise.reject(new Error('Unexpected bridge request'))) as BridgeClient['request'], connect: async () => {}, refreshSnapshot: async () => {}, getState: () => bridge, subscribe: () => () => {}, subscribeEvents: () => () => {}, dispose() {} } as BridgeClient
      const times = ['2026-09-21T10:00:00.000Z', '2026-09-21T10:00:02.000Z', '2026-09-21T10:01:00.000Z', '2026-09-21T10:01:03.000Z', '2026-09-21T10:02:00.000Z', '2026-09-21T10:02:04.000Z']
      const store = createMobileStore(client, archive, database, { detectRoutes: detect, now: () => new Date(times.shift()!) })

      await store.getState().loadSavedWorkouts()
      await store.getState().importSavedIphoneWorkouts()
      expect({ archiveLists, archiveDetails, detections }).toEqual({ archiveLists: 1, archiveDetails: 0, detections: 0 })

      await store.getState().rebuildAnalysis()
      const publishedAt = store.getState().analysisSettings?.analyzedAt ?? String((await database.query('SELECT analyzed_at::VARCHAR analyzed_at FROM analysis_settings'))[0]?.analyzed_at)
      expect(store.getState().analysisStatus).toMatchObject({ state: 'completed', phase: 'completed', activities: 1, routes: 0, traversals: 0, durationMs: 2_000 })
      expect({ archiveLists, archiveDetails }).toEqual({ archiveLists: 1, archiveDetails: 0 })

      await store.getState().rebuildAnalysis()
      expect(store.getState().analysisStatus).toMatchObject({ state: 'error', phase: 'error', durationMs: 3_000, error: 'detector test failure' })
      expect(String((await database.query('SELECT analyzed_at::VARCHAR analyzed_at FROM analysis_settings'))[0]?.analyzed_at)).toBe(publishedAt)

      await store.getState().rebuildAnalysis()
      expect(store.getState().analysisStatus).toMatchObject({ state: 'completed', phase: 'completed', durationMs: 4_000, error: null })
      expect(detections).toBe(3)
    })
  })

  test('downloads Mac Parquet through native handles without transporting sample rows', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'mobile-mac-import-'))
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }))
    await withBunDuckDbHost(join(directory, 'source.duckdb'), async (database) => {
      await ensureIphoneNormalizationSchema(database)
      await database.bulkInsert('activities', ['id', 'source', 'source_activity_id', 'sport', 'started_at', 'duration_seconds', 'distance_m', 'ascent_m', 'avg_hr_bpm', 'max_hr_bpm'], [['garmin:mac-1', 'garmin', 'mac-1', 'cycling', { type: 'timestamp', value: '2026-09-20T10:00:00.000Z' }, 60, 100, 2, null, null]])
    })
    const source = await DuckDBInstance.create(join(directory, 'source.duckdb'))
    const connection = await source.connect()
    const exported = await createParquetExport(connection)
    connection.closeSync(); source.closeSync()
    cleanups.push(() => rmSync(exported.directory, { recursive: true, force: true }))
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('manifest.json')) return new Response(JSON.stringify(exported.manifest))
      const path = join(exported.directory, url.endsWith('activities.parquet') ? 'activities.parquet' : 'samples.parquet')
      const bytes = readFileSync(path)
      return new Response(bytes, { headers: { 'content-length': String(bytes.byteLength) } })
    }) as unknown as typeof fetch
    await withBunDuckDbHost(join(directory, 'phone.duckdb'), async (database) => {
      const paths = { 'file-activities': join(exported.directory, 'activities.parquet'), 'file-samples': join(exported.directory, 'samples.parquet') }
      const resolveFile = (value: DatabaseValue): DatabaseValue => typeof value === 'object' && value?.type === 'hostFile' ? paths[value.id as keyof typeof paths] : value
      const adapted = (host: DatabaseHost): DatabaseHost => ({
        execute: (sql, parameters = []) => host.execute(sql, parameters.map(resolveFile)),
        query: (sql, parameters = []) => host.query(sql, parameters.map(resolveFile)),
        bulkInsert: (table, columns, rows) => host.bulkInsert(table, columns, rows),
        transaction: (run) => host.transaction((transaction) => run(adapted(transaction))),
      })
      const bridge: BridgeState = { phase: 'ready', transport: 'native', transportLabel: 'Test', lastSequence: 0, resyncCount: 0, session: null, capabilities: ['file.create', 'file.write', 'file.finalize'], snapshot: null, error: null }
      const offsets: Record<string, number> = {}
      const request = (async (method: string, params: { name?: string; fileId?: string; offset?: number; dataBase64?: string }) => {
        if (method === 'file.create') { const fileId = params.name === 'activities.parquet' ? 'file-activities' : 'file-samples'; offsets[fileId] = 0; return { fileId, name: params.name, sizeBytes: exported.manifest.files.find((file) => file.path === params.name)!.sizeBytes } }
        if (method === 'file.write') { const size = atob(params.dataBase64!).length; offsets[params.fileId!] = params.offset! + size; return { nextOffset: offsets[params.fileId!], sizeBytes: exported.manifest.files.find((file) => params.fileId!.includes(file.role))!.sizeBytes } }
        if (method === 'file.finalize') { const file = exported.manifest.files.find((candidate) => params.fileId!.includes(candidate.role))!; return { finalized: true, sizeBytes: file.sizeBytes, sha256: file.sha256 } }
        if (method === 'file.close') return { closed: true }
        throw new Error(`Unexpected ${method}`)
      }) as BridgeClient['request']
      const client = { request, connect: async () => {}, refreshSnapshot: async () => {}, getState: () => bridge, subscribe: () => () => {}, subscribeEvents: () => () => {}, dispose() {} } as BridgeClient
      const store = createMobileStore(client, undefined, adapted(database))
      store.getState().setMacArchiveSourceDraft('https://mac.example.test:8443/')

      await store.getState().importCanonicalArchiveFromMac()

      expect(store.getState().archiveImport).toMatchObject({ inserted: 1, unchanged: 0, conflicts: [] })
      expect(store.getState().libraryWorkouts.map((workout) => workout.id)).toContain('garmin:mac-1')
      expect(Number((await database.query('SELECT count(*) count FROM activities'))[0]?.count)).toBe(1)
    })
  })

  test('loads every archive detail page before presenting a saved route', async () => {
    const calls: Array<number | null> = []
    const items = Array.from({ length: 450 }, (_, index) => ({ kind: 'transition', sequence: index + 1 }))
    const summary = { savedWorkoutId: 'saved-long', sessionId: 'ride-long', sport: 'cycling', startedAt: '2026-09-20T00:00:00Z', finishedAt: '2026-09-20T01:00:00Z', durationMs: 3_600_000, observationCount: 450, latestSequence: 450, metrics: {}, hasFatalIssue: false }
    const client = { request: (async (_method: string, params: { afterSequence: number | null; limit: number }) => {
      calls.push(params.afterSequence)
      const pageItems = items.filter((item) => item.sequence > (params.afterSequence ?? 0)).slice(0, params.limit)
      const nextSequence = pageItems.at(-1)?.sequence ?? params.afterSequence
      return { summary, pinnedEngine: { buildId: 'engine', apiVersion: 1, checkpointSchemaVersion: 1 }, recordingFormatVersion: 1, units: 'SI', derivation: { algorithmId: 'engine', engineBuildId: 'engine', configId: 'default', firstInputSequence: 1, lastInputSequence: 450 }, observations: { afterSequence: params.afterSequence, items: pageItems, nextSequence, oldestAvailableSequence: 1, latestDurableSequence: 450, hasMore: (nextSequence ?? 0) < 450, droppedBeforeSequence: false } }
    }) as BridgeClient['request'] }

    const detail = await loadSavedWorkoutDetail(client, 'saved-long')

    expect(calls).toEqual([null, 200, 400])
    expect(detail.observations.items).toHaveLength(450)
    expect(detail.observations.items.at(-1)?.sequence).toBe(450)
  })

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
