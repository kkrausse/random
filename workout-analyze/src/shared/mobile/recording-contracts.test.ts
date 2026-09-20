import { describe, expect, test } from 'bun:test'

import { ARCHIVE_CAPABILITIES, JOURNAL_CAPABILITIES, PHASE1_CAPABILITIES, RECORDING_CAPABILITIES } from './contracts'
import { parseCommand, parseNativeEvent, parseReply } from './validation'

const now = '2026-09-19T12:00:00.000Z'
const metrics = { activeDurationMs: 10_000, elapsedDurationMs: 12_000, distanceM: 80, averageSpeedMps: 8, currentSpeedMps: 9, currentSpeedObservedAt: now, altitudeM: 20, elevationGainM: 4, heartRateBpm: 140, heartRateObservedAt: now, locationQuality: 'good', heartRateQuality: 'live' }
const session = { sessionId: 'ride-1', state: 'recording', revision: 1, durableSequence: 8, recorderAvailability: 'available', recorderUnavailableReason: '', pinnedEngine: { buildId: 'recording-engine-v1', apiVersion: 1, checkpointSchemaVersion: 1 }, capturedAt: now, sport: 'cycling', startedAt: now, finishedAt: null, lastTransitionAt: now, observationSequence: 8, recovery: { required: false, interruptionStartedAt: null, reason: null }, metrics }
const location = { kind: 'location', sessionId: 'ride-1', sequence: 8, source: 'coreLocation', sourceTimestamp: now, receivedAt: now, monotonicTimestampMs: 1_000, latitudeDegrees: 45, longitudeDegrees: -122, horizontalAccuracyM: 5, altitudeM: 20, verticalAccuracyM: 4, speedMps: 9, speedAccuracyMps: 1, courseDegrees: 180, courseAccuracyDegrees: 5, floorLevel: null, isSimulatedBySoftware: false, isProducedByAccessory: false }
const page = { items: [location], nextSequence: 8, oldestAvailableSequence: 1, latestDurableSequence: 8, hasMore: false, droppedBeforeSequence: false }
const envelope = (result: unknown) => ({ protocolVersion: 1, requestId: 'req-1', ok: true, result })

describe('production recording wire contract', () => {
  test('validates revision-guarded idempotent lifecycle commands', () => {
    expect(parseCommand({ protocolVersion: 1, requestId: 'start-1', method: 'workout.start', params: { expectedRevision: 0, sport: 'cycling', startPolicy: 'immediate' } }).method).toBe('workout.start')
    expect(parseCommand({ protocolVersion: 1, requestId: 'pause-1', method: 'workout.pause', params: { sessionId: 'ride-1', expectedRevision: 1 } }).method).toBe('workout.pause')
    expect(() => parseCommand({ protocolVersion: 1, requestId: 'pause-2', method: 'workout.pause', params: { sessionId: 'ride-1', expectedRevision: -1 } })).toThrow()
    expect(parseReply('workout.pause', envelope(session)).ok).toBe(true)
  })

  test('requires recorder capabilities as a complete group', () => {
    const result = { shellVersion: '0.2.0', protocolVersion: 1, engineApiVersion: 1, checkpointSchemaVersion: 1, capabilities: [...PHASE1_CAPABILITIES, ...RECORDING_CAPABILITIES], unavailableCapabilities: [], }
    expect(parseReply('bridge.hello', envelope(result)).ok).toBe(true)
    expect(() => parseReply('bridge.hello', envelope({ ...result, capabilities: result.capabilities.slice(0, -1), unavailableCapabilities: [{ capability: 'workout.recorder', reason: 'Incomplete' }] }))).toThrow()
    expect(parseReply('bridge.hello', envelope({ ...result, capabilities: [...result.capabilities, ...ARCHIVE_CAPABILITIES] })).ok).toBe(true)
    expect(() => parseReply('bridge.hello', envelope({ ...result, capabilities: [...result.capabilities, ARCHIVE_CAPABILITIES[0]] }))).toThrow()
    expect(parseReply('bridge.hello', envelope({ ...result, capabilities: [...result.capabilities, ...JOURNAL_CAPABILITIES] })).ok).toBe(true)
  })

  test('validates bounded durable observation pages and reconnect events', () => {
    expect(parseReply('observations.read', envelope(page)).ok).toBe(true)
    expect(parseNativeEvent({ protocolVersion: 1, sessionId: 'ride-1', sequence: 20, type: 'observations.appended', payload: page }).sequence).toBe(20)
    expect(() => parseReply('observations.read', envelope({ ...page, items: [{ ...location, horizontalAccuracyM: -1 }] }))).toThrow()
    expect(() => parseCommand({ protocolVersion: 1, requestId: 'read-1', method: 'observations.read', params: { sessionId: 'ride-1', afterSequence: 0, limit: 201 } })).toThrow()
  })

  test('reports the recording event type and exact invalid metrics field without payload values', () => {
    expect(() => parseNativeEvent({ protocolVersion: 1, sessionId: null, sequence: 21, type: 'metrics.updated', payload: { ...metrics, activeDurationMs: 13_000 } }))
      .toThrow('invalid native event payload: type=metrics.updated path=$.payload.activeDurationMs>elapsedDurationMs')
  })

  test('preserves duplicate deliveries, raw bytes, provenance, and host lifecycle in durable order', () => {
    const provenance = { origin: 'liveNative', sourceId: 'core-location', monotonicClockId: 'process-42', lineage: null }
    const duplicate = { ...location, sequence: 9, provenance, ellipsoidalAltitudeM: 24 }
    const heartRate = { kind: 'heartRate', sessionId: 'ride-1', sequence: 10, connectionId: 'hr-1', deviceId: 'sensor-1', sourceTimestamp: now, receivedAt: now, monotonicTimestampMs: 1_001, bpm: 140, valueFormat: 'uint8', sensorContact: 'unsupported', energyExpendedKJ: null, rrIntervalsSeconds: [], rawFlags: 0, rawCharacteristicBase64: 'AIw=' }
    const lifecycle = { kind: 'hostLifecycle', sessionId: 'ride-1', sequence: 11, sourceTimestamp: now, receivedAt: now, monotonicTimestampMs: 1_002, event: 'didEnterBackground', applicationState: 'background', protectedDataAvailable: true }
    const rawPage = { items: [location, duplicate, heartRate, lifecycle], nextSequence: 11, oldestAvailableSequence: 1, latestDurableSequence: 11, hasMore: false, droppedBeforeSequence: false }
    expect(parseReply('observations.read', envelope(rawPage)).ok).toBe(true)
    expect(() => parseReply('observations.read', envelope({ ...rawPage, items: [location, { ...duplicate, sequence: 10 }, heartRate, lifecycle] }))).toThrow()
    expect(() => parseReply('observations.read', envelope({ ...rawPage, items: [location, duplicate, { ...heartRate, rawCharacteristicBase64: 'not base64' }, lifecycle] }))).toThrow()
  })

  test('validates snapshot-stable archive discovery and lossless bounded detail pages', () => {
    const finishedSession = { ...session, state: 'finished', finishedAt: now }
    const summary = { savedWorkoutId: 'saved-1', sessionId: 'ride-1', sport: 'cycling', startedAt: now, finishedAt: now, durationMs: 12_000, observationCount: 8, latestSequence: 8, metrics, hasFatalIssue: false }
    const list = { afterCursor: null, items: [summary], nextCursor: null, hasMore: false, snapshotAt: now }
    expect(parseCommand({ protocolVersion: 1, requestId: 'list-1', method: 'archive.list', params: { afterCursor: null, limit: 50 } }).method).toBe('archive.list')
    expect(parseReply('archive.list', envelope(list)).ok).toBe(true)
    const detail = { summary, pinnedEngine: finishedSession.pinnedEngine, recordingFormatVersion: 1, units: 'SI', derivation: { algorithmId: 'ride-metrics-v1', engineBuildId: 'recording-engine-v1', configId: 'recording-v1', firstInputSequence: 1, lastInputSequence: 8 }, observations: { ...page, afterSequence: 7 } }
    expect(parseCommand({ protocolVersion: 1, requestId: 'detail-1', method: 'archive.detail', params: { savedWorkoutId: 'saved-1', afterSequence: 7, limit: 100 } }).method).toBe('archive.detail')
    expect(parseReply('archive.detail', envelope(detail)).ok).toBe(true)
    expect(() => parseReply('archive.detail', envelope({ ...detail, observations: { ...detail.observations, afterSequence: 6 } }))).toThrow()
    expect(() => parseReply('archive.detail', envelope({ ...detail, summary: { ...summary, latestSequence: 9 } }))).toThrow()
  })

  test('round-trips unknown pre-decode journal payloads without interpreting them', () => {
    const provenance = { origin: 'liveNative', sourceId: 'peripheral-1/2A37', monotonicClockId: 'process-42', lineage: null }
    const unknownPayload = { futureFrameworkField: { nested: [1, true, 'unchanged'] }, rejectedByDecoder: true }
    const first = { formatVersion: 1, eventId: 'event-1', sessionId: 'ride-1', journalSequence: 1, kind: 'vendor.futurePacket', sourceTimestamp: null, receivedAt: now, monotonicTimestampMs: 500, provenance, batch: { batchId: 'callback-1', index: 0, size: 2 }, payload: { encoding: 'json', value: unknownPayload } }
    const second = { ...first, eventId: 'event-2', journalSequence: 2, batch: { batchId: 'callback-1', index: 1, size: 2 }, payload: { encoding: 'base64', value: 'AP+A' } }
    const rawPage = { afterJournalSequence: null, items: [first, second], nextJournalSequence: 2, oldestAvailableJournalSequence: 1, latestJournalSequence: 2, hasMore: false, droppedBeforeJournalSequence: false }
    expect(parseCommand({ protocolVersion: 1, requestId: 'journal-1', method: 'journal.read', params: { sessionId: 'ride-1', afterJournalSequence: null, limit: 200 } }).method).toBe('journal.read')
    const reply = parseReply('journal.read', envelope(rawPage))
    expect(reply.ok && reply.result.items[0]!.payload).toEqual({ encoding: 'json', value: unknownPayload })
    expect(() => parseReply('journal.read', envelope({ ...rawPage, items: [first, { ...second, journalSequence: 3 }] }))).toThrow()
    expect(() => parseReply('journal.read', envelope({ ...rawPage, items: [first, { ...second, payload: { encoding: 'base64', value: 'decoded first' } }] }))).toThrow()
  })
})
