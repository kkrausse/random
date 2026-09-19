import { afterEach, describe, expect, test } from 'bun:test'
import { PHASE1_BASE_CAPABILITIES, type Command } from '../../../src/shared/mobile'
import { createBridgeClient, unavailableNativeTransport, type BridgeTransport } from './client'
import { createSimulatorTransport } from './simulator'

const session = (sequence: number) => ({ sessionId: null, state: 'idle', revision: 0, durableSequence: sequence, recorderAvailability: 'unavailable', recorderUnavailableReason: 'Phase 1 shell only.', pinnedEngine: null, capturedAt: '2026-09-19T12:00:00Z' })
const hello = { shellVersion: 'test', protocolVersion: 1, engineApiVersion: 1, checkpointSchemaVersion: 1, capabilities: PHASE1_BASE_CAPABILITIES, unavailableCapabilities: [
  { capability: 'workout.recorder', reason: 'Unavailable' }, { capability: 'sensors.location', reason: 'Unavailable' }, { capability: 'sensors.bluetoothHeartRate', reason: 'Unavailable' },
] }

const browser = globalThis as unknown as { window: Window }
const clients: Array<ReturnType<typeof createBridgeClient>> = []
afterEach(() => { clients.splice(0).forEach((client) => client.dispose()) })

const transportWith = (handle: (command: Command) => unknown): BridgeTransport => ({ kind: 'native', label: 'Test native', post(command) { handle(command) } })
const respond = (command: Command, result: unknown) => queueMicrotask(() => browser.window.WorkoutAnalyzeNative?.receiveReply({ protocolVersion: 1, requestId: command.requestId, ok: true, result }))

describe('bridge client', () => {
  test('installs receiver before hello and establishes authoritative snapshot sequence', async () => {
    browser.window = {} as Window
    const methods: string[] = []
    const client = createBridgeClient(transportWith((command) => {
      expect(browser.window.WorkoutAnalyzeNative).toBeDefined()
      methods.push(command.method)
      respond(command, command.method === 'bridge.hello' ? hello : session(7))
    }), 100)
    clients.push(client)
    await client.connect()
    expect(methods).toEqual(['bridge.hello', 'session.snapshot'])
    expect(client.getState()).toMatchObject({ phase: 'ready', lastSequence: 7, resyncCount: 0 })
  })

  test('detects an event gap and resnapshots before applying queued events', async () => {
    browser.window = {} as Window
    let snapshotSequence = 3
    const client = createBridgeClient(transportWith((command) => respond(command, command.method === 'bridge.hello' ? hello : session(snapshotSequence))), 100)
    clients.push(client)
    await client.connect()
    snapshotSequence = 4
    browser.window.WorkoutAnalyzeNative?.receiveEvent({ protocolVersion: 1, sessionId: null, sequence: 5, type: 'session.updated', payload: session(5) })
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(client.getState()).toMatchObject({ lastSequence: 5, resyncCount: 1 })
  })

  test('buffers events that race an in-flight resnapshot without regressing or stranding them', async () => {
    browser.window = { setTimeout } as unknown as Window
    const client = createBridgeClient(createSimulatorTransport(), 200)
    clients.push(client)
    await client.connect()
    browser.window.WorkoutAnalyzeNative?.receiveEvent({ protocolVersion: 1, sessionId: null, sequence: 6, type: 'session.updated', payload: session(6) })
    browser.window.WorkoutAnalyzeNative?.receiveEvent({ protocolVersion: 1, sessionId: null, sequence: 5, type: 'session.updated', payload: session(5) })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(client.getState()).toMatchObject({ lastSequence: 6, session: { durableSequence: 6 }, resyncCount: 1 })
  })

  test('fails closed instead of supplying simulator data when a native page has no bridge', () => {
    const transport = unavailableNativeTransport()
    expect(transport).toMatchObject({ kind: 'native', label: 'Native bridge unavailable' })
    expect(() => transport.post({ protocolVersion: 1, requestId: 'web-1', method: 'bridge.ping', params: { nonce: 'n-1' } })).toThrow('not installed')
  })

  test('rejects malformed method results instead of trusting native input', async () => {
    browser.window = {} as Window
    const client = createBridgeClient(transportWith((command) => respond(command, { nonce: 42 })), 100)
    clients.push(client)
    await expect(client.request('bridge.ping', { nonce: 'n-1' })).rejects.toThrow('invalid bridge.ping result')
  })

  test('times out unanswered requests', async () => {
    browser.window = {} as Window
    const client = createBridgeClient(transportWith(() => undefined), 5)
    clients.push(client)
    await expect(client.request('bridge.ping', { nonce: 'n-1' })).rejects.toThrow('timed out')
  })

  test('simulator exercises explicit location and heart-rate probe flows with labelled fixture evidence', async () => {
    browser.window = { setTimeout } as unknown as Window
    const transport = createSimulatorTransport()
    const client = createBridgeClient(transport, 200)
    clients.push(client)
    await client.connect()
    expect(transport.label).toContain('simulator')
    expect(client.getState().lastSequence).not.toBeNull()
    expect(client.getState().snapshot?.sequence).toBe(client.getState().lastSequence!)
    expect(client.getState().capabilities).toContain('bridge.snapshot')
    const permission = await client.request('permissions.request', { permission: 'locationWhenInUse' })
    expect(permission.location.details.authorization).toBe('whenInUse')
    const location = await client.request('location.start', { desiredAccuracy: 'best', distanceFilterM: 0, backgroundMode: 'foregroundOnly', maxDurationSeconds: 60 })
    expect(location.latestObservation?.isSimulatedBySoftware).toBe(true)
    const scan = await client.request('heartRate.scan', { durationSeconds: 10 })
    expect(scan.devices).toHaveLength(1)
    const connected = await client.request('heartRate.connect', { deviceId: scan.devices[0]!.deviceId })
    const readings = await client.request('heartRate.read', { connectionId: connected.connectionId!, afterCursor: null, limit: 20 })
    expect(readings.items[0]?.bpm).toBe(142)
  })
})
