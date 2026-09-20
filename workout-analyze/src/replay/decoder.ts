import type { RecordingState } from '../engine/recording'
import type { ObservationProvenance, RawWorkoutEvent, RecorderHeartRateObservation, RecorderLocationObservation, RecorderTransitionObservation } from '../shared/mobile'
import type { RawEventDecoder, RawProjection } from './types'

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const nullableFinite = (value: unknown): value is number | null => value === null || finite(value)
const nullableBoolean = (value: unknown): value is boolean | null => value === null || typeof value === 'boolean'
const iso = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value))
const state = (value: unknown): value is RecordingState => ['idle', 'recording', 'paused', 'finished', 'interrupted'].includes(value as string)

const replayProvenance = (event: RawWorkoutEvent): ObservationProvenance => ({
  origin: 'recordingReplay',
  sourceId: event.provenance.sourceId,
  monotonicClockId: event.provenance.monotonicClockId,
  lineage: { savedWorkoutId: event.sessionId, sessionId: event.sessionId, sequence: event.journalSequence },
  rawEvent: { eventId: event.eventId, journalSequence: event.journalSequence },
})

const issue = (event: RawWorkoutEvent, code: 'unknownEvent' | 'malformedPayload', message: string): RawProjection => ({
  observation: null, engineInput: null,
  issue: { journalSequence: event.journalSequence, eventId: event.eventId, kind: event.kind, code, message },
})

const bytesFromBase64 = (value: unknown): Uint8Array | null => {
  if (typeof value !== 'string') return null
  try {
    const binary = atob(value)
    return Uint8Array.from(binary, (character) => character.charCodeAt(0))
  } catch { return null }
}

const decodeHeartRate = (event: RawWorkoutEvent, payload: Record<string, unknown>): RawProjection => {
  const bytes = bytesFromBase64(payload.rawCharacteristicBase64)
  const sourceTimestamp = iso(event.sourceTimestamp) ? event.sourceTimestamp : iso(payload.receivedAt) ? payload.receivedAt : null
  if (!bytes || bytes.length < 2 || typeof payload.connectionId !== 'string' || typeof payload.deviceId !== 'string' || !sourceTimestamp || !iso(event.receivedAt)) return issue(event, 'malformedPayload', 'Heart-rate delivery is missing bytes, identity, or timestamp.')
  const flags = bytes[0]!
  let offset = 1
  const uint16 = (at: number) => bytes[at]! | bytes[at + 1]! << 8
  const valueFormat = flags & 1 ? 'uint16' as const : 'uint8' as const
  if (offset + (valueFormat === 'uint16' ? 2 : 1) > bytes.length) return issue(event, 'malformedPayload', 'Heart-rate measurement value is truncated.')
  const bpm = valueFormat === 'uint16' ? uint16(offset) : bytes[offset]!
  offset += valueFormat === 'uint16' ? 2 : 1
  const sensorContact = flags & 4 ? flags & 2 ? 'detected' as const : 'notDetected' as const : 'unsupported' as const
  let energyExpendedKJ: number | null = null
  if (flags & 8) {
    if (offset + 2 > bytes.length) return issue(event, 'malformedPayload', 'Heart-rate energy value is truncated.')
    energyExpendedKJ = uint16(offset); offset += 2
  }
  const rrIntervalsSeconds: number[] = []
  if (flags & 16) {
    if ((bytes.length - offset) % 2 !== 0) return issue(event, 'malformedPayload', 'Heart-rate RR interval is truncated.')
    while (offset < bytes.length) { rrIntervalsSeconds.push(uint16(offset) / 1024); offset += 2 }
  } else if (offset !== bytes.length) return issue(event, 'malformedPayload', 'Heart-rate packet has unexpected trailing bytes.')
  const observation: Omit<RecorderHeartRateObservation, 'sequence'> = {
    kind: 'heartRate', sessionId: event.sessionId, connectionId: payload.connectionId, deviceId: payload.deviceId,
    sourceTimestamp, receivedAt: event.receivedAt, monotonicTimestampMs: event.monotonicTimestampMs,
    bpm, valueFormat, sensorContact, energyExpendedKJ, rrIntervalsSeconds, rawFlags: flags,
    rawCharacteristicBase64: payload.rawCharacteristicBase64 as string, provenance: replayProvenance(event),
  }
  return { observation, engineInput: { kind: 'heartRate', sourceTimestamp, monotonicTimestampMs: event.monotonicTimestampMs, bpm }, issue: null }
}

const decodeLocation = (event: RawWorkoutEvent, payload: Record<string, unknown>): RawProjection => {
  const sourceTimestamp = iso(payload.sourceTimestamp) ? payload.sourceTimestamp : event.sourceTimestamp
  const valid = iso(sourceTimestamp) && iso(payload.receivedAt) && finite(payload.latitudeDegrees) && payload.latitudeDegrees >= -90 && payload.latitudeDegrees <= 90 && finite(payload.longitudeDegrees) && payload.longitudeDegrees >= -180 && payload.longitudeDegrees <= 180 && finite(payload.horizontalAccuracyM) && payload.horizontalAccuracyM >= 0 && nullableFinite(payload.altitudeM) && nullableFinite(payload.verticalAccuracyM) && nullableFinite(payload.speedMps) && nullableFinite(payload.speedAccuracyMps) && nullableFinite(payload.courseDegrees) && nullableFinite(payload.courseAccuracyDegrees) && (payload.floorLevel === null || Number.isSafeInteger(payload.floorLevel)) && nullableBoolean(payload.isSimulatedBySoftware) && nullableBoolean(payload.isProducedByAccessory)
  if (!valid) return issue(event, 'malformedPayload', 'Location delivery has invalid or missing fields.')
  const observation: Omit<RecorderLocationObservation, 'sequence'> = {
    kind: 'location', sessionId: event.sessionId, source: 'coreLocation', sourceTimestamp, receivedAt: payload.receivedAt as string,
    monotonicTimestampMs: event.monotonicTimestampMs, latitudeDegrees: payload.latitudeDegrees as number, longitudeDegrees: payload.longitudeDegrees as number,
    horizontalAccuracyM: payload.horizontalAccuracyM as number, altitudeM: payload.altitudeM as number | null, verticalAccuracyM: payload.verticalAccuracyM as number | null,
    speedMps: payload.speedMps as number | null, speedAccuracyMps: payload.speedAccuracyMps as number | null, courseDegrees: payload.courseDegrees as number | null,
    courseAccuracyDegrees: payload.courseAccuracyDegrees as number | null, floorLevel: payload.floorLevel as number | null,
    isSimulatedBySoftware: payload.isSimulatedBySoftware as boolean | null, isProducedByAccessory: payload.isProducedByAccessory as boolean | null,
    ...('ellipsoidalAltitudeM' in payload && nullableFinite(payload.ellipsoidalAltitudeM) ? { ellipsoidalAltitudeM: payload.ellipsoidalAltitudeM } : {}), provenance: replayProvenance(event),
  }
  return { observation, engineInput: { kind: 'location', sourceTimestamp, receivedAt: observation.receivedAt, monotonicTimestampMs: event.monotonicTimestampMs, latitudeDegrees: observation.latitudeDegrees, longitudeDegrees: observation.longitudeDegrees, horizontalAccuracyM: observation.horizontalAccuracyM, altitudeM: observation.altitudeM, verticalAccuracyM: observation.verticalAccuracyM, speedMps: observation.speedMps, speedAccuracyMps: observation.speedAccuracyMps }, issue: null }
}

const decodeTransition = (event: RawWorkoutEvent, payload: Record<string, unknown>): RawProjection => {
  const sourceTimestamp = event.sourceTimestamp ?? event.receivedAt
  const from = event.kind === 'lifecycle.start' ? 'idle' : payload.from
  const to = event.kind === 'lifecycle.start' ? 'recording' : payload.to
  if (!iso(sourceTimestamp) || !state(from) || !state(to)) return issue(event, 'malformedPayload', 'Lifecycle event has invalid state or timestamp.')
  const observation: Omit<RecorderTransitionObservation, 'sequence'> = { kind: 'transition', sessionId: event.sessionId, transitionId: event.eventId, from, to, sourceTimestamp, monotonicTimestampMs: event.monotonicTimestampMs, cause: payload.cause === 'recovery' || payload.cause === 'systemInterruption' ? payload.cause : 'user', receivedAt: event.receivedAt, provenance: replayProvenance(event) }
  return { observation, engineInput: { kind: 'transition', sourceTimestamp, monotonicTimestampMs: event.monotonicTimestampMs, from, to }, issue: null }
}

export const decodeRawWorkoutEvent: RawEventDecoder = (event) => {
  if (event.payload.encoding !== 'json' || !record(event.payload.value)) return issue(event, 'malformedPayload', 'Known event requires an object JSON payload.')
  if (event.kind === 'locationDelivery') return decodeLocation(event, event.payload.value)
  if (event.kind === 'heartRateCharacteristicDelivery') return decodeHeartRate(event, event.payload.value)
  if (event.kind === 'lifecycle.start' || event.kind === 'lifecycle.finished' || event.kind === 'lifecycle.pause' || event.kind === 'lifecycle.resume') return decodeTransition(event, event.payload.value)
  return issue(event, 'unknownEvent', 'No projector is registered for this raw event kind.')
}
