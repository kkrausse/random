import {
  ARCHIVE_CAPABILITIES, MOBILE_CAPABILITIES, MOBILE_MAX_MESSAGE_BYTES, MOBILE_PROTOCOL_VERSION, PHASE1_BASE_CAPABILITIES,
  type BuildManifest, type Capability, type Command, type DiagnosticCheckId,
  type HeartRateDevice, type HeartRateMeasurement, type HeartRateStatus,
  type LocationObservation, type LocationProbeStatus, type MobileMethod,
  type NativeEvent, type PermissionStatus, type RecorderObservation, type Reply, type StatusRow, type WorkoutMetrics,
} from './contracts'

const methods = new Set<MobileMethod>(['bridge.hello', ...MOBILE_CAPABILITIES])
const capabilities = new Set<Capability>(MOBILE_CAPABILITIES)
const checkIds = new Set<DiagnosticCheckId>(['bridgePing', 'capabilityCompatibility', 'diagnosticStorage', 'engineFixture'])
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const hashPattern = /^[a-f0-9]{64}$/
const errorCodes = new Set(['invalidRequest', 'unsupportedVersion', 'unsupportedMethod', 'invalidState', 'revisionConflict', 'permissionDenied', 'sensorUnavailable', 'storageFailure', 'incompatibleBuild', 'downloadFailure', 'internalError'])
const iso = (value: unknown) => typeof value === 'string' && !Number.isNaN(Date.parse(value))
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every((key) => keys.includes(key))
const requiredAndOptionalKeys = (value: Record<string, unknown>, required: readonly string[], optional: readonly string[]) => required.every((key) => key in value) && exactKeys(value, [...required, ...optional])
const empty = (value: unknown) => record(value) && Object.keys(value).length === 0
const text = (value: unknown, max = 2048) => typeof value === 'string' && value.length > 0 && value.length <= max
const boundedString = (value: unknown, max: number) => typeof value === 'string' && value.length <= max
const finite = (value: unknown, min = -Number.MAX_VALUE, max = Number.MAX_VALUE) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
const safeInteger = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max
const nullableIso = (value: unknown) => value === null || iso(value)
const nullableText = (value: unknown, max = 2048) => value === null || text(value, max)
const base64Bytes = (value: unknown, maxEncodedLength = 684) => typeof value === 'string' && value.length <= maxEncodedLength && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
const cursorParams = (params: Record<string, unknown>, identity: 'probeId' | 'connectionId') => exactKeys(params, [identity, 'afterCursor', 'limit']) && typeof params[identity] === 'string' && idPattern.test(params[identity] as string) && (params.afterCursor === null || safeInteger(params.afterCursor)) && safeInteger(params.limit, 1, 200)
const sessionMutationParams = (params: Record<string, unknown>) => exactKeys(params, ['sessionId', 'expectedRevision']) && typeof params.sessionId === 'string' && idPattern.test(params.sessionId) && safeInteger(params.expectedRevision)
const fail = (message: string): never => { throw new TypeError(message) }

const validateParams = (method: MobileMethod, params: unknown): boolean => {
  if (!record(params)) return false
  switch (method) {
    case 'bridge.hello': return exactKeys(params, ['clientName', 'clientVersion', 'supportedProtocolVersions']) && text(params.clientName, 64) && text(params.clientVersion, 64) && Array.isArray(params.supportedProtocolVersions) && params.supportedProtocolVersions.length === 1 && params.supportedProtocolVersions[0] === 1
    case 'bridge.ping': return exactKeys(params, ['nonce']) && text(params.nonce, 128)
    case 'permissions.request': return exactKeys(params, ['permission']) && (params.permission === 'locationWhenInUse' || params.permission === 'bluetooth')
    case 'location.start': return exactKeys(params, ['desiredAccuracy', 'distanceFilterM', 'backgroundMode', 'maxDurationSeconds']) && ['best', 'nearestTenMeters', 'hundredMeters'].includes(params.desiredAccuracy as string) && finite(params.distanceFilterM, 0, 1_000) && (params.backgroundMode === 'foregroundOnly' || params.backgroundMode === 'continueWhenBackgrounded') && safeInteger(params.maxDurationSeconds, 10, 1_800)
    case 'location.stop': return exactKeys(params, ['probeId']) && typeof params.probeId === 'string' && idPattern.test(params.probeId)
    case 'location.read': return cursorParams(params, 'probeId')
    case 'heartRate.scan': return exactKeys(params, ['durationSeconds']) && safeInteger(params.durationSeconds, 1, 30)
    case 'heartRate.connect': return exactKeys(params, ['deviceId']) && typeof params.deviceId === 'string' && idPattern.test(params.deviceId)
    case 'heartRate.disconnect': return exactKeys(params, ['connectionId']) && typeof params.connectionId === 'string' && idPattern.test(params.connectionId)
    case 'heartRate.read': return cursorParams(params, 'connectionId')
    case 'diagnostics.runChecks': return exactKeys(params, ['checks']) && (params.checks === null || (Array.isArray(params.checks) && params.checks.length <= 4 && params.checks.every((id) => checkIds.has(id as DiagnosticCheckId))))
    case 'diagnostics.export': return exactKeys(params, ['includeWorkoutObservations']) && typeof params.includeWorkoutObservations === 'boolean'
    case 'appBuild.download': return exactKeys(params, ['manifestUrl']) && text(params.manifestUrl, 2048) && isAllowedDownloadUrl(params.manifestUrl as string)
    case 'appBuild.activate': return exactKeys(params, ['buildId']) && typeof params.buildId === 'string' && idPattern.test(params.buildId)
    case 'appBuild.rollback': return exactKeys(params, ['target']) && (params.target === 'previous' || params.target === 'bundled')
    case 'devSource.configure': return exactKeys(params, ['url']) && (params.url === null || (typeof params.url === 'string' && isAllowedDevUrl(params.url)))
    case 'workout.start': return exactKeys(params, ['expectedRevision', 'sport', 'startPolicy']) && safeInteger(params.expectedRevision) && params.sport === 'cycling' && (params.startPolicy === 'immediate' || params.startPolicy === 'waitForReliableLocation')
    case 'workout.pause':
    case 'workout.resume':
    case 'workout.finish': return sessionMutationParams(params)
    case 'workout.recover': return exactKeys(params, ['sessionId', 'expectedRevision', 'action']) && typeof params.sessionId === 'string' && idPattern.test(params.sessionId) && safeInteger(params.expectedRevision) && (params.action === 'resume' || params.action === 'finish')
    case 'workout.export': return exactKeys(params, ['sessionId', 'format']) && typeof params.sessionId === 'string' && idPattern.test(params.sessionId) && (params.format === 'workoutBundleV1' || params.format === 'gpx')
    case 'observations.subscribe': return exactKeys(params, ['sessionId', 'afterSequence', 'maxBatchSize']) && typeof params.sessionId === 'string' && idPattern.test(params.sessionId) && (params.afterSequence === null || safeInteger(params.afterSequence)) && safeInteger(params.maxBatchSize, 1, 200)
    case 'observations.unsubscribe': return exactKeys(params, ['subscriptionId']) && typeof params.subscriptionId === 'string' && idPattern.test(params.subscriptionId)
    case 'observations.read': return exactKeys(params, ['sessionId', 'afterSequence', 'limit']) && typeof params.sessionId === 'string' && idPattern.test(params.sessionId) && (params.afterSequence === null || safeInteger(params.afterSequence)) && safeInteger(params.limit, 1, 200)
    case 'archive.list': return exactKeys(params, ['afterCursor', 'limit']) && (params.afterCursor === null || text(params.afterCursor, 512)) && safeInteger(params.limit, 1, 100)
    case 'archive.detail': return exactKeys(params, ['savedWorkoutId', 'afterSequence', 'limit']) && typeof params.savedWorkoutId === 'string' && idPattern.test(params.savedWorkoutId) && (params.afterSequence === null || safeInteger(params.afterSequence)) && safeInteger(params.limit, 1, 200)
    case 'journal.read': return exactKeys(params, ['sessionId', 'afterJournalSequence', 'limit']) && typeof params.sessionId === 'string' && idPattern.test(params.sessionId) && (params.afterJournalSequence === null || safeInteger(params.afterJournalSequence)) && safeInteger(params.limit, 1, 200)
    default: return empty(params)
  }
}

export const encodedJsonBytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).byteLength

export const parseCommand = (value: unknown): Command => {
  const object = record(value) ? value : fail('invalid command')
  if (encodedJsonBytes(object) > MOBILE_MAX_MESSAGE_BYTES || !exactKeys(object, ['protocolVersion', 'requestId', 'method', 'params']) || object.protocolVersion !== MOBILE_PROTOCOL_VERSION || typeof object.requestId !== 'string' || !idPattern.test(object.requestId) || typeof object.method !== 'string' || !methods.has(object.method as MobileMethod) || !validateParams(object.method as MobileMethod, object.params)) fail('invalid or oversized command envelope or params')
  return object as unknown as Command
}

export const parseReplyEnvelope = (value: unknown): Reply => {
  const object = record(value) ? value : fail('invalid reply envelope')
  if (encodedJsonBytes(object) > MOBILE_MAX_MESSAGE_BYTES || object.protocolVersion !== 1 || typeof object.requestId !== 'string' || !idPattern.test(object.requestId) || typeof object.ok !== 'boolean') fail('invalid reply envelope')
  if (object.ok === true && (!exactKeys(object, ['protocolVersion', 'requestId', 'ok', 'result']) || !record(object.result))) fail('invalid success reply')
  if (object.ok === false && (!exactKeys(object, ['protocolVersion', 'requestId', 'ok', 'error']) || !record(object.error) || !exactKeys(object.error, ['code', 'message', 'retryable', 'details']) || typeof object.error.code !== 'string' || !errorCodes.has(object.error.code) || !text(object.error.message) || typeof object.error.retryable !== 'boolean' || !(!('details' in object.error) || record(object.error.details)))) fail('invalid error reply')
  return object as unknown as Reply
}

const statusRow = (value: unknown): value is StatusRow => record(value) && exactKeys(value, ['id', 'label', 'status', 'reason', 'observedAt', 'freshness', 'details']) && text(value.id, 128) && text(value.label, 128) && ['ok', 'waiting', 'unavailable', 'error'].includes(value.status as string) && text(value.reason) && (value.observedAt === null || iso(value.observedAt)) && ['fresh', 'stale', 'never'].includes(value.freshness as string) && record(value.details) && !(value.status === 'ok' && value.freshness !== 'fresh') && ((value.freshness === 'never') === (value.observedAt === null))
const summary = (value: unknown) => record(value) && exactKeys(value, ['buildId', 'source', 'engineBuildId']) && typeof value.buildId === 'string' && idPattern.test(value.buildId) && (value.source === 'bundled' || value.source === 'installed') && typeof value.engineBuildId === 'string' && idPattern.test(value.engineBuildId)
const appBuildStatus = (value: unknown) => record(value) && exactKeys(value, ['active', 'previous', 'bundled', 'downloaded', 'pendingActivationBuildId', 'lastFailure']) && summary(value.active) && (value.previous === null || summary(value.previous)) && summary(value.bundled) && Array.isArray(value.downloaded) && value.downloaded.every(summary) && (value.pendingActivationBuildId === null || (typeof value.pendingActivationBuildId === 'string' && idPattern.test(value.pendingActivationBuildId))) && (value.lastFailure === null || text(value.lastFailure))
const workoutMetrics = (value: unknown): value is WorkoutMetrics => record(value) && exactKeys(value, ['activeDurationMs', 'elapsedDurationMs', 'distanceM', 'averageSpeedMps', 'currentSpeedMps', 'currentSpeedObservedAt', 'altitudeM', 'elevationGainM', 'heartRateBpm', 'heartRateObservedAt', 'locationQuality', 'heartRateQuality']) && safeInteger(value.activeDurationMs) && safeInteger(value.elapsedDurationMs) && (value.activeDurationMs as number) <= (value.elapsedDurationMs as number) && finite(value.distanceM, 0) && (value.averageSpeedMps === null || finite(value.averageSpeedMps, 0)) && (value.currentSpeedMps === null || finite(value.currentSpeedMps, 0)) && nullableIso(value.currentSpeedObservedAt) && (value.altitudeM === null || finite(value.altitudeM)) && finite(value.elevationGainM, 0) && (value.heartRateBpm === null || safeInteger(value.heartRateBpm, 0, 65_535)) && nullableIso(value.heartRateObservedAt) && ['waiting', 'good', 'poor', 'stale'].includes(value.locationQuality as string) && ['unconfigured', 'connecting', 'live', 'stale', 'disconnected'].includes(value.heartRateQuality as string)
const workoutMetricsValidationPath = (value: unknown): string | null => {
  if (!record(value)) return '$.payload'
  const keys = ['activeDurationMs', 'elapsedDurationMs', 'distanceM', 'averageSpeedMps', 'currentSpeedMps', 'currentSpeedObservedAt', 'altitudeM', 'elevationGainM', 'heartRateBpm', 'heartRateObservedAt', 'locationQuality', 'heartRateQuality'] as const
  const missing = keys.find((key) => !(key in value))
  if (missing) return `$.payload.${missing}`
  const unexpected = Object.keys(value).find((key) => !keys.includes(key as typeof keys[number]))
  if (unexpected) return `$.payload.${unexpected}`
  if (!safeInteger(value.activeDurationMs)) return '$.payload.activeDurationMs'
  if (!safeInteger(value.elapsedDurationMs)) return '$.payload.elapsedDurationMs'
  if ((value.activeDurationMs as number) > (value.elapsedDurationMs as number)) return '$.payload.activeDurationMs>elapsedDurationMs'
  if (!finite(value.distanceM, 0)) return '$.payload.distanceM'
  if (!(value.averageSpeedMps === null || finite(value.averageSpeedMps, 0))) return '$.payload.averageSpeedMps'
  if (!(value.currentSpeedMps === null || finite(value.currentSpeedMps, 0))) return '$.payload.currentSpeedMps'
  if (!nullableIso(value.currentSpeedObservedAt)) return '$.payload.currentSpeedObservedAt'
  if (!(value.altitudeM === null || finite(value.altitudeM))) return '$.payload.altitudeM'
  if (!finite(value.elevationGainM, 0)) return '$.payload.elevationGainM'
  if (!(value.heartRateBpm === null || safeInteger(value.heartRateBpm, 0, 65_535))) return '$.payload.heartRateBpm'
  if (!nullableIso(value.heartRateObservedAt)) return '$.payload.heartRateObservedAt'
  if (!['waiting', 'good', 'poor', 'stale'].includes(value.locationQuality as string)) return '$.payload.locationQuality'
  if (!['unconfigured', 'connecting', 'live', 'stale', 'disconnected'].includes(value.heartRateQuality as string)) return '$.payload.heartRateQuality'
  return null
}
const pinnedEngine = (value: unknown) => record(value) && exactKeys(value, ['buildId', 'apiVersion', 'checkpointSchemaVersion']) && text(value.buildId, 128) && value.apiVersion === 1 && value.checkpointSchemaVersion === 1
const sessionSnapshot = (value: unknown) => {
  if (!record(value) || !['idle', 'recording', 'paused', 'finished', 'interrupted'].includes(value.state as string) || !safeInteger(value.revision) || !safeInteger(value.durableSequence) || !iso(value.capturedAt)) return false
  if (value.recorderAvailability === 'unavailable') return exactKeys(value, ['sessionId', 'state', 'revision', 'durableSequence', 'recorderAvailability', 'recorderUnavailableReason', 'pinnedEngine', 'capturedAt']) && (value.sessionId === null || text(value.sessionId, 128)) && text(value.recorderUnavailableReason) && value.pinnedEngine === null
  return value.recorderAvailability === 'available' && exactKeys(value, ['sessionId', 'state', 'revision', 'durableSequence', 'recorderAvailability', 'recorderUnavailableReason', 'pinnedEngine', 'capturedAt', 'sport', 'startedAt', 'finishedAt', 'lastTransitionAt', 'observationSequence', 'recovery', 'metrics']) && (value.sessionId === null || text(value.sessionId, 128)) && value.recorderUnavailableReason === '' && (value.pinnedEngine === null || pinnedEngine(value.pinnedEngine)) && (value.sport === 'cycling' || value.sport === null) && nullableIso(value.startedAt) && nullableIso(value.finishedAt) && nullableIso(value.lastTransitionAt) && safeInteger(value.observationSequence) && (value.sessionId === null) === (value.sport === null && value.startedAt === null && value.lastTransitionAt === null && value.pinnedEngine === null) && record(value.recovery) && exactKeys(value.recovery, ['required', 'interruptionStartedAt', 'reason']) && typeof value.recovery.required === 'boolean' && nullableIso(value.recovery.interruptionStartedAt) && nullableText(value.recovery.reason) && workoutMetrics(value.metrics)
}
const sessionSnapshotValidationPath = (value: unknown): string | null => {
  if (!record(value)) return '$.payload'
  for (const key of ['sessionId', 'state', 'revision', 'durableSequence', 'recorderAvailability', 'recorderUnavailableReason', 'pinnedEngine', 'capturedAt']) if (!(key in value)) return `$.payload.${key}`
  if (!['idle', 'recording', 'paused', 'finished', 'interrupted'].includes(value.state as string)) return '$.payload.state'
  if (!safeInteger(value.revision)) return '$.payload.revision'
  if (!safeInteger(value.durableSequence)) return '$.payload.durableSequence'
  if (!iso(value.capturedAt)) return '$.payload.capturedAt'
  if (value.recorderAvailability !== 'available' && value.recorderAvailability !== 'unavailable') return '$.payload.recorderAvailability'
  if (value.recorderAvailability === 'available') {
    for (const key of ['sport', 'startedAt', 'finishedAt', 'lastTransitionAt', 'observationSequence', 'recovery', 'metrics']) if (!(key in value)) return `$.payload.${key}`
    const metricsPath = workoutMetricsValidationPath(value.metrics)
    if (metricsPath) return metricsPath.replace('$.payload', '$.payload.metrics')
  }
  return sessionSnapshot(value) ? null : '$.payload'
}
const diagnosticsSnapshot = (value: unknown) => record(value) && exactKeys(value, ['capturedAt', 'rows', 'eventSequence']) && iso(value.capturedAt) && Array.isArray(value.rows) && value.rows.every(statusRow) && Number.isSafeInteger(value.eventSequence) && (value.eventSequence as number) >= 0

const bridgeSnapshotValidationPath = (value: unknown): string | null => {
  if (!record(value)) return '$'
  const keys = ['sequence', 'session', 'permissions', 'location', 'heartRate', 'diagnostics', 'appBuild'] as const
  const missing = keys.find((key) => !(key in value))
  if (missing) return `$.${missing}`
  const unexpected = Object.keys(value).find((key) => !keys.includes(key as typeof keys[number]))
  if (unexpected) return `$.${unexpected}`
  if (!safeInteger(value.sequence)) return '$.sequence'
  if (!sessionSnapshot(value.session)) return '$.session'
  if (!permissionStatus(value.permissions)) return '$.permissions'
  if (!locationStatus(value.location)) return '$.location'
  if (!heartRateStatus(value.heartRate)) return '$.heartRate'
  if (!diagnosticsSnapshot(value.diagnostics)) return '$.diagnostics'
  if ((value.diagnostics as Record<string, unknown>).eventSequence !== value.sequence) return '$.diagnostics.eventSequence'
  if (!appBuildStatus(value.appBuild)) return '$.appBuild'
  return null
}

const permissionStatus = (value: unknown): value is PermissionStatus => record(value) && exactKeys(value, ['location', 'bluetooth', 'promptsAutomatically']) && statusRow(value.location) && ['notDetermined', 'denied', 'restricted', 'whenInUse', 'always'].includes(value.location.details.authorization as string) && (value.location.details.precise === null || typeof value.location.details.precise === 'boolean') && statusRow(value.bluetooth) && ['notDetermined', 'denied', 'restricted', 'allowed'].includes(value.bluetooth.details.authorization as string) && ['unknown', 'unsupported', 'unauthorized', 'poweredOff', 'poweredOn'].includes(value.bluetooth.details.power as string) && value.promptsAutomatically === false

const locationObservation = (value: unknown): value is LocationObservation => record(value) && requiredAndOptionalKeys(value, ['cursor', 'source', 'sourceTimestamp', 'receivedAt', 'latitudeDegrees', 'longitudeDegrees', 'horizontalAccuracyM', 'altitudeM', 'verticalAccuracyM', 'speedMps', 'speedAccuracyMps', 'courseDegrees', 'courseAccuracyDegrees', 'floorLevel', 'isSimulatedBySoftware', 'isProducedByAccessory'], ['ellipsoidalAltitudeM']) && safeInteger(value.cursor, 1) && value.source === 'coreLocation' && iso(value.sourceTimestamp) && iso(value.receivedAt) && finite(value.latitudeDegrees, -90, 90) && finite(value.longitudeDegrees, -180, 180) && finite(value.horizontalAccuracyM, 0) && (value.altitudeM === null || finite(value.altitudeM)) && (value.verticalAccuracyM === null || finite(value.verticalAccuracyM, 0)) && (value.speedMps === null || finite(value.speedMps, 0)) && (value.speedAccuracyMps === null || finite(value.speedAccuracyMps, 0)) && (value.courseDegrees === null || finite(value.courseDegrees, 0, 360)) && (value.courseAccuracyDegrees === null || finite(value.courseAccuracyDegrees, 0)) && (value.floorLevel === null || safeInteger(value.floorLevel, -1_000, 10_000)) && (value.isSimulatedBySoftware === null || typeof value.isSimulatedBySoftware === 'boolean') && (value.isProducedByAccessory === null || typeof value.isProducedByAccessory === 'boolean') && (!('ellipsoidalAltitudeM' in value) || value.ellipsoidalAltitudeM === null || finite(value.ellipsoidalAltitudeM))

const locationStatus = (value: unknown): value is LocationProbeStatus => record(value) && exactKeys(value, ['availability', 'state', 'reason', 'probeId', 'startedAt', 'expiresAt', 'backgroundMode', 'backgroundDeliveryActive', 'appLifecycle', 'receivedCount', 'acceptedCount', 'rejectedCount', 'lastRejectionReason', 'retainedCount', 'oldestCursor', 'latestCursor', 'latestObservation', 'lastError']) && ['available', 'unavailable'].includes(value.availability as string) && ['inactive', 'starting', 'active', 'stopping', 'error'].includes(value.state as string) && text(value.reason) && (value.probeId === null || (typeof value.probeId === 'string' && idPattern.test(value.probeId))) && nullableIso(value.startedAt) && nullableIso(value.expiresAt) && (value.backgroundMode === null || value.backgroundMode === 'foregroundOnly' || value.backgroundMode === 'continueWhenBackgrounded') && typeof value.backgroundDeliveryActive === 'boolean' && ['active', 'inactive', 'background'].includes(value.appLifecycle as string) && safeInteger(value.receivedCount) && safeInteger(value.acceptedCount) && safeInteger(value.rejectedCount) && (value.acceptedCount as number) + (value.rejectedCount as number) <= (value.receivedCount as number) && nullableText(value.lastRejectionReason) && safeInteger(value.retainedCount, 0, 2_048) && (value.retainedCount as number) <= (value.acceptedCount as number) && (value.oldestCursor === null || safeInteger(value.oldestCursor, 1)) && (value.latestCursor === null || safeInteger(value.latestCursor, 1)) && ((value.retainedCount === 0) === (value.oldestCursor === null && value.latestCursor === null)) && (value.latestObservation === null || locationObservation(value.latestObservation) && value.latestObservation.cursor === value.latestCursor) && nullableText(value.lastError)

const heartRateDevice = (value: unknown): value is HeartRateDevice => record(value) && exactKeys(value, ['deviceId', 'name', 'rssi', 'lastSeenAt', 'isConnectable', 'advertisedServiceUuids']) && typeof value.deviceId === 'string' && idPattern.test(value.deviceId) && (value.name === null || boundedString(value.name, 128)) && (value.rssi === null || safeInteger(value.rssi, -127, 20)) && iso(value.lastSeenAt) && (value.isConnectable === null || typeof value.isConnectable === 'boolean') && Array.isArray(value.advertisedServiceUuids) && value.advertisedServiceUuids.length <= 16 && value.advertisedServiceUuids.every((item) => text(item, 64))

const heartRateMeasurement = (value: unknown): value is HeartRateMeasurement => record(value) && requiredAndOptionalKeys(value, ['cursor', 'connectionId', 'deviceId', 'receivedAt', 'bpm', 'valueFormat', 'sensorContact', 'energyExpendedKJ', 'rrIntervalsSeconds', 'rawFlags'], ['rawCharacteristicBase64']) && safeInteger(value.cursor, 1) && typeof value.connectionId === 'string' && idPattern.test(value.connectionId) && typeof value.deviceId === 'string' && idPattern.test(value.deviceId) && iso(value.receivedAt) && safeInteger(value.bpm, 0, 65_535) && (value.valueFormat === 'uint8' || value.valueFormat === 'uint16') && ['unsupported', 'notDetected', 'detected'].includes(value.sensorContact as string) && (value.energyExpendedKJ === null || safeInteger(value.energyExpendedKJ, 0, 65_535)) && Array.isArray(value.rrIntervalsSeconds) && value.rrIntervalsSeconds.length <= 32 && value.rrIntervalsSeconds.every((item) => finite(item, 0, 60)) && safeInteger(value.rawFlags, 0, 255) && (!('rawCharacteristicBase64' in value) || base64Bytes(value.rawCharacteristicBase64))

const heartRateStatus = (value: unknown): value is HeartRateStatus => record(value) && exactKeys(value, ['availability', 'state', 'reason', 'scanEndsAt', 'devices', 'connectionId', 'connectedDevice', 'backgroundModeConfigured', 'appLifecycle', 'receivedCount', 'parseErrorCount', 'reconnectCount', 'retainedCount', 'oldestCursor', 'latestCursor', 'latestMeasurement', 'lastError']) && ['available', 'unavailable'].includes(value.availability as string) && ['inactive', 'scanning', 'connecting', 'connected', 'disconnecting', 'error'].includes(value.state as string) && text(value.reason) && nullableIso(value.scanEndsAt) && Array.isArray(value.devices) && value.devices.length <= 32 && value.devices.every(heartRateDevice) && (value.connectionId === null || (typeof value.connectionId === 'string' && idPattern.test(value.connectionId))) && (value.connectedDevice === null || heartRateDevice(value.connectedDevice)) && typeof value.backgroundModeConfigured === 'boolean' && ['active', 'inactive', 'background'].includes(value.appLifecycle as string) && safeInteger(value.receivedCount) && safeInteger(value.parseErrorCount) && (value.parseErrorCount as number) <= (value.receivedCount as number) && safeInteger(value.reconnectCount) && safeInteger(value.retainedCount, 0, 2_048) && (value.retainedCount as number) <= (value.receivedCount as number) && (value.oldestCursor === null || safeInteger(value.oldestCursor, 1)) && (value.latestCursor === null || safeInteger(value.latestCursor, 1)) && ((value.retainedCount === 0) === (value.oldestCursor === null && value.latestCursor === null)) && (value.latestMeasurement === null || heartRateMeasurement(value.latestMeasurement) && value.latestMeasurement.cursor === value.latestCursor && value.latestMeasurement.connectionId === value.connectionId) && nullableText(value.lastError)

const heartRateStatusValidationPath = (value: unknown, root = '$'): string | null => {
  if (heartRateStatus(value)) return null
  if (!record(value)) return root
  const keys = ['availability', 'state', 'reason', 'scanEndsAt', 'devices', 'connectionId', 'connectedDevice', 'backgroundModeConfigured', 'appLifecycle', 'receivedCount', 'parseErrorCount', 'reconnectCount', 'retainedCount', 'oldestCursor', 'latestCursor', 'latestMeasurement', 'lastError'] as const
  const missing = keys.find((key) => !(key in value))
  if (missing) return `${root}.${missing}`
  const unexpected = Object.keys(value).find((key) => !keys.includes(key as typeof keys[number]))
  if (unexpected) return `${root}.${unexpected}`
  if (!Array.isArray(value.devices) || value.devices.length > 32) return `${root}.devices`
  const invalidDevice = value.devices.findIndex((device) => !heartRateDevice(device))
  if (invalidDevice >= 0) {
    const device = value.devices[invalidDevice]
    if (record(device) && !(device.name === null || boundedString(device.name, 128))) return `${root}.devices[${invalidDevice}].name`
    return `${root}.devices[${invalidDevice}]`
  }
  for (const key of ['availability', 'state', 'reason', 'scanEndsAt', 'connectionId', 'connectedDevice', 'backgroundModeConfigured', 'appLifecycle', 'receivedCount', 'parseErrorCount', 'reconnectCount', 'retainedCount', 'oldestCursor', 'latestCursor', 'latestMeasurement', 'lastError'] as const) {
    const candidate = { ...value, [key]: key === 'availability' ? 'available' : key === 'state' ? 'inactive' : key === 'reason' ? 'valid' : key === 'scanEndsAt' || key === 'connectionId' || key === 'connectedDevice' || key === 'oldestCursor' || key === 'latestCursor' || key === 'latestMeasurement' || key === 'lastError' ? null : key === 'backgroundModeConfigured' ? true : key === 'appLifecycle' ? 'active' : 0 }
    if (heartRateStatus(candidate)) return `${root}.${key}`
  }
  return root
}

const observationProvenance = (value: unknown) => record(value) && requiredAndOptionalKeys(value, ['origin', 'sourceId', 'monotonicClockId', 'lineage'], ['rawEvent']) && ['liveNative', 'recordingReplay', 'syntheticFixture'].includes(value.origin as string) && nullableText(value.sourceId, 256) && nullableText(value.monotonicClockId, 128) && (value.lineage === null || record(value.lineage) && exactKeys(value.lineage, ['savedWorkoutId', 'sessionId', 'sequence']) && typeof value.lineage.savedWorkoutId === 'string' && idPattern.test(value.lineage.savedWorkoutId) && typeof value.lineage.sessionId === 'string' && idPattern.test(value.lineage.sessionId) && safeInteger(value.lineage.sequence, 1)) && ((value.origin === 'recordingReplay') === (value.lineage !== null)) && (!('rawEvent' in value) || record(value.rawEvent) && exactKeys(value.rawEvent, ['eventId', 'journalSequence']) && typeof value.rawEvent.eventId === 'string' && idPattern.test(value.rawEvent.eventId) && safeInteger(value.rawEvent.journalSequence, 1))
const optionalProvenance = (value: Record<string, unknown>) => !('provenance' in value) || observationProvenance(value.provenance)

const recorderObservation = (value: unknown): value is RecorderObservation => {
  if (!record(value) || !text(value.sessionId, 128) || !safeInteger(value.sequence, 1) || !iso(value.sourceTimestamp) || !(value.monotonicTimestampMs === null || finite(value.monotonicTimestampMs, 0))) return false
  if (!optionalProvenance(value)) return false
  if (value.kind === 'location') return requiredAndOptionalKeys(value, ['kind', 'sessionId', 'sequence', 'source', 'sourceTimestamp', 'receivedAt', 'monotonicTimestampMs', 'latitudeDegrees', 'longitudeDegrees', 'horizontalAccuracyM', 'altitudeM', 'verticalAccuracyM', 'speedMps', 'speedAccuracyMps', 'courseDegrees', 'courseAccuracyDegrees', 'floorLevel', 'isSimulatedBySoftware', 'isProducedByAccessory'], ['ellipsoidalAltitudeM', 'provenance']) && locationObservation({ cursor: value.sequence, source: value.source, sourceTimestamp: value.sourceTimestamp, receivedAt: value.receivedAt, latitudeDegrees: value.latitudeDegrees, longitudeDegrees: value.longitudeDegrees, horizontalAccuracyM: value.horizontalAccuracyM, altitudeM: value.altitudeM, verticalAccuracyM: value.verticalAccuracyM, speedMps: value.speedMps, speedAccuracyMps: value.speedAccuracyMps, courseDegrees: value.courseDegrees, courseAccuracyDegrees: value.courseAccuracyDegrees, floorLevel: value.floorLevel, isSimulatedBySoftware: value.isSimulatedBySoftware, isProducedByAccessory: value.isProducedByAccessory, ...('ellipsoidalAltitudeM' in value ? { ellipsoidalAltitudeM: value.ellipsoidalAltitudeM } : {}) })
  if (value.kind === 'heartRate') return requiredAndOptionalKeys(value, ['kind', 'sessionId', 'sequence', 'connectionId', 'deviceId', 'sourceTimestamp', 'receivedAt', 'monotonicTimestampMs', 'bpm', 'valueFormat', 'sensorContact', 'energyExpendedKJ', 'rrIntervalsSeconds', 'rawFlags'], ['rawCharacteristicBase64', 'provenance']) && heartRateMeasurement({ cursor: value.sequence, connectionId: value.connectionId, deviceId: value.deviceId, receivedAt: value.receivedAt, bpm: value.bpm, valueFormat: value.valueFormat, sensorContact: value.sensorContact, energyExpendedKJ: value.energyExpendedKJ, rrIntervalsSeconds: value.rrIntervalsSeconds, rawFlags: value.rawFlags, ...('rawCharacteristicBase64' in value ? { rawCharacteristicBase64: value.rawCharacteristicBase64 } : {}) })
  if (value.kind === 'heartRatePacket') return requiredAndOptionalKeys(value, ['kind', 'sessionId', 'sequence', 'connectionId', 'deviceId', 'sourceTimestamp', 'receivedAt', 'monotonicTimestampMs', 'rawCharacteristicBase64', 'parseError'], ['provenance']) && typeof value.connectionId === 'string' && idPattern.test(value.connectionId) && typeof value.deviceId === 'string' && idPattern.test(value.deviceId) && iso(value.receivedAt) && base64Bytes(value.rawCharacteristicBase64) && text(value.parseError)
  if (value.kind === 'heartRateConnection') return requiredAndOptionalKeys(value, ['kind', 'sessionId', 'sequence', 'connectionId', 'deviceId', 'sourceTimestamp', 'receivedAt', 'monotonicTimestampMs', 'event', 'reason'], ['provenance']) && (value.connectionId === null || typeof value.connectionId === 'string' && idPattern.test(value.connectionId)) && (value.deviceId === null || typeof value.deviceId === 'string' && idPattern.test(value.deviceId)) && iso(value.receivedAt) && ['connecting', 'connected', 'disconnected', 'reconnecting', 'failed'].includes(value.event as string) && text(value.reason)
  if (value.kind === 'hostLifecycle') return requiredAndOptionalKeys(value, ['kind', 'sessionId', 'sequence', 'sourceTimestamp', 'receivedAt', 'monotonicTimestampMs', 'event', 'applicationState', 'protectedDataAvailable'], ['provenance']) && iso(value.receivedAt) && ['didBecomeActive', 'willResignActive', 'didEnterBackground', 'willEnterForeground', 'protectedDataWillBecomeUnavailable', 'protectedDataDidBecomeAvailable'].includes(value.event as string) && ['active', 'inactive', 'background', 'unknown'].includes(value.applicationState as string) && typeof value.protectedDataAvailable === 'boolean'
  if (value.kind === 'transition') return requiredAndOptionalKeys(value, ['kind', 'sessionId', 'sequence', 'transitionId', 'from', 'to', 'sourceTimestamp', 'monotonicTimestampMs', 'cause'], ['receivedAt', 'provenance']) && text(value.transitionId, 128) && ['idle', 'recording', 'paused', 'finished', 'interrupted'].includes(value.from as string) && ['idle', 'recording', 'paused', 'finished', 'interrupted'].includes(value.to as string) && ['user', 'recovery', 'systemInterruption'].includes(value.cause as string) && (!('receivedAt' in value) || iso(value.receivedAt))
  return value.kind === 'gap' && requiredAndOptionalKeys(value, ['kind', 'sessionId', 'sequence', 'sourceTimestamp', 'monotonicTimestampMs', 'startedAt', 'endedAt', 'reason'], ['receivedAt', 'provenance']) && iso(value.startedAt) && iso(value.endedAt) && (!('receivedAt' in value) || iso(value.receivedAt)) && Date.parse(value.endedAt as string) >= Date.parse(value.startedAt as string) && ['processRestart', 'osTermination', 'reboot', 'sensorDeliveryGap', 'unknown'].includes(value.reason as string)
}

const observationPage = (value: unknown) => {
  if (!record(value) || !exactKeys(value, ['items', 'nextSequence', 'oldestAvailableSequence', 'latestDurableSequence', 'hasMore', 'droppedBeforeSequence']) || !Array.isArray(value.items) || value.items.length > 200 || !value.items.every(recorderObservation) || !(value.nextSequence === null || safeInteger(value.nextSequence, 1)) || !(value.oldestAvailableSequence === null || safeInteger(value.oldestAvailableSequence, 1)) || !safeInteger(value.latestDurableSequence) || typeof value.hasMore !== 'boolean' || typeof value.droppedBeforeSequence !== 'boolean') return false
  const sequences = value.items.map((item) => (item as RecorderObservation).sequence)
  return sequences.every((sequence, index) => index === 0 || sequence === sequences[index - 1]! + 1) && (sequences.length === 0 ? value.nextSequence === null : value.nextSequence === sequences.at(-1)) && sequences.every((sequence) => sequence <= (value.latestDurableSequence as number)) && ((value.hasMore as boolean) === (sequences.length > 0 && (sequences.at(-1) as number) < (value.latestDurableSequence as number)))
}

const recordingIssue = (value: unknown) => record(value) && exactKeys(value, ['issueId', 'severity', 'code', 'message', 'observedAt', 'durableSequence']) && text(value.issueId, 128) && ['warning', 'fatal'].includes(value.severity as string) && ['poorLocation', 'locationStale', 'storageFailure', 'engineFailure', 'interrupted'].includes(value.code as string) && text(value.message) && iso(value.observedAt) && safeInteger(value.durableSequence)

const nativeEventPayloadValidationPath = (type: unknown, payload: unknown): string | null => {
  if (type === 'session.updated') return sessionSnapshotValidationPath(payload)
  if (type === 'metrics.updated') return workoutMetricsValidationPath(payload)
  if (type === 'diagnostics.updated' && record(payload) && Array.isArray(payload.rows)) {
    const invalid = payload.rows.findIndex((item) => !statusRow(item))
    if (invalid >= 0) return `$.payload.rows[${invalid}]${record(payload.rows[invalid]) && typeof payload.rows[invalid].id === 'string' ? `.id=${payload.rows[invalid].id}` : ''}`
  }
  if (type === 'observations.appended' && record(payload) && Array.isArray(payload.items)) {
    const invalid = payload.items.findIndex((item) => !recorderObservation(item))
    if (invalid >= 0) return `$.payload.items[${invalid}]${record(payload.items[invalid]) && typeof payload.items[invalid].kind === 'string' ? `.kind=${payload.items[invalid].kind}` : ''}`
  }
  const valid = (type === 'session.updated' && sessionSnapshot(payload)) || (type === 'diagnostics.updated' && diagnosticsSnapshot(payload)) || (type === 'appBuild.updated' && appBuildStatus(payload)) || (type === 'permissions.updated' && permissionStatus(payload)) || (type === 'location.updated' && locationStatus(payload)) || (type === 'heartRate.updated' && heartRateStatus(payload)) || (type === 'metrics.updated' && workoutMetrics(payload)) || (type === 'observations.appended' && observationPage(payload)) || (type === 'recording.issue' && recordingIssue(payload))
  return valid ? null : '$.payload'
}

const savedWorkoutSummary = (value: unknown) => record(value) && requiredAndOptionalKeys(value, ['savedWorkoutId', 'sessionId', 'sport', 'startedAt', 'finishedAt', 'durationMs', 'observationCount', 'latestSequence', 'metrics', 'hasFatalIssue'], ['rawEventCount', 'lastJournalSequence']) && typeof value.savedWorkoutId === 'string' && idPattern.test(value.savedWorkoutId) && typeof value.sessionId === 'string' && idPattern.test(value.sessionId) && value.sport === 'cycling' && iso(value.startedAt) && iso(value.finishedAt) && Date.parse(value.finishedAt as string) >= Date.parse(value.startedAt as string) && safeInteger(value.durationMs) && safeInteger(value.observationCount) && safeInteger(value.latestSequence) && value.observationCount === value.latestSequence && workoutMetrics(value.metrics) && typeof value.hasFatalIssue === 'boolean' && (('rawEventCount' in value) === ('lastJournalSequence' in value)) && (!('rawEventCount' in value) || safeInteger(value.rawEventCount) && safeInteger(value.lastJournalSequence) && value.rawEventCount === value.lastJournalSequence)

const archiveListPage = (value: unknown) => {
  if (!record(value) || !exactKeys(value, ['afterCursor', 'items', 'nextCursor', 'hasMore', 'snapshotAt']) || !(value.afterCursor === null || text(value.afterCursor, 512)) || !Array.isArray(value.items) || value.items.length > 100 || !value.items.every(savedWorkoutSummary) || !(value.nextCursor === null || text(value.nextCursor, 512)) || typeof value.hasMore !== 'boolean' || !iso(value.snapshotAt) || (value.hasMore !== (value.nextCursor !== null))) return false
  const items = value.items as Array<Record<string, unknown>>
  return new Set(items.map((item) => item.savedWorkoutId)).size === items.length && items.every((item, index) => index === 0 || Date.parse(item.finishedAt as string) < Date.parse(items[index - 1]!.finishedAt as string) || item.finishedAt === items[index - 1]!.finishedAt && (item.savedWorkoutId as string) < (items[index - 1]!.savedWorkoutId as string))
}

const archiveObservationPage = (value: unknown) => {
  if (!record(value) || !exactKeys(value, ['afterSequence', 'items', 'nextSequence', 'oldestAvailableSequence', 'latestDurableSequence', 'hasMore', 'droppedBeforeSequence']) || !(value.afterSequence === null || safeInteger(value.afterSequence)) || value.droppedBeforeSequence !== false || !observationPage({ items: value.items, nextSequence: value.nextSequence, oldestAvailableSequence: value.oldestAvailableSequence, latestDurableSequence: value.latestDurableSequence, hasMore: value.hasMore, droppedBeforeSequence: value.droppedBeforeSequence })) return false
  const items = value.items as RecorderObservation[]
  const expectedFirst = value.afterSequence === null ? 1 : (value.afterSequence as number) + 1
  return (value.latestDurableSequence === 0 ? value.oldestAvailableSequence === null : value.oldestAvailableSequence === 1) && (items.length === 0 || items[0]!.sequence === expectedFirst)
}

const jsonPayload = (value: unknown, depth = 0): boolean => {
  if (depth > 32) return false
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every((item) => jsonPayload(item, depth + 1))
  return record(value) && Object.values(value).every((item) => jsonPayload(item, depth + 1))
}

const rawWorkoutEvent = (value: unknown) => {
  if (!record(value) || !exactKeys(value, ['formatVersion', 'eventId', 'sessionId', 'journalSequence', 'kind', 'sourceTimestamp', 'receivedAt', 'monotonicTimestampMs', 'provenance', 'batch', 'payload']) || value.formatVersion !== 1 || typeof value.eventId !== 'string' || !idPattern.test(value.eventId) || typeof value.sessionId !== 'string' || !idPattern.test(value.sessionId) || !safeInteger(value.journalSequence, 1) || !text(value.kind, 128) || !nullableIso(value.sourceTimestamp) || !iso(value.receivedAt) || !(value.monotonicTimestampMs === null || finite(value.monotonicTimestampMs, 0)) || !observationProvenance(value.provenance)) return false
  if (!(value.batch === null || record(value.batch) && exactKeys(value.batch, ['batchId', 'index', 'size']) && typeof value.batch.batchId === 'string' && idPattern.test(value.batch.batchId) && safeInteger(value.batch.index) && safeInteger(value.batch.size, 1, 10_000) && (value.batch.index as number) < (value.batch.size as number))) return false
  if (!record(value.payload) || !exactKeys(value.payload, ['encoding', 'value'])) return false
  return value.payload.encoding === 'json'
    ? jsonPayload(value.payload.value) && encodedJsonBytes(value.payload.value) <= 64 * 1024
    : value.payload.encoding === 'base64' && base64Bytes(value.payload.value, 192 * 1024)
}

const rawWorkoutEventPage = (value: unknown) => {
  if (!record(value) || !exactKeys(value, ['afterJournalSequence', 'items', 'nextJournalSequence', 'oldestAvailableJournalSequence', 'latestJournalSequence', 'hasMore', 'droppedBeforeJournalSequence']) || !(value.afterJournalSequence === null || safeInteger(value.afterJournalSequence)) || !Array.isArray(value.items) || value.items.length > 200 || !value.items.every(rawWorkoutEvent) || !(value.nextJournalSequence === null || safeInteger(value.nextJournalSequence, 1)) || !(value.oldestAvailableJournalSequence === null || value.oldestAvailableJournalSequence === 1) || !safeInteger(value.latestJournalSequence) || typeof value.hasMore !== 'boolean' || value.droppedBeforeJournalSequence !== false) return false
  const items = value.items as Array<{ sessionId: string; journalSequence: number }>
  const expectedFirst = value.afterJournalSequence === null ? 1 : (value.afterJournalSequence as number) + 1
  const sequencesAreContiguous = items.every((item, index) => index === 0 ? item.journalSequence === expectedFirst : item.journalSequence === items[index - 1]!.journalSequence + 1)
  return sequencesAreContiguous && new Set(items.map((item) => item.sessionId)).size <= 1 && new Set((value.items as Array<{ eventId: string }>).map((item) => item.eventId)).size === items.length && (items.length === 0 ? value.nextJournalSequence === null : value.nextJournalSequence === items.at(-1)!.journalSequence) && (value.latestJournalSequence === 0 ? value.oldestAvailableJournalSequence === null : value.oldestAvailableJournalSequence === 1) && value.hasMore === (items.length > 0 && items.at(-1)!.journalSequence < (value.latestJournalSequence as number))
}

const savedWorkoutDetail = (value: unknown) => record(value) && exactKeys(value, ['summary', 'pinnedEngine', 'recordingFormatVersion', 'units', 'derivation', 'observations']) && savedWorkoutSummary(value.summary) && pinnedEngine(value.pinnedEngine) && value.recordingFormatVersion === 1 && value.units === 'SI' && record(value.derivation) && exactKeys(value.derivation, ['algorithmId', 'engineBuildId', 'configId', 'firstInputSequence', 'lastInputSequence']) && text(value.derivation.algorithmId, 128) && text(value.derivation.engineBuildId, 128) && text(value.derivation.configId, 128) && (value.derivation.firstInputSequence === null || safeInteger(value.derivation.firstInputSequence, 1)) && safeInteger(value.derivation.lastInputSequence) && (value.derivation.firstInputSequence === null ? value.derivation.lastInputSequence === 0 : (value.derivation.firstInputSequence as number) <= (value.derivation.lastInputSequence as number)) && archiveObservationPage(value.observations) && (value.summary as Record<string, unknown>).latestSequence === (value.observations as Record<string, unknown>).latestDurableSequence && (value.summary as Record<string, unknown>).observationCount === (value.observations as Record<string, unknown>).latestDurableSequence

const cursorPage = (value: unknown, itemValidator: (item: unknown) => boolean) => {
  if (!record(value) || !exactKeys(value, ['items', 'nextCursor', 'oldestAvailableCursor', 'hasMore', 'droppedBeforeCursor']) || !Array.isArray(value.items) || value.items.length > 200 || !value.items.every(itemValidator) || !(value.nextCursor === null || safeInteger(value.nextCursor, 1)) || !(value.oldestAvailableCursor === null || safeInteger(value.oldestAvailableCursor, 1)) || typeof value.hasMore !== 'boolean' || typeof value.droppedBeforeCursor !== 'boolean') return false
  const cursors = value.items.map((item) => (item as { cursor: number }).cursor)
  return cursors.every((cursor, index) => index === 0 || cursor > cursors[index - 1]!) && (cursors.length === 0 || value.nextCursor === cursors.at(-1))
}

const validSuccessResult = (method: MobileMethod, value: unknown): boolean => {
  if (!record(value)) return false
  switch (method) {
    case 'bridge.hello': {
      const unavailable = ['workout.recorder', 'sensors.location', 'sensors.bluetoothHeartRate']
      const advertised = Array.isArray(value.capabilities) ? value.capabilities : []
      if (!exactKeys(value, ['shellVersion', 'protocolVersion', 'engineApiVersion', 'checkpointSchemaVersion', 'capabilities', 'unavailableCapabilities']) || !text(value.shellVersion, 64) || value.protocolVersion !== 1 || value.engineApiVersion !== 1 || value.checkpointSchemaVersion !== 1 || !Array.isArray(value.capabilities) || new Set(advertised).size !== advertised.length || !advertised.every((item) => capabilities.has(item as Capability)) || !PHASE1_BASE_CAPABILITIES.every((item) => advertised.includes(item)) || !Array.isArray(value.unavailableCapabilities) || !value.unavailableCapabilities.every((item) => record(item) && exactKeys(item, ['capability', 'reason']) && unavailable.includes(item.capability as string) && text(item.reason))) return false
      const unavailableSet = new Set(value.unavailableCapabilities.map((item) => (item as Record<string, unknown>).capability))
      const locationMethods = ['location.status', 'location.start', 'location.stop', 'location.read']
      const heartRateMethods = ['heartRate.status', 'heartRate.scan', 'heartRate.stopScan', 'heartRate.connect', 'heartRate.disconnect', 'heartRate.read']
      const recorderMethods = ['workout.start', 'workout.pause', 'workout.resume', 'workout.finish', 'workout.recover', 'workout.export', 'observations.subscribe', 'observations.unsubscribe', 'observations.read']
      const locationCount = locationMethods.filter((item) => advertised.includes(item)).length
      const heartRateCount = heartRateMethods.filter((item) => advertised.includes(item)).length
      const locationAvailable = locationCount === locationMethods.length
      const heartRateAvailable = heartRateCount === heartRateMethods.length
      const recorderCount = recorderMethods.filter((item) => advertised.includes(item)).length
      const recorderAvailable = recorderCount === recorderMethods.length
      const archiveCount = ARCHIVE_CAPABILITIES.filter((item) => advertised.includes(item)).length
      const archiveAvailable = archiveCount === ARCHIVE_CAPABILITIES.length
      return (locationCount === 0 || locationAvailable) && (heartRateCount === 0 || heartRateAvailable) && (recorderCount === 0 || recorderAvailable) && (archiveCount === 0 || archiveAvailable) && unavailableSet.size === value.unavailableCapabilities.length && unavailableSet.has('workout.recorder') === !recorderAvailable && unavailableSet.has('sensors.location') === !locationAvailable && unavailableSet.has('sensors.bluetoothHeartRate') === !heartRateAvailable && (!locationAvailable && !heartRateAvailable && !recorderAvailable || advertised.includes('permissions.request') && advertised.includes('bridge.snapshot'))
    }
    case 'bridge.ping': return exactKeys(value, ['nonce', 'nativeReceivedAt', 'nativeSentAt']) && text(value.nonce, 128) && iso(value.nativeReceivedAt) && iso(value.nativeSentAt)
    case 'session.snapshot': return sessionSnapshot(value)
    case 'permissions.status':
    case 'permissions.request': return permissionStatus(value)
    case 'bridge.snapshot': return bridgeSnapshotValidationPath(value) === null
    case 'location.status':
    case 'location.start':
    case 'location.stop': return locationStatus(value)
    case 'location.read': return cursorPage(value, locationObservation)
    case 'heartRate.status':
    case 'heartRate.scan':
    case 'heartRate.stopScan':
    case 'heartRate.connect':
    case 'heartRate.disconnect': return heartRateStatus(value)
    case 'heartRate.read': return cursorPage(value, heartRateMeasurement)
    case 'diagnostics.snapshot': return diagnosticsSnapshot(value)
    case 'diagnostics.runChecks': return exactKeys(value, ['results', 'workoutStateUnchanged']) && value.workoutStateUnchanged === true && Array.isArray(value.results) && value.results.every((item) => record(item) && exactKeys(item, ['id', 'outcome', 'reason', 'startedAt', 'finishedAt', 'namespace']) && checkIds.has(item.id as DiagnosticCheckId) && ['pass', 'fail', 'notRun'].includes(item.outcome as string) && text(item.reason) && (item.startedAt === null || iso(item.startedAt)) && (item.finishedAt === null || iso(item.finishedAt)) && ['diagnostics', 'engine-fixture'].includes(item.namespace as string))
    case 'diagnostics.export': return exactKeys(value, ['presented', 'exportId']) && typeof value.presented === 'boolean' && text(value.exportId, 128)
    case 'appBuild.status': return appBuildStatus(value)
    case 'appBuild.download': return exactKeys(value, ['build', 'activated']) && summary(value.build) && value.activated === false
    case 'appBuild.activate':
    case 'appBuild.rollback': return exactKeys(value, ['active', 'reloadRequired']) && summary(value.active) && value.reloadRequired === true
    case 'devSource.configure': return exactKeys(value, ['source', 'reloadRequired']) && value.reloadRequired === true && record(value.source) && ((value.source.kind === 'bundled' && exactKeys(value.source, ['kind'])) || (value.source.kind === 'development' && exactKeys(value.source, ['kind', 'url']) && typeof value.source.url === 'string' && isAllowedDevUrl(value.source.url)))
    case 'ui.reload': return exactKeys(value, ['accepted']) && value.accepted === true
    case 'workout.start':
    case 'workout.pause':
    case 'workout.resume': return sessionSnapshot(value)
    case 'workout.finish': return exactKeys(value, ['session', 'savedWorkoutId']) && sessionSnapshot(value.session) && text(value.savedWorkoutId, 128)
    case 'workout.recover': return sessionSnapshot(value) || exactKeys(value, ['session', 'savedWorkoutId']) && sessionSnapshot(value.session) && text(value.savedWorkoutId, 128)
    case 'workout.export': return exactKeys(value, ['exportId', 'presented', 'format']) && text(value.exportId, 128) && typeof value.presented === 'boolean' && (value.format === 'workoutBundleV1' || value.format === 'gpx')
    case 'observations.subscribe': return exactKeys(value, ['subscriptionId', 'afterSequence', 'latestDurableSequence']) && text(value.subscriptionId, 128) && safeInteger(value.afterSequence) && safeInteger(value.latestDurableSequence) && (value.afterSequence as number) <= (value.latestDurableSequence as number)
    case 'observations.unsubscribe': return exactKeys(value, ['removed']) && value.removed === true
    case 'observations.read': return observationPage(value)
    case 'archive.list': return archiveListPage(value)
    case 'archive.detail': return savedWorkoutDetail(value)
    case 'journal.read': return rawWorkoutEventPage(value)
  }
}

export const parseReply = <M extends MobileMethod>(method: M, value: unknown): Reply<M> => {
  const reply = parseReplyEnvelope(value)
  if (reply.ok && method === 'bridge.snapshot') {
    const path = bridgeSnapshotValidationPath(reply.result)
    if (path) fail(`invalid bridge.snapshot result at ${path}`)
  }
  if (reply.ok && ['heartRate.status', 'heartRate.scan', 'heartRate.stopScan', 'heartRate.connect', 'heartRate.disconnect'].includes(method)) {
    const path = heartRateStatusValidationPath(reply.result)
    if (path) fail(`invalid ${method} result at ${path}`)
  }
  if (reply.ok && !validSuccessResult(method, reply.result)) fail(`invalid ${method} result`)
  return reply as Reply<M>
}

export const parseNativeEvent = (value: unknown): NativeEvent => {
  const object = record(value) ? value : fail('invalid native event envelope')
  if (encodedJsonBytes(object) > MOBILE_MAX_MESSAGE_BYTES || !exactKeys(object, ['protocolVersion', 'sessionId', 'sequence', 'type', 'payload']) || object.protocolVersion !== 1 || !(object.sessionId === null || text(object.sessionId, 128)) || !Number.isSafeInteger(object.sequence) || (object.sequence as number) < 0 || !['session.updated', 'diagnostics.updated', 'appBuild.updated', 'permissions.updated', 'location.updated', 'heartRate.updated', 'metrics.updated', 'observations.appended', 'recording.issue'].includes(object.type as string) || !record(object.payload)) fail('invalid native event envelope')
  const path = nativeEventPayloadValidationPath(object.type, object.payload)
  if (path) fail(`invalid native event payload: type=${object.type} path=${path}`)
  return object as unknown as NativeEvent
}

const isSafeRelativePath = (path: string) => path.length <= 240 && !path.startsWith('/') && !/[\\%?#\u0000-\u001f\u007f]/.test(path) && path.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
const isAllowedDownloadUrl = (raw: string) => { try { return new URL(raw).protocol === 'https:' } catch { return false } }
const isAllowedDevUrl = (raw: string) => { try { const url = new URL(raw); return (url.protocol === 'http:' || url.protocol === 'https:') && url.username === '' && url.password === '' && url.pathname === '/' && url.search === '' && url.hash === '' } catch { return false } }

export const parseBuildManifest = (value: unknown): BuildManifest => {
  const object = record(value) ? value : fail('invalid manifest shape')
  if (!exactKeys(object, ['formatVersion', 'buildId', 'createdAt', 'uiEntryPath', 'engineEntryPath', 'engineBuildId', 'bridgeProtocol', 'engineApi', 'checkpointSchemaVersion', 'requiredCapabilities', 'files'])) fail('invalid manifest shape')
  if (object.formatVersion !== 1 || typeof object.buildId !== 'string' || !idPattern.test(object.buildId) || !iso(object.createdAt) || typeof object.engineBuildId !== 'string' || !idPattern.test(object.engineBuildId) || object.checkpointSchemaVersion !== 1) fail('invalid manifest identity/version')
  if (!record(object.bridgeProtocol) || !exactKeys(object.bridgeProtocol, ['min', 'max']) || object.bridgeProtocol.min !== 1 || object.bridgeProtocol.max !== 1 || !record(object.engineApi) || !exactKeys(object.engineApi, ['min', 'max']) || object.engineApi.min !== 1 || object.engineApi.max !== 1) fail('incompatible manifest APIs')
  if (!Array.isArray(object.requiredCapabilities) || !object.requiredCapabilities.every((item: unknown) => capabilities.has(item as Capability))) fail('unknown required capability')
  if (!Array.isArray(object.files) || object.files.length === 0 || object.files.length > 1024) fail('invalid manifest file count')
  const manifestFiles = object.files as unknown[]
  const paths = new Set<string>(); let total = 0
  for (const item of manifestFiles) {
    const file = record(item) ? item : fail('invalid manifest file')
    if (!exactKeys(file, ['path', 'role', 'sizeBytes', 'sha256']) || typeof file.path !== 'string' || !isSafeRelativePath(file.path) || paths.has(file.path) || !['ui', 'engine', 'asset'].includes(file.role as string) || !Number.isSafeInteger(file.sizeBytes) || (file.sizeBytes as number) <= 0 || (file.sizeBytes as number) > 32 * 1024 * 1024 || typeof file.sha256 !== 'string' || !hashPattern.test(file.sha256)) fail('invalid manifest file')
    paths.add(file.path as string); total += file.sizeBytes as number
  }
  if (total > 64 * 1024 * 1024 || typeof object.uiEntryPath !== 'string' || typeof object.engineEntryPath !== 'string' || !paths.has(object.uiEntryPath) || !paths.has(object.engineEntryPath)) fail('manifest entry missing or total too large')
  const files = manifestFiles as Array<Record<string, unknown>>
  if (files.find((item) => item.path === object.uiEntryPath)?.role !== 'ui' || files.find((item) => item.path === object.engineEntryPath)?.role !== 'engine') fail('manifest entry role mismatch')
  return object as unknown as BuildManifest
}
