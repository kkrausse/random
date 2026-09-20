import { describe, expect, test } from 'bun:test'

import { parseCommand, parseNativeEvent, parseReply } from './validation'

const envelope = (result: unknown) => ({ protocolVersion: 1, requestId: 'req-1', ok: true, result })
const now = '2026-09-19T12:00:00.000Z'

const locationObservation = {
  cursor: 7, source: 'coreLocation', sourceTimestamp: now, receivedAt: now,
  latitudeDegrees: 45.51, longitudeDegrees: -122.67, horizontalAccuracyM: 4.2,
  altitudeM: 31.5, verticalAccuracyM: 6, speedMps: 7.1, speedAccuracyMps: 0.5,
  courseDegrees: 182, courseAccuracyDegrees: 8, floorLevel: null,
  isSimulatedBySoftware: false, isProducedByAccessory: false,
}

const locationStatus = {
  availability: 'available', state: 'active', reason: 'Receiving Core Location updates',
  probeId: 'loc-1', startedAt: now, expiresAt: '2026-09-19T12:05:00.000Z',
  backgroundMode: 'continueWhenBackgrounded', backgroundDeliveryActive: true, appLifecycle: 'active',
  receivedCount: 8, acceptedCount: 7, rejectedCount: 1, lastRejectionReason: 'Negative horizontal accuracy',
  retainedCount: 7, oldestCursor: 1, latestCursor: 7,
  latestObservation: locationObservation, lastError: null,
}

const device = {
  deviceId: 'A0B1C2D3-E4F5-6789-ABCD-EF0123456789', name: 'HR Monitor', rssi: -52,
  lastSeenAt: now, isConnectable: true, advertisedServiceUuids: ['180D'],
}

const measurement = {
  cursor: 3, connectionId: 'hr-1', deviceId: device.deviceId, receivedAt: now,
  bpm: 148, valueFormat: 'uint16', sensorContact: 'detected', energyExpendedKJ: 42,
  rrIntervalsSeconds: [0.8125, 0.80859375], rawFlags: 31,
}

const heartRateStatus = {
  availability: 'available', state: 'connected', reason: 'Heart Rate Measurement notifications active',
  scanEndsAt: null, devices: [device], connectionId: 'hr-1', connectedDevice: device,
  backgroundModeConfigured: true, appLifecycle: 'active', receivedCount: 3, parseErrorCount: 0, reconnectCount: 1, retainedCount: 3,
  oldestCursor: 1, latestCursor: 3, latestMeasurement: measurement, lastError: null,
}

const permissions = {
  location: { id: 'location', label: 'Location', status: 'ok', reason: 'Authorized', observedAt: now, freshness: 'fresh', details: { authorization: 'whenInUse', precise: true } },
  bluetooth: { id: 'bluetooth', label: 'Bluetooth', status: 'ok', reason: 'Powered on', observedAt: now, freshness: 'fresh', details: { authorization: 'allowed', power: 'poweredOn' } },
  promptsAutomatically: false,
}

const atomicSnapshot = {
  sequence: 12,
  session: { sessionId: null, state: 'idle', revision: 0, durableSequence: 12, recorderAvailability: 'unavailable', recorderUnavailableReason: 'No workout recorder', pinnedEngine: null, capturedAt: now },
  permissions,
  location: locationStatus,
  heartRate: heartRateStatus,
  diagnostics: { capturedAt: now, rows: [], eventSequence: 12 },
  appBuild: {
    active: { buildId: 'bundled-1', source: 'bundled', engineBuildId: 'phase1-engine-v1' }, previous: null,
    bundled: { buildId: 'bundled-1', source: 'bundled', engineBuildId: 'phase1-engine-v1' }, downloaded: [],
    pendingActivationBuildId: null, lastFailure: null,
  },
}

describe('phase-1 sensor bridge contract', () => {
  test('accepts explicit bounded sensor commands and rejects unsafe bounds', () => {
    expect(parseCommand({ protocolVersion: 1, requestId: '1', method: 'permissions.request', params: { permission: 'locationWhenInUse' } }).method).toBe('permissions.request')
    expect(parseCommand({ protocolVersion: 1, requestId: '2', method: 'location.start', params: { desiredAccuracy: 'best', distanceFilterM: 0, backgroundMode: 'continueWhenBackgrounded', maxDurationSeconds: 300 } }).method).toBe('location.start')
    expect(parseCommand({ protocolVersion: 1, requestId: '3', method: 'location.read', params: { probeId: 'loc-1', afterCursor: 4, limit: 100 } }).method).toBe('location.read')
    expect(parseCommand({ protocolVersion: 1, requestId: '4', method: 'heartRate.scan', params: { durationSeconds: 10 } }).method).toBe('heartRate.scan')
    expect(parseCommand({ protocolVersion: 1, requestId: '5', method: 'heartRate.read', params: { connectionId: 'hr-1', afterCursor: null, limit: 200 } }).method).toBe('heartRate.read')
    expect(() => parseCommand({ protocolVersion: 1, requestId: '6', method: 'location.start', params: { desiredAccuracy: 'best', distanceFilterM: -1, backgroundMode: 'foregroundOnly', maxDurationSeconds: 300 } })).toThrow()
    expect(() => parseCommand({ protocolVersion: 1, requestId: '7', method: 'heartRate.scan', params: { durationSeconds: 31 } })).toThrow()
    expect(() => parseCommand({ protocolVersion: 1, requestId: '8', method: 'heartRate.read', params: { connectionId: 'hr-1', afterCursor: null, limit: 201 } })).toThrow()
  })

  test('validates rich location observations and bounded cursor pages', () => {
    expect(parseReply('location.status', envelope(locationStatus)).ok).toBe(true)
    expect(parseReply('location.read', envelope({ items: [locationObservation], nextCursor: 7, oldestAvailableCursor: 1, hasMore: false, droppedBeforeCursor: false })).ok).toBe(true)
    expect(() => parseReply('location.status', envelope({ ...locationStatus, latestObservation: { ...locationObservation, latitudeDegrees: 91 } }))).toThrow()
    expect(() => parseReply('location.read', envelope({ items: Array(201).fill(locationObservation), nextCursor: 7, oldestAvailableCursor: 1, hasMore: false, droppedBeforeCursor: false }))).toThrow()
  })

  test('validates BLE devices and the standard 8/16-bit measurement fields', () => {
    expect(parseReply('heartRate.status', envelope(heartRateStatus)).ok).toBe(true)
    expect(parseReply('heartRate.read', envelope({ items: [measurement, { ...measurement, cursor: 4, valueFormat: 'uint8', sensorContact: 'unsupported', energyExpendedKJ: null }], nextCursor: 4, oldestAvailableCursor: 1, hasMore: false, droppedBeforeCursor: false })).ok).toBe(true)
    expect(() => parseReply('heartRate.status', envelope({ ...heartRateStatus, latestMeasurement: { ...measurement, rawFlags: 256 } }))).toThrow()
    expect(() => parseReply('heartRate.status', envelope({ ...heartRateStatus, devices: Array(33).fill(device) }))).toThrow()
  })

  test('accepts the native unnamed-device status through scan, connect, disconnect, and snapshot', () => {
    const unnamed = { ...device, name: '' }
    const scan = { ...heartRateStatus, state: 'scanning', scanEndsAt: now, devices: [unnamed], connectionId: null, connectedDevice: null, receivedCount: 0, reconnectCount: 0, retainedCount: 0, oldestCursor: null, latestCursor: null, latestMeasurement: null }
    const connecting = { ...scan, state: 'connecting', scanEndsAt: null, connectionId: 'hr-1', connectedDevice: unnamed }
    const disconnected = { ...connecting, state: 'inactive', connectedDevice: null }
    expect(parseReply('heartRate.scan', envelope(scan)).ok).toBe(true)
    expect(parseReply('heartRate.connect', envelope(connecting)).ok).toBe(true)
    expect(parseReply('heartRate.disconnect', envelope(disconnected)).ok).toBe(true)
    expect(parseReply('bridge.snapshot', envelope({ ...atomicSnapshot, heartRate: disconnected })).ok).toBe(true)
    expect(parseNativeEvent({ protocolVersion: 1, sessionId: null, sequence: 13, type: 'heartRate.updated', payload: disconnected }).sequence).toBe(13)
  })

  test('reports the exact heart-rate result path without including device data', () => {
    expect(() => parseReply('heartRate.scan', envelope({ ...heartRateStatus, devices: [{ ...device, name: 'x'.repeat(129) }] })))
      .toThrow('invalid heartRate.scan result at $.devices[0].name')
  })

  test('accepts coalesced sensor events but rejects malformed payloads', () => {
    expect(parseNativeEvent({ protocolVersion: 1, sessionId: null, sequence: 9, type: 'location.updated', payload: locationStatus }).sequence).toBe(9)
    expect(parseNativeEvent({ protocolVersion: 1, sessionId: null, sequence: 10, type: 'heartRate.updated', payload: heartRateStatus }).sequence).toBe(10)
    expect(() => parseNativeEvent({ protocolVersion: 1, sessionId: null, sequence: 11, type: 'heartRate.updated', payload: locationStatus })).toThrow()
  })

  test('keeps the bridge event cursor separate from the recorder durable cursor', () => {
    expect(parseReply('bridge.snapshot', envelope(atomicSnapshot)).ok).toBe(true)
    const nativeRecorderPayload = {
      ...atomicSnapshot,
      sequence: 16,
      session: {
        sessionId: null, state: 'idle', revision: 0, durableSequence: 0,
        recorderAvailability: 'available', recorderUnavailableReason: '', pinnedEngine: null, capturedAt: now,
        sport: null, startedAt: null, finishedAt: null, lastTransitionAt: null, observationSequence: 0,
        recovery: { required: false, interruptionStartedAt: null, reason: null },
        metrics: { activeDurationMs: 0, elapsedDurationMs: 0, distanceM: 0, averageSpeedMps: null, currentSpeedMps: null, currentSpeedObservedAt: null, altitudeM: null, elevationGainM: 0, heartRateBpm: null, heartRateObservedAt: null, locationQuality: 'waiting', heartRateQuality: 'unconfigured' },
      },
      diagnostics: { ...atomicSnapshot.diagnostics, eventSequence: 16 },
    }
    expect(parseReply('bridge.snapshot', envelope(nativeRecorderPayload)).ok).toBe(true)
    expect(() => parseReply('bridge.snapshot', envelope({ ...nativeRecorderPayload, diagnostics: { ...nativeRecorderPayload.diagnostics, eventSequence: 15 } }))).toThrow('$.diagnostics.eventSequence')
    expect(() => parseReply('bridge.snapshot', envelope({ ...nativeRecorderPayload, location: { ...nativeRecorderPayload.location, receivedCount: -1 } }))).toThrow('$.location')
  })
})
