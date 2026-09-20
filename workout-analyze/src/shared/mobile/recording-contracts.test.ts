import { describe, expect, test } from 'bun:test'

import { PHASE1_CAPABILITIES, RECORDING_CAPABILITIES } from './contracts'
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
  })

  test('validates bounded durable observation pages and reconnect events', () => {
    expect(parseReply('observations.read', envelope(page)).ok).toBe(true)
    expect(parseNativeEvent({ protocolVersion: 1, sessionId: 'ride-1', sequence: 20, type: 'observations.appended', payload: page }).sequence).toBe(20)
    expect(() => parseReply('observations.read', envelope({ ...page, items: [{ ...location, horizontalAccuracyM: -1 }] }))).toThrow()
    expect(() => parseCommand({ protocolVersion: 1, requestId: 'read-1', method: 'observations.read', params: { sessionId: 'ride-1', afterSequence: 0, limit: 201 } })).toThrow()
  })
})
