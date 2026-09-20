(() => {
  // src/engine/recording/types.ts
  var RECORDING_ENGINE_API_VERSION = 1;
  var RECORDING_CHECKPOINT_SCHEMA_VERSION = 1;
  var RECORDING_ENGINE_MAX_BATCH_SIZE = 1000;

  // src/engine/mobile-artifact.ts
  var RECORDING_ENGINE_BUILD_ID = "recording-engine-v1";
  var RECORDING_ENGINE_ALGORITHM_ID = "ride-metrics-v1";

  // src/engine/recording/index.ts
  var ENGINE_BUILD_ID = RECORDING_ENGINE_BUILD_ID;
  var ALGORITHM_ID = RECORDING_ENGINE_ALGORITHM_ID;
  var MAX_HORIZONTAL_ACCURACY_M = 50;
  var MAX_LOCATION_AGE_MS = 15000;
  var MAX_LOCATION_GAP_MS = 30000;
  var MAX_IMPLIED_SPEED_MPS = 25;
  var MAX_SPEED_ACCURACY_MPS = 3;
  var LOCATION_STALE_MS = 8000;
  var HEART_RATE_STALE_MS = 1e4;
  var MAX_VERTICAL_ACCURACY_M = 10;
  var ELEVATION_DEADBAND_M = 3;
  var wallMs = (value) => {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed))
      throw new TypeError(`Invalid timestamp: ${value}`);
    return parsed;
  };
  var round = (value) => Math.round(value * 1000) / 1000;
  var distance = (a, b) => {
    const radians = Math.PI / 180;
    const lat1 = a.latitudeDegrees * radians;
    const lat2 = b.latitudeDegrees * radians;
    const dLat = (b.latitudeDegrees - a.latitudeDegrees) * radians;
    const dLon = (b.longitudeDegrees - a.longitudeDegrees) * radians;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    const bounded = Math.min(1, Math.max(0, h));
    return 6371000 * 2 * Math.atan2(Math.sqrt(bounded), Math.sqrt(1 - bounded));
  };
  var initial = () => ({
    schemaVersion: 1,
    engineBuildId: ENGINE_BUILD_ID,
    algorithmId: ALGORITHM_ID,
    lastSequence: 0,
    state: "idle",
    startedWallMs: null,
    finishedWallMs: null,
    activeStartedWallMs: null,
    activeStartedMonotonicMs: null,
    accumulatedActiveMs: 0,
    distanceM: 0,
    elevationGainM: 0,
    anchor: null,
    lastLocationWallMs: null,
    poorLocationWallMs: null,
    currentSpeedMps: null,
    currentSpeedWallMs: null,
    altitudeM: null,
    heartRateBpm: null,
    heartRateWallMs: null,
    sawHeartRate: false,
    lastEvaluationWallMs: null
  });
  var activeAt = (state, clock) => {
    if (state.state !== "recording" || state.activeStartedWallMs === null)
      return state.accumulatedActiveMs;
    const monotonic = state.activeStartedMonotonicMs !== null && clock.monotonicTimestampMs !== null ? clock.monotonicTimestampMs - state.activeStartedMonotonicMs : wallMs(clock.wallTimestamp) - state.activeStartedWallMs;
    return state.accumulatedActiveMs + Math.max(0, monotonic);
  };
  var metrics = (state, clock) => {
    const now = wallMs(clock.wallTimestamp);
    const activeDurationMs = Math.round(activeAt(state, clock));
    const elapsedDurationMs = state.startedWallMs === null ? 0 : Math.max(0, (state.finishedWallMs ?? now) - state.startedWallMs);
    const locationFresh = state.lastLocationWallMs !== null && now - state.lastLocationWallMs <= LOCATION_STALE_MS;
    const speedFresh = state.currentSpeedWallMs !== null && now - state.currentSpeedWallMs <= LOCATION_STALE_MS;
    const hrFresh = state.heartRateWallMs !== null && now - state.heartRateWallMs <= HEART_RATE_STALE_MS;
    return {
      activeDurationMs,
      elapsedDurationMs,
      distanceM: round(state.distanceM),
      averageSpeedMps: activeDurationMs > 0 ? round(state.distanceM / (activeDurationMs / 1000)) : null,
      currentSpeedMps: speedFresh ? state.currentSpeedMps : null,
      currentSpeedObservedAt: speedFresh && state.currentSpeedWallMs !== null ? new Date(state.currentSpeedWallMs).toISOString() : null,
      altitudeM: locationFresh ? state.altitudeM : null,
      elevationGainM: round(state.elevationGainM),
      heartRateBpm: hrFresh ? state.heartRateBpm : null,
      heartRateObservedAt: hrFresh && state.heartRateWallMs !== null ? new Date(state.heartRateWallMs).toISOString() : null,
      locationQuality: state.poorLocationWallMs !== null && now - state.poorLocationWallMs <= LOCATION_STALE_MS && (state.lastLocationWallMs === null || state.poorLocationWallMs >= state.lastLocationWallMs) ? "poor" : state.lastLocationWallMs === null ? "waiting" : locationFresh ? "good" : "stale",
      heartRateQuality: !state.sawHeartRate ? "unconfigured" : hrFresh ? "live" : "stale"
    };
  };
  var closeActiveInterval = (state, observation) => {
    if (state.state !== "recording" || state.activeStartedWallMs === null)
      return state.accumulatedActiveMs;
    const atWall = observation.kind === "gap" ? wallMs(observation.startedAt) : wallMs(observation.sourceTimestamp);
    const duration = state.activeStartedMonotonicMs !== null && observation.monotonicTimestampMs !== null ? observation.monotonicTimestampMs - state.activeStartedMonotonicMs : atWall - state.activeStartedWallMs;
    return state.accumulatedActiveMs + Math.max(0, duration);
  };
  var applyLocation = (state, observation) => {
    const measured = wallMs(observation.sourceTimestamp);
    const received = wallMs(observation.receivedAt);
    const unusable = observation.horizontalAccuracyM > MAX_HORIZONTAL_ACCURACY_M || received - measured > MAX_LOCATION_AGE_MS || received < measured;
    if (unusable || state.lastLocationWallMs !== null && measured <= state.lastLocationWallMs)
      return { ...state, anchor: null, poorLocationWallMs: Math.max(measured, received), currentSpeedMps: null, currentSpeedWallMs: null };
    if (state.state !== "recording")
      return { ...state, anchor: null, lastLocationWallMs: measured, currentSpeedMps: null, currentSpeedWallMs: null };
    const deltaMs = state.anchor === null ? null : measured - state.anchor.wallMs;
    const segmentM = state.anchor === null ? 0 : distance(state.anchor, observation);
    const validSegment = deltaMs !== null && deltaMs > 0 && deltaMs <= MAX_LOCATION_GAP_MS && segmentM / (deltaMs / 1000) <= MAX_IMPLIED_SPEED_MPS;
    const reportedSpeed = observation.speedMps !== null && observation.speedMps >= 0 && (observation.speedAccuracyMps === null || observation.speedAccuracyMps <= MAX_SPEED_ACCURACY_MPS) ? observation.speedMps : null;
    const fallbackSpeed = validSegment && deltaMs !== null ? segmentM / (deltaMs / 1000) : null;
    const altitudeUsable = observation.altitudeM !== null && observation.verticalAccuracyM !== null && observation.verticalAccuracyM <= MAX_VERTICAL_ACCURACY_M;
    const altitudeDelta = validSegment && altitudeUsable && state.anchor?.altitudeM !== null && state.anchor?.altitudeM !== undefined ? observation.altitudeM - state.anchor.altitudeM : null;
    const altitudeGain = altitudeDelta !== null && altitudeDelta > ELEVATION_DEADBAND_M ? altitudeDelta : 0;
    const altitudeAnchor = !altitudeUsable ? null : altitudeDelta !== null && altitudeDelta > 0 && altitudeDelta <= ELEVATION_DEADBAND_M ? state.anchor.altitudeM : observation.altitudeM;
    return {
      ...state,
      distanceM: state.distanceM + (validSegment ? segmentM : 0),
      elevationGainM: state.elevationGainM + altitudeGain,
      anchor: { latitudeDegrees: observation.latitudeDegrees, longitudeDegrees: observation.longitudeDegrees, wallMs: measured, altitudeM: altitudeAnchor },
      lastLocationWallMs: measured,
      poorLocationWallMs: null,
      currentSpeedMps: reportedSpeed ?? fallbackSpeed,
      currentSpeedWallMs: reportedSpeed !== null || fallbackSpeed !== null ? measured : null,
      altitudeM: altitudeUsable ? observation.altitudeM : null
    };
  };
  var apply = (state, observation) => {
    if (observation.sequence <= state.lastSequence)
      return state;
    if (observation.sequence !== state.lastSequence + 1)
      throw new RangeError(`Observation sequence gap: expected ${state.lastSequence + 1}, got ${observation.sequence}`);
    let next = state;
    if (observation.kind === "location")
      next = applyLocation(state, observation);
    else if (observation.kind === "heartRate")
      next = { ...state, heartRateBpm: observation.bpm, heartRateWallMs: wallMs(observation.sourceTimestamp), sawHeartRate: true };
    else if (observation.kind === "gap")
      next = { ...state, accumulatedActiveMs: closeActiveInterval(state, observation), state: state.state === "recording" ? "interrupted" : state.state, activeStartedWallMs: null, activeStartedMonotonicMs: null, anchor: null, currentSpeedMps: null, currentSpeedWallMs: null };
    else {
      const at = wallMs(observation.sourceTimestamp);
      const closing = state.state === "recording" && observation.to !== "recording";
      next = { ...state, state: observation.to, startedWallMs: state.startedWallMs ?? (observation.to === "recording" ? at : null), finishedWallMs: observation.to === "finished" ? at : state.finishedWallMs, accumulatedActiveMs: closing ? closeActiveInterval(state, observation) : state.accumulatedActiveMs, activeStartedWallMs: observation.to === "recording" ? at : null, activeStartedMonotonicMs: observation.to === "recording" ? observation.monotonicTimestampMs : null, anchor: observation.to === "recording" ? state.anchor : null, currentSpeedMps: observation.to === "recording" ? state.currentSpeedMps : null, currentSpeedWallMs: observation.to === "recording" ? state.currentSpeedWallMs : null };
    }
    return { ...next, lastSequence: observation.sequence };
  };
  var createRecordingEngineArtifact = () => ({
    describe: () => ({ apiVersion: RECORDING_ENGINE_API_VERSION, checkpointSchemaVersion: RECORDING_CHECKPOINT_SCHEMA_VERSION, engineBuildId: ENGINE_BUILD_ID, algorithmId: ALGORITHM_ID, maxBatchSize: RECORDING_ENGINE_MAX_BATCH_SIZE }),
    create: (checkpoint) => {
      if (checkpoint !== null && (checkpoint.schemaVersion !== 1 || checkpoint.engineBuildId !== ENGINE_BUILD_ID || checkpoint.algorithmId !== ALGORITHM_ID))
        throw new TypeError("Incompatible recording checkpoint");
      let state = checkpoint === null ? initial() : { ...checkpoint, activeStartedMonotonicMs: null };
      return {
        processBatch: ({ observations, evaluatedAt }) => {
          if (observations.length > RECORDING_ENGINE_MAX_BATCH_SIZE)
            throw new RangeError("Recording engine batch too large");
          let processedCount = 0;
          let nextState = state;
          for (const observation of observations) {
            const before = nextState.lastSequence;
            nextState = apply(nextState, observation);
            if (nextState.lastSequence !== before)
              processedCount += 1;
          }
          nextState = { ...nextState, lastEvaluationWallMs: wallMs(evaluatedAt.wallTimestamp) };
          state = nextState;
          return { processedCount, lastSequence: state.lastSequence, metrics: metrics(state, evaluatedAt), checkpoint: state };
        },
        checkpoint: () => state
      };
    }
  });

  // src/engine/recording/artifact-entry.ts
  globalThis.WorkoutAnalyzeRecordingEngine = createRecordingEngineArtifact();
})();
