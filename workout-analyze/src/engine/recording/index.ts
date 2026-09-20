import {
  RECORDING_CHECKPOINT_SCHEMA_VERSION, RECORDING_ENGINE_API_VERSION, RECORDING_ENGINE_MAX_BATCH_SIZE,
  type EngineEvaluationClock, type EngineLocationObservation, type RecordingCheckpoint,
  type RecordingEngineArtifact, type RecordingEngineObservation, type RecordingMetrics,
} from './types'

export * from './types'

const ENGINE_BUILD_ID = 'recording-engine-v1'
const ALGORITHM_ID = 'ride-metrics-v1'
const MAX_HORIZONTAL_ACCURACY_M = 50
const MAX_LOCATION_AGE_MS = 15_000
const MAX_LOCATION_GAP_MS = 30_000
const MAX_IMPLIED_SPEED_MPS = 25
const MAX_SPEED_ACCURACY_MPS = 3
const LOCATION_STALE_MS = 8_000
const HEART_RATE_STALE_MS = 10_000
const MAX_VERTICAL_ACCURACY_M = 10
const ELEVATION_DEADBAND_M = 3

const wallMs = (value: string) => {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new TypeError(`Invalid timestamp: ${value}`)
  return parsed
}
const round = (value: number) => Math.round(value * 1_000) / 1_000
const distance = (a: { latitudeDegrees: number; longitudeDegrees: number }, b: { latitudeDegrees: number; longitudeDegrees: number }) => {
  const radians = Math.PI / 180
  const lat1 = a.latitudeDegrees * radians
  const lat2 = b.latitudeDegrees * radians
  const dLat = (b.latitudeDegrees - a.latitudeDegrees) * radians
  const dLon = (b.longitudeDegrees - a.longitudeDegrees) * radians
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

const initial = (): RecordingCheckpoint => ({
  schemaVersion: 1, engineBuildId: ENGINE_BUILD_ID, algorithmId: ALGORITHM_ID, lastSequence: 0, state: 'idle',
  startedWallMs: null, finishedWallMs: null, activeStartedWallMs: null, activeStartedMonotonicMs: null, accumulatedActiveMs: 0,
  distanceM: 0, elevationGainM: 0, anchor: null, lastLocationWallMs: null, poorLocationWallMs: null, currentSpeedMps: null,
  currentSpeedWallMs: null, altitudeM: null, heartRateBpm: null, heartRateWallMs: null, sawHeartRate: false,
  lastEvaluationWallMs: null,
})

const activeAt = (state: RecordingCheckpoint, clock: EngineEvaluationClock) => {
  if (state.state !== 'recording' || state.activeStartedWallMs === null) return state.accumulatedActiveMs
  const monotonic = state.activeStartedMonotonicMs !== null && clock.monotonicTimestampMs !== null
    ? clock.monotonicTimestampMs - state.activeStartedMonotonicMs : wallMs(clock.wallTimestamp) - state.activeStartedWallMs
  return state.accumulatedActiveMs + Math.max(0, monotonic)
}

const metrics = (state: RecordingCheckpoint, clock: EngineEvaluationClock): RecordingMetrics => {
  const now = wallMs(clock.wallTimestamp)
  const activeDurationMs = Math.round(activeAt(state, clock))
  const elapsedDurationMs = state.startedWallMs === null ? 0 : Math.max(0, (state.finishedWallMs ?? now) - state.startedWallMs)
  const locationFresh = state.lastLocationWallMs !== null && now - state.lastLocationWallMs <= LOCATION_STALE_MS
  const speedFresh = state.currentSpeedWallMs !== null && now - state.currentSpeedWallMs <= LOCATION_STALE_MS
  const hrFresh = state.heartRateWallMs !== null && now - state.heartRateWallMs <= HEART_RATE_STALE_MS
  return {
    activeDurationMs, elapsedDurationMs, distanceM: round(state.distanceM),
    averageSpeedMps: activeDurationMs > 0 ? round(state.distanceM / (activeDurationMs / 1_000)) : null,
    currentSpeedMps: speedFresh ? state.currentSpeedMps : null,
    currentSpeedObservedAt: speedFresh && state.currentSpeedWallMs !== null ? new Date(state.currentSpeedWallMs).toISOString() : null,
    altitudeM: locationFresh ? state.altitudeM : null, elevationGainM: round(state.elevationGainM),
    heartRateBpm: hrFresh ? state.heartRateBpm : null,
    heartRateObservedAt: hrFresh && state.heartRateWallMs !== null ? new Date(state.heartRateWallMs).toISOString() : null,
    locationQuality: state.poorLocationWallMs !== null && now - state.poorLocationWallMs <= LOCATION_STALE_MS && (state.lastLocationWallMs === null || state.poorLocationWallMs >= state.lastLocationWallMs) ? 'poor' : state.lastLocationWallMs === null ? 'waiting' : locationFresh ? 'good' : 'stale',
    heartRateQuality: !state.sawHeartRate ? 'unconfigured' : hrFresh ? 'live' : 'stale',
  }
}

const closeActiveInterval = (state: RecordingCheckpoint, observation: RecordingEngineObservation) => {
  if (state.state !== 'recording' || state.activeStartedWallMs === null) return state.accumulatedActiveMs
  const atWall = observation.kind === 'gap' ? wallMs(observation.startedAt) : wallMs(observation.sourceTimestamp)
  const duration = state.activeStartedMonotonicMs !== null && observation.monotonicTimestampMs !== null
    ? observation.monotonicTimestampMs - state.activeStartedMonotonicMs : atWall - state.activeStartedWallMs
  return state.accumulatedActiveMs + Math.max(0, duration)
}

const applyLocation = (state: RecordingCheckpoint, observation: EngineLocationObservation): RecordingCheckpoint => {
  const measured = wallMs(observation.sourceTimestamp)
  const received = wallMs(observation.receivedAt)
  const unusable = observation.horizontalAccuracyM > MAX_HORIZONTAL_ACCURACY_M || received - measured > MAX_LOCATION_AGE_MS || received < measured
  if (unusable || state.lastLocationWallMs !== null && measured <= state.lastLocationWallMs) return { ...state, anchor: null, poorLocationWallMs: Math.max(measured, received), currentSpeedMps: null, currentSpeedWallMs: null }
  if (state.state !== 'recording') return { ...state, anchor: null, lastLocationWallMs: measured, currentSpeedMps: null, currentSpeedWallMs: null }
  const deltaMs = state.anchor === null ? null : measured - state.anchor.wallMs
  const segmentM = state.anchor === null ? 0 : distance(state.anchor, observation)
  const validSegment = deltaMs !== null && deltaMs > 0 && deltaMs <= MAX_LOCATION_GAP_MS && segmentM / (deltaMs / 1_000) <= MAX_IMPLIED_SPEED_MPS
  const reportedSpeed = observation.speedMps !== null && observation.speedMps >= 0 && (observation.speedAccuracyMps === null || observation.speedAccuracyMps <= MAX_SPEED_ACCURACY_MPS) ? observation.speedMps : null
  const fallbackSpeed = validSegment && deltaMs !== null ? segmentM / (deltaMs / 1_000) : null
  const altitudeUsable = observation.altitudeM !== null && observation.verticalAccuracyM !== null && observation.verticalAccuracyM <= MAX_VERTICAL_ACCURACY_M
  const altitudeGain = validSegment && altitudeUsable && state.anchor?.altitudeM !== null && state.anchor?.altitudeM !== undefined && observation.altitudeM! - state.anchor.altitudeM > ELEVATION_DEADBAND_M ? observation.altitudeM! - state.anchor.altitudeM : 0
  return {
    ...state, distanceM: state.distanceM + (validSegment ? segmentM : 0), elevationGainM: state.elevationGainM + altitudeGain,
    anchor: { latitudeDegrees: observation.latitudeDegrees, longitudeDegrees: observation.longitudeDegrees, wallMs: measured, altitudeM: altitudeUsable ? observation.altitudeM : null },
    lastLocationWallMs: measured, poorLocationWallMs: null, currentSpeedMps: reportedSpeed ?? fallbackSpeed,
    currentSpeedWallMs: reportedSpeed !== null || fallbackSpeed !== null ? measured : null, altitudeM: altitudeUsable ? observation.altitudeM : null,
  }
}

const apply = (state: RecordingCheckpoint, observation: RecordingEngineObservation): RecordingCheckpoint => {
  if (observation.sequence <= state.lastSequence) return state
  if (observation.sequence !== state.lastSequence + 1) throw new RangeError(`Observation sequence gap: expected ${state.lastSequence + 1}, got ${observation.sequence}`)
  let next: RecordingCheckpoint = state
  if (observation.kind === 'location') next = applyLocation(state, observation)
  else if (observation.kind === 'heartRate') next = { ...state, heartRateBpm: observation.bpm, heartRateWallMs: wallMs(observation.sourceTimestamp), sawHeartRate: true }
  else if (observation.kind === 'gap') next = { ...state, accumulatedActiveMs: closeActiveInterval(state, observation), state: state.state === 'recording' ? 'interrupted' : state.state, activeStartedWallMs: null, activeStartedMonotonicMs: null, anchor: null, currentSpeedMps: null, currentSpeedWallMs: null }
  else {
    const at = wallMs(observation.sourceTimestamp)
    const closing = state.state === 'recording' && observation.to !== 'recording'
    next = { ...state, state: observation.to, startedWallMs: state.startedWallMs ?? (observation.to === 'recording' ? at : null), finishedWallMs: observation.to === 'finished' ? at : state.finishedWallMs, accumulatedActiveMs: closing ? closeActiveInterval(state, observation) : state.accumulatedActiveMs, activeStartedWallMs: observation.to === 'recording' ? at : null, activeStartedMonotonicMs: observation.to === 'recording' ? observation.monotonicTimestampMs : null, anchor: observation.to === 'recording' ? state.anchor : null, currentSpeedMps: observation.to === 'recording' ? state.currentSpeedMps : null, currentSpeedWallMs: observation.to === 'recording' ? state.currentSpeedWallMs : null }
  }
  return { ...next, lastSequence: observation.sequence }
}

export const createRecordingEngineArtifact = (): RecordingEngineArtifact => ({
  describe: () => ({ apiVersion: RECORDING_ENGINE_API_VERSION, checkpointSchemaVersion: RECORDING_CHECKPOINT_SCHEMA_VERSION, engineBuildId: ENGINE_BUILD_ID, algorithmId: ALGORITHM_ID, maxBatchSize: RECORDING_ENGINE_MAX_BATCH_SIZE }),
  create: (checkpoint) => {
    if (checkpoint !== null && (checkpoint.schemaVersion !== 1 || checkpoint.engineBuildId !== ENGINE_BUILD_ID || checkpoint.algorithmId !== ALGORITHM_ID)) throw new TypeError('Incompatible recording checkpoint')
    let state = checkpoint ?? initial()
    return {
      processBatch: ({ observations, evaluatedAt }) => {
        if (observations.length > RECORDING_ENGINE_MAX_BATCH_SIZE) throw new RangeError('Recording engine batch too large')
        let processedCount = 0
        for (const observation of observations) { const before = state.lastSequence; state = apply(state, observation); if (state.lastSequence !== before) processedCount += 1 }
        state = { ...state, lastEvaluationWallMs: wallMs(evaluatedAt.wallTimestamp) }
        return { processedCount, lastSequence: state.lastSequence, metrics: metrics(state, evaluatedAt), checkpoint: state }
      },
      checkpoint: () => state,
    }
  },
})
