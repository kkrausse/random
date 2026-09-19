import { parseCommand, PHASE1_CAPABILITIES, type AppBuildStatus, type Command, type CommandParams, type DiagnosticSnapshot, type HeartRateStatus, type LocationProbeStatus, type NativeEvent, type PermissionStatus, type SessionSnapshot, type StatusRow } from '../../../src/shared/mobile'
import type { BridgeTransport } from './client'

const now = () => new Date().toISOString()
const row = <T extends Readonly<Record<string, unknown>>>(id: string, label: string, status: 'ok' | 'waiting' | 'unavailable' | 'error', reason: string, details: T): StatusRow<T> => ({ id, label, status, reason, observedAt: status === 'unavailable' ? null : now(), freshness: status === 'unavailable' ? 'never' : 'fresh', details })

export const createSimulatorTransport = (fault: string | null = null): BridgeTransport => {
  let sequence = 4
  const bundled = { buildId: 'bundled-1', source: 'bundled' as const, engineBuildId: 'phase1-engine-v1' }
  let builds: AppBuildStatus = { active: bundled, previous: null, bundled, downloaded: [], pendingActivationBuildId: null, lastFailure: null }
  const session = (): SessionSnapshot => ({ sessionId: null, state: 'idle', revision: 0, durableSequence: sequence, recorderAvailability: 'unavailable', recorderUnavailableReason: 'Phase 1 is a shell only; recording is not implemented.', pinnedEngine: null, capturedAt: now() })
  let permissionState: PermissionStatus = {
    location: row('location', 'Location', 'waiting', 'Permission has not been requested; diagnostics never prompts.', { authorization: 'notDetermined' as const, precise: null }),
    bluetooth: row('bluetooth', 'Bluetooth heart rate', 'waiting', 'Permission has not been requested; diagnostics never prompts.', { authorization: 'notDetermined' as const, power: 'unknown' as const }),
    promptsAutomatically: false,
  }
  let locationState: LocationProbeStatus = { availability: 'available', state: 'inactive', reason: 'Simulator location fixture is idle.', probeId: null, startedAt: null, expiresAt: null, backgroundMode: null, backgroundDeliveryActive: false, appLifecycle: 'active', receivedCount: 0, acceptedCount: 0, rejectedCount: 0, lastRejectionReason: null, retainedCount: 0, oldestCursor: null, latestCursor: null, latestObservation: null, lastError: null }
  const monitor = { deviceId: 'sim-hr-strap', name: 'Simulator HR Strap', rssi: -48, lastSeenAt: now(), isConnectable: true, advertisedServiceUuids: ['180D'] }
  let heartRateState: HeartRateStatus = { availability: 'available', state: 'inactive', reason: 'Simulator Bluetooth fixture is idle.', scanEndsAt: null, devices: [], connectionId: null, connectedDevice: null, backgroundModeConfigured: true, appLifecycle: 'active', receivedCount: 0, parseErrorCount: 0, reconnectCount: 0, retainedCount: 0, oldestCursor: null, latestCursor: null, latestMeasurement: null, lastError: null }
  const diagnostics = (): DiagnosticSnapshot => ({ capturedAt: now(), eventSequence: sequence, rows: [
    row('bridge', 'Native bridge', fault === 'bridge-error' ? 'error' : 'ok', fault === 'bridge-error' ? 'Injected simulator validation fault.' : 'Round trips are responding.', { latencyMs: 7 }),
    row('location', 'Location service', locationState.state === 'active' ? 'ok' : 'waiting', locationState.reason, {}),
    row('heart-rate', 'Heart-rate sensor', heartRateState.state === 'connected' ? 'ok' : 'waiting', heartRateState.reason, {}),
    row('recorder', 'Workout recorder', 'unavailable', 'Recorder is intentionally unavailable in Phase 1.', {}),
    row('storage', 'Diagnostic storage', 'ok', 'Diagnostic namespace is writable.', { namespace: 'diagnostics' }),
    row('engine', 'Analysis engine', 'ok', 'Bundled deterministic engine fixture is compatible.', { buildId: builds.active.engineBuildId }),
  ] })

  const reply = (command: Command, result: unknown) => window.setTimeout(() => window.WorkoutAnalyzeNative?.receiveReply({ protocolVersion: 1, requestId: command.requestId, ok: true, result }), fault === 'timeout' ? 20_000 : 30)
  const emitBuild = () => {
    sequence += 1
    const event: NativeEvent = { protocolVersion: 1, sessionId: null, sequence, type: 'appBuild.updated', payload: builds }
    window.setTimeout(() => window.WorkoutAnalyzeNative?.receiveEvent(event), 10)
  }

  return {
    kind: 'simulator', label: fault ? `Browser simulator · fault: ${fault}` : 'Browser simulator · fixture data',
    post(raw) {
      const command = parseCommand(raw)
      switch (command.method) {
        case 'bridge.hello': reply(command, { shellVersion: 'sim-0.1.0', protocolVersion: 1, engineApiVersion: 1, checkpointSchemaVersion: 1, capabilities: PHASE1_CAPABILITIES, unavailableCapabilities: [{ capability: 'workout.recorder', reason: 'Phase 1 has no production recorder' }] }); break
        case 'bridge.ping': reply(command, { nonce: (command.params as CommandParams['bridge.ping']).nonce, nativeReceivedAt: now(), nativeSentAt: now() }); break
        case 'session.snapshot': reply(command, session()); break
        case 'permissions.status': reply(command, permissionState); break
        case 'permissions.request': {
          const permission = (command.params as CommandParams['permissions.request']).permission
          permissionState = permission === 'locationWhenInUse'
            ? { ...permissionState, location: row('location', 'Location', 'ok', 'Simulator permission fixture granted.', { authorization: 'whenInUse', precise: true }) }
            : { ...permissionState, bluetooth: row('bluetooth', 'Bluetooth heart rate', 'ok', 'Simulator permission fixture granted.', { authorization: 'allowed', power: 'poweredOn' }) }
          reply(command, permissionState); break
        }
        case 'bridge.snapshot': reply(command, { sequence, session: session(), permissions: permissionState, location: locationState, heartRate: heartRateState, diagnostics: diagnostics(), appBuild: builds }); break
        case 'location.status': reply(command, locationState); break
        case 'location.start': {
          const params = command.params as CommandParams['location.start']
          const startedAt = now()
          locationState = { availability: 'available', state: 'active', reason: 'Simulator fixture is emitting software-produced coordinates.', probeId: 'sim-location-1', startedAt, expiresAt: new Date(Date.now() + params.maxDurationSeconds * 1_000).toISOString(), backgroundMode: params.backgroundMode, backgroundDeliveryActive: params.backgroundMode === 'continueWhenBackgrounded', appLifecycle: 'active', receivedCount: 1, acceptedCount: 1, rejectedCount: 0, lastRejectionReason: null, retainedCount: 1, oldestCursor: 1, latestCursor: 1, latestObservation: { cursor: 1, source: 'coreLocation', sourceTimestamp: now(), receivedAt: now(), latitudeDegrees: 37.7749, longitudeDegrees: -122.4194, horizontalAccuracyM: 4.8, altitudeM: 18.2, verticalAccuracyM: 7.1, speedMps: 5.4, speedAccuracyMps: 0.8, courseDegrees: 271, courseAccuracyDegrees: 8, floorLevel: null, isSimulatedBySoftware: true, isProducedByAccessory: false }, lastError: null }
          reply(command, locationState); break
        }
        case 'location.stop': locationState = { ...locationState, state: 'inactive', reason: 'Simulator location fixture stopped.', backgroundDeliveryActive: false }; reply(command, locationState); break
        case 'location.read': reply(command, { items: locationState.latestObservation ? [locationState.latestObservation] : [], nextCursor: locationState.latestCursor, oldestAvailableCursor: locationState.oldestCursor, hasMore: false, droppedBeforeCursor: false }); break
        case 'heartRate.status': reply(command, heartRateState); break
        case 'heartRate.scan': heartRateState = { ...heartRateState, state: 'scanning', reason: 'Simulator scan found one fixture monitor.', scanEndsAt: new Date(Date.now() + 10_000).toISOString(), devices: [{ ...monitor, lastSeenAt: now() }] }; reply(command, heartRateState); break
        case 'heartRate.stopScan': heartRateState = { ...heartRateState, state: 'inactive', reason: 'Simulator scan stopped.', scanEndsAt: null }; reply(command, heartRateState); break
        case 'heartRate.connect': {
          const measurement = { cursor: 1, connectionId: 'sim-connection-1', deviceId: monitor.deviceId, receivedAt: now(), bpm: 142, valueFormat: 'uint8' as const, sensorContact: 'detected' as const, energyExpendedKJ: 12, rrIntervalsSeconds: [0.422], rawFlags: 6 }
          heartRateState = { ...heartRateState, state: 'connected', reason: 'Simulator fixture monitor connected.', scanEndsAt: null, connectionId: measurement.connectionId, connectedDevice: monitor, receivedCount: 1, retainedCount: 1, oldestCursor: 1, latestCursor: 1, latestMeasurement: measurement }
          reply(command, heartRateState); break
        }
        case 'heartRate.disconnect': heartRateState = { ...heartRateState, state: 'inactive', reason: 'Simulator fixture monitor disconnected.', connectionId: null, connectedDevice: null }; reply(command, heartRateState); break
        case 'heartRate.read': reply(command, { items: heartRateState.latestMeasurement ? [heartRateState.latestMeasurement] : [], nextCursor: heartRateState.latestCursor, oldestAvailableCursor: heartRateState.oldestCursor, hasMore: false, droppedBeforeCursor: false }); break
        case 'diagnostics.snapshot': reply(command, diagnostics()); break
        case 'diagnostics.runChecks': reply(command, { workoutStateUnchanged: true, results: ['bridgePing', 'capabilityCompatibility', 'diagnosticStorage', 'engineFixture'].map((id) => ({ id, outcome: id === 'engineFixture' && fault === 'engine-failure' ? 'fail' : 'pass', reason: id === 'engineFixture' && fault === 'engine-failure' ? 'Injected engine fixture failure.' : 'Isolated check passed without changing workout state.', startedAt: now(), finishedAt: now(), namespace: id === 'engineFixture' ? 'engine-fixture' : 'diagnostics' })) }); break
        case 'diagnostics.export': reply(command, { presented: true, exportId: `sim-export-${Date.now()}` }); break
        case 'appBuild.status': reply(command, builds); break
        case 'appBuild.download': {
          const build = { buildId: 'downloaded-2', source: 'installed' as const, engineBuildId: 'phase1-engine-v2' }
          builds = { ...builds, downloaded: [build] }; reply(command, { build, activated: false }); emitBuild(); break
        }
        case 'appBuild.activate': {
          const active = builds.downloaded.find((item) => item.buildId === (command.params as CommandParams['appBuild.activate']).buildId) ?? bundled
          builds = { ...builds, previous: builds.active, active }; reply(command, { active, reloadRequired: true }); emitBuild(); break
        }
        case 'appBuild.rollback': {
          const active = (command.params as CommandParams['appBuild.rollback']).target === 'previous' ? builds.previous ?? bundled : bundled
          builds = { ...builds, previous: builds.active, active }; reply(command, { active, reloadRequired: true }); emitBuild(); break
        }
        case 'devSource.configure': {
          const url = (command.params as CommandParams['devSource.configure']).url
          reply(command, { source: url === null ? { kind: 'bundled' } : { kind: 'development', url }, reloadRequired: true }); break
        }
        case 'ui.reload': reply(command, { accepted: true }); break
      }
    },
  }
}
