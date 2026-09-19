import {
  MOBILE_MAX_MESSAGE_BYTES, MOBILE_PROTOCOL_VERSION, PHASE1_CAPABILITIES,
  type BuildManifest, type Capability, type Command, type DiagnosticCheckId,
  type MobileMethod, type NativeEvent, type Reply, type StatusRow,
} from './contracts'

const methods = new Set<MobileMethod>(['bridge.hello', ...PHASE1_CAPABILITIES])
const capabilities = new Set<Capability>(PHASE1_CAPABILITIES)
const checkIds = new Set<DiagnosticCheckId>(['bridgePing', 'capabilityCompatibility', 'diagnosticStorage', 'engineFixture'])
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const hashPattern = /^[a-f0-9]{64}$/
const errorCodes = new Set(['invalidRequest', 'unsupportedVersion', 'unsupportedMethod', 'invalidState', 'permissionDenied', 'sensorUnavailable', 'storageFailure', 'incompatibleBuild', 'downloadFailure', 'internalError'])
const iso = (value: unknown) => typeof value === 'string' && !Number.isNaN(Date.parse(value))
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every((key) => keys.includes(key))
const empty = (value: unknown) => record(value) && Object.keys(value).length === 0
const text = (value: unknown, max = 2048) => typeof value === 'string' && value.length > 0 && value.length <= max
const fail = (message: string): never => { throw new TypeError(message) }

const validateParams = (method: MobileMethod, params: unknown): boolean => {
  if (!record(params)) return false
  switch (method) {
    case 'bridge.hello': return exactKeys(params, ['clientName', 'clientVersion', 'supportedProtocolVersions']) && text(params.clientName, 64) && text(params.clientVersion, 64) && Array.isArray(params.supportedProtocolVersions) && params.supportedProtocolVersions.length === 1 && params.supportedProtocolVersions[0] === 1
    case 'bridge.ping': return exactKeys(params, ['nonce']) && text(params.nonce, 128)
    case 'diagnostics.runChecks': return exactKeys(params, ['checks']) && (params.checks === null || (Array.isArray(params.checks) && params.checks.length <= 4 && params.checks.every((id) => checkIds.has(id as DiagnosticCheckId))))
    case 'diagnostics.export': return exactKeys(params, ['includeWorkoutObservations']) && typeof params.includeWorkoutObservations === 'boolean'
    case 'appBuild.download': return exactKeys(params, ['manifestUrl']) && text(params.manifestUrl, 2048) && isAllowedDownloadUrl(params.manifestUrl as string)
    case 'appBuild.activate': return exactKeys(params, ['buildId']) && typeof params.buildId === 'string' && idPattern.test(params.buildId)
    case 'appBuild.rollback': return exactKeys(params, ['target']) && (params.target === 'previous' || params.target === 'bundled')
    case 'devSource.configure': return exactKeys(params, ['url']) && (params.url === null || (typeof params.url === 'string' && isAllowedDevUrl(params.url)))
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
const sessionSnapshot = (value: unknown) => record(value) && exactKeys(value, ['sessionId', 'state', 'revision', 'durableSequence', 'recorderAvailability', 'recorderUnavailableReason', 'pinnedEngine', 'capturedAt']) && (value.sessionId === null || text(value.sessionId, 128)) && ['idle', 'recording', 'paused', 'finished', 'interrupted'].includes(value.state as string) && Number.isSafeInteger(value.revision) && (value.revision as number) >= 0 && Number.isSafeInteger(value.durableSequence) && (value.durableSequence as number) >= 0 && value.recorderAvailability === 'unavailable' && text(value.recorderUnavailableReason) && value.pinnedEngine === null && iso(value.capturedAt)
const diagnosticsSnapshot = (value: unknown) => record(value) && exactKeys(value, ['capturedAt', 'rows', 'eventSequence']) && iso(value.capturedAt) && Array.isArray(value.rows) && value.rows.every(statusRow) && Number.isSafeInteger(value.eventSequence) && (value.eventSequence as number) >= 0

const validSuccessResult = (method: MobileMethod, value: unknown): boolean => {
  if (!record(value)) return false
  switch (method) {
    case 'bridge.hello': {
      const unavailable = ['workout.recorder', 'sensors.location', 'sensors.bluetoothHeartRate']
      return exactKeys(value, ['shellVersion', 'protocolVersion', 'engineApiVersion', 'checkpointSchemaVersion', 'capabilities', 'unavailableCapabilities']) && text(value.shellVersion, 64) && value.protocolVersion === 1 && value.engineApiVersion === 1 && value.checkpointSchemaVersion === 1 && Array.isArray(value.capabilities) && value.capabilities.length === PHASE1_CAPABILITIES.length && new Set(value.capabilities).size === PHASE1_CAPABILITIES.length && value.capabilities.every((item) => capabilities.has(item as Capability)) && Array.isArray(value.unavailableCapabilities) && value.unavailableCapabilities.length === unavailable.length && new Set(value.unavailableCapabilities.map((item) => record(item) ? item.capability : null)).size === unavailable.length && value.unavailableCapabilities.every((item) => record(item) && exactKeys(item, ['capability', 'reason']) && unavailable.includes(item.capability as string) && text(item.reason))
    }
    case 'bridge.ping': return exactKeys(value, ['nonce', 'nativeReceivedAt', 'nativeSentAt']) && text(value.nonce, 128) && iso(value.nativeReceivedAt) && iso(value.nativeSentAt)
    case 'session.snapshot': return sessionSnapshot(value)
    case 'permissions.status': return exactKeys(value, ['location', 'bluetooth', 'promptsAutomatically']) && statusRow(value.location) && ['notDetermined', 'denied', 'restricted', 'whenInUse', 'always'].includes(value.location.details.authorization as string) && (value.location.details.precise === null || typeof value.location.details.precise === 'boolean') && statusRow(value.bluetooth) && ['notDetermined', 'denied', 'restricted', 'allowed'].includes(value.bluetooth.details.authorization as string) && ['unknown', 'unsupported', 'unauthorized', 'poweredOff', 'poweredOn'].includes(value.bluetooth.details.power as string) && value.promptsAutomatically === false
    case 'diagnostics.snapshot': return diagnosticsSnapshot(value)
    case 'diagnostics.runChecks': return exactKeys(value, ['results', 'workoutStateUnchanged']) && value.workoutStateUnchanged === true && Array.isArray(value.results) && value.results.every((item) => record(item) && exactKeys(item, ['id', 'outcome', 'reason', 'startedAt', 'finishedAt', 'namespace']) && checkIds.has(item.id as DiagnosticCheckId) && ['pass', 'fail', 'notRun'].includes(item.outcome as string) && text(item.reason) && (item.startedAt === null || iso(item.startedAt)) && (item.finishedAt === null || iso(item.finishedAt)) && ['diagnostics', 'engine-fixture'].includes(item.namespace as string))
    case 'diagnostics.export': return exactKeys(value, ['presented', 'exportId']) && typeof value.presented === 'boolean' && text(value.exportId, 128)
    case 'appBuild.status': return appBuildStatus(value)
    case 'appBuild.download': return exactKeys(value, ['build', 'activated']) && summary(value.build) && value.activated === false
    case 'appBuild.activate':
    case 'appBuild.rollback': return exactKeys(value, ['active', 'reloadRequired']) && summary(value.active) && value.reloadRequired === true
    case 'devSource.configure': return exactKeys(value, ['source', 'reloadRequired']) && value.reloadRequired === true && record(value.source) && ((value.source.kind === 'bundled' && exactKeys(value.source, ['kind'])) || (value.source.kind === 'development' && exactKeys(value.source, ['kind', 'url']) && typeof value.source.url === 'string' && isAllowedDevUrl(value.source.url)))
    case 'ui.reload': return exactKeys(value, ['accepted']) && value.accepted === true
  }
}

export const parseReply = <M extends MobileMethod>(method: M, value: unknown): Reply<M> => {
  const reply = parseReplyEnvelope(value)
  if (reply.ok && !validSuccessResult(method, reply.result)) fail(`invalid ${method} result`)
  return reply as Reply<M>
}

export const parseNativeEvent = (value: unknown): NativeEvent => {
  const object = record(value) ? value : fail('invalid native event envelope')
  if (encodedJsonBytes(object) > MOBILE_MAX_MESSAGE_BYTES || !exactKeys(object, ['protocolVersion', 'sessionId', 'sequence', 'type', 'payload']) || object.protocolVersion !== 1 || !(object.sessionId === null || text(object.sessionId, 128)) || !Number.isSafeInteger(object.sequence) || (object.sequence as number) < 0 || !['session.updated', 'diagnostics.updated', 'appBuild.updated'].includes(object.type as string) || !record(object.payload)) fail('invalid native event envelope')
  if ((object.type === 'session.updated' && !sessionSnapshot(object.payload)) || (object.type === 'diagnostics.updated' && !diagnosticsSnapshot(object.payload)) || (object.type === 'appBuild.updated' && !appBuildStatus(object.payload))) fail('invalid native event payload')
  return object as unknown as NativeEvent
}

const isSafeRelativePath = (path: string) => path.length <= 240 && !path.startsWith('/') && !path.includes('\\') && path.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
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
