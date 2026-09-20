export const MOBILE_PROTOCOL_VERSION = 1 as const
export const MOBILE_BRIDGE_HANDLER = 'workoutAnalyze' as const
export const MOBILE_NATIVE_RECEIVER = 'WorkoutAnalyzeNative' as const
export const MOBILE_MAX_MESSAGE_BYTES = 256 * 1024

export type Capability =
  | 'bridge.ping'
  | 'session.snapshot'
  | 'permissions.status'
  | 'permissions.request'
  | 'bridge.snapshot'
  | 'location.status'
  | 'location.start'
  | 'location.stop'
  | 'location.read'
  | 'heartRate.status'
  | 'heartRate.scan'
  | 'heartRate.stopScan'
  | 'heartRate.connect'
  | 'heartRate.disconnect'
  | 'heartRate.read'
  | 'diagnostics.snapshot'
  | 'diagnostics.runChecks'
  | 'diagnostics.export'
  | 'appBuild.status'
  | 'appBuild.download'
  | 'appBuild.activate'
  | 'appBuild.rollback'
  | 'devSource.configure'
  | 'ui.reload'
  | 'workout.start'
  | 'workout.pause'
  | 'workout.resume'
  | 'workout.finish'
  | 'workout.recover'
  | 'workout.export'
  | 'observations.subscribe'
  | 'observations.unsubscribe'
  | 'observations.read'
  | 'archive.list'
  | 'archive.detail'
  | 'journal.read'

export const PHASE1_BASE_CAPABILITIES: ReadonlyArray<Capability> = [
  'bridge.ping', 'session.snapshot', 'permissions.status',
  'diagnostics.snapshot', 'diagnostics.runChecks', 'diagnostics.export',
  'appBuild.status', 'appBuild.download', 'appBuild.activate',
  'appBuild.rollback', 'devSource.configure', 'ui.reload',
]

export const PHASE1_SENSOR_CAPABILITIES: ReadonlyArray<Capability> = [
  'permissions.request', 'bridge.snapshot',
  'location.status', 'location.start', 'location.stop', 'location.read',
  'heartRate.status', 'heartRate.scan', 'heartRate.stopScan',
  'heartRate.connect', 'heartRate.disconnect', 'heartRate.read',
]

export const PHASE1_CAPABILITIES: ReadonlyArray<Capability> = [...PHASE1_BASE_CAPABILITIES, ...PHASE1_SENSOR_CAPABILITIES]

export const RECORDING_CAPABILITIES: ReadonlyArray<Capability> = [
  'workout.start', 'workout.pause', 'workout.resume', 'workout.finish',
  'workout.recover', 'workout.export', 'observations.subscribe',
  'observations.unsubscribe', 'observations.read',
]

/** Saved-workout discovery is independently advertised so older recorder hosts remain available. */
export const ARCHIVE_CAPABILITIES: ReadonlyArray<Capability> = ['archive.list', 'archive.detail']
/** Canonical raw-event access is independent of recorder mutation and archive discovery. */
export const JOURNAL_CAPABILITIES: ReadonlyArray<Capability> = ['journal.read']

export const MOBILE_CAPABILITIES: ReadonlyArray<Capability> = [...PHASE1_CAPABILITIES, ...RECORDING_CAPABILITIES, ...ARCHIVE_CAPABILITIES, ...JOURNAL_CAPABILITIES]

export type MobileMethod = 'bridge.hello' | Capability
export type StatusKind = 'ok' | 'waiting' | 'unavailable' | 'error'
export type Freshness = 'fresh' | 'stale' | 'never'

export interface StatusRow<T = Readonly<Record<string, unknown>>> {
  readonly id: string
  readonly label: string
  readonly status: StatusKind
  readonly reason: string
  readonly observedAt: string | null
  readonly freshness: Freshness
  readonly details: T
}

export interface CommandParams {
  readonly 'bridge.hello': { readonly clientName: string; readonly clientVersion: string; readonly supportedProtocolVersions: readonly [1] }
  readonly 'bridge.ping': { readonly nonce: string }
  readonly 'session.snapshot': Record<string, never>
  readonly 'permissions.status': Record<string, never>
  readonly 'permissions.request': { readonly permission: 'locationWhenInUse' | 'bluetooth' }
  readonly 'bridge.snapshot': Record<string, never>
  readonly 'location.status': Record<string, never>
  readonly 'location.start': { readonly desiredAccuracy: 'best' | 'nearestTenMeters' | 'hundredMeters'; readonly distanceFilterM: number; readonly backgroundMode: 'foregroundOnly' | 'continueWhenBackgrounded'; readonly maxDurationSeconds: number }
  readonly 'location.stop': { readonly probeId: string }
  readonly 'location.read': { readonly probeId: string; readonly afterCursor: number | null; readonly limit: number }
  readonly 'heartRate.status': Record<string, never>
  readonly 'heartRate.scan': { readonly durationSeconds: number }
  readonly 'heartRate.stopScan': Record<string, never>
  readonly 'heartRate.connect': { readonly deviceId: string }
  readonly 'heartRate.disconnect': { readonly connectionId: string }
  readonly 'heartRate.read': { readonly connectionId: string; readonly afterCursor: number | null; readonly limit: number }
  readonly 'diagnostics.snapshot': Record<string, never>
  readonly 'diagnostics.runChecks': { readonly checks: readonly DiagnosticCheckId[] | null }
  readonly 'diagnostics.export': { readonly includeWorkoutObservations: boolean }
  readonly 'appBuild.status': Record<string, never>
  readonly 'appBuild.download': { readonly manifestUrl: string }
  readonly 'appBuild.activate': { readonly buildId: string }
  readonly 'appBuild.rollback': { readonly target: 'previous' | 'bundled' }
  readonly 'devSource.configure': { readonly url: string | null }
  readonly 'ui.reload': Record<string, never>
  readonly 'workout.start': { readonly expectedRevision: number; readonly sport: 'cycling'; readonly startPolicy: 'immediate' | 'waitForReliableLocation' }
  readonly 'workout.pause': SessionMutationParams
  readonly 'workout.resume': SessionMutationParams
  readonly 'workout.finish': SessionMutationParams
  readonly 'workout.recover': SessionMutationParams & { readonly action: 'resume' | 'finish' }
  readonly 'workout.export': { readonly sessionId: string; readonly format: 'workoutBundleV1' | 'gpx' }
  readonly 'observations.subscribe': { readonly sessionId: string; readonly afterSequence: number | null; readonly maxBatchSize: number }
  readonly 'observations.unsubscribe': { readonly subscriptionId: string }
  readonly 'observations.read': { readonly sessionId: string; readonly afterSequence: number | null; readonly limit: number }
  readonly 'archive.list': { readonly afterCursor: string | null; readonly limit: number }
  readonly 'archive.detail': { readonly savedWorkoutId: string; readonly afterSequence: number | null; readonly limit: number }
  readonly 'journal.read': { readonly sessionId: string; readonly afterJournalSequence: number | null; readonly limit: number }
}

export interface SessionMutationParams { readonly sessionId: string; readonly expectedRevision: number }

export interface Command<M extends MobileMethod = MobileMethod> {
  readonly protocolVersion: 1
  readonly requestId: string
  readonly method: M
  readonly params: CommandParams[M]
}

export type SessionState = 'idle' | 'recording' | 'paused' | 'finished' | 'interrupted'
interface SessionSnapshotBase {
  readonly sessionId: string | null
  readonly state: SessionState
  readonly revision: number
  readonly durableSequence: number
  readonly capturedAt: string
}

export interface UnavailableSessionSnapshot extends SessionSnapshotBase {
  readonly recorderAvailability: 'unavailable'
  readonly recorderUnavailableReason: string
  readonly pinnedEngine: null
}

export interface AvailableSessionSnapshot extends SessionSnapshotBase {
  readonly recorderAvailability: 'available'
  readonly recorderUnavailableReason: ''
  readonly pinnedEngine: { readonly buildId: string; readonly apiVersion: 1; readonly checkpointSchemaVersion: 1 } | null
  readonly sport: 'cycling' | null
  readonly startedAt: string | null
  readonly finishedAt: string | null
  readonly lastTransitionAt: string | null
  readonly observationSequence: number
  readonly recovery: { readonly required: boolean; readonly interruptionStartedAt: string | null; readonly reason: string | null }
  readonly metrics: WorkoutMetrics
}

export type SessionSnapshot = UnavailableSessionSnapshot | AvailableSessionSnapshot

export interface WorkoutMetrics {
  readonly activeDurationMs: number
  readonly elapsedDurationMs: number
  readonly distanceM: number
  readonly averageSpeedMps: number | null
  readonly currentSpeedMps: number | null
  readonly currentSpeedObservedAt: string | null
  readonly altitudeM: number | null
  readonly elevationGainM: number
  readonly heartRateBpm: number | null
  readonly heartRateObservedAt: string | null
  readonly locationQuality: 'waiting' | 'good' | 'poor' | 'stale'
  readonly heartRateQuality: 'unconfigured' | 'connecting' | 'live' | 'stale' | 'disconnected'
}

export interface RecorderLocationObservation extends Omit<LocationObservation, 'cursor'> {
  readonly kind: 'location'
  readonly sessionId: string
  readonly sequence: number
  readonly monotonicTimestampMs: number | null
  readonly provenance?: ObservationProvenance
}

export interface RecorderHeartRateObservation extends Omit<HeartRateMeasurement, 'cursor'> {
  readonly kind: 'heartRate'
  readonly sessionId: string
  readonly sequence: number
  readonly sourceTimestamp: string
  readonly monotonicTimestampMs: number | null
  readonly provenance?: ObservationProvenance
}

/** A delivered characteristic that could not be normalized as a Heart Rate Measurement. */
export interface RecorderHeartRatePacketObservation {
  readonly kind: 'heartRatePacket'
  readonly sessionId: string
  readonly sequence: number
  readonly connectionId: string
  readonly deviceId: string
  readonly sourceTimestamp: string
  readonly receivedAt: string
  readonly monotonicTimestampMs: number | null
  readonly rawCharacteristicBase64: string
  readonly parseError: string
  readonly provenance?: ObservationProvenance
}

export interface RecorderHeartRateConnectionObservation {
  readonly kind: 'heartRateConnection'
  readonly sessionId: string
  readonly sequence: number
  readonly connectionId: string | null
  readonly deviceId: string | null
  readonly sourceTimestamp: string
  readonly receivedAt: string
  readonly monotonicTimestampMs: number | null
  readonly event: 'connecting' | 'connected' | 'disconnected' | 'reconnecting' | 'failed'
  readonly reason: string
  readonly provenance?: ObservationProvenance
}

export interface RecorderHostLifecycleObservation {
  readonly kind: 'hostLifecycle'
  readonly sessionId: string
  readonly sequence: number
  readonly sourceTimestamp: string
  readonly receivedAt: string
  readonly monotonicTimestampMs: number | null
  readonly event: 'didBecomeActive' | 'willResignActive' | 'didEnterBackground' | 'willEnterForeground' | 'protectedDataWillBecomeUnavailable' | 'protectedDataDidBecomeAvailable'
  readonly applicationState: 'active' | 'inactive' | 'background' | 'unknown'
  readonly protectedDataAvailable: boolean
  readonly provenance?: ObservationProvenance
}

export interface RecorderTransitionObservation {
  readonly kind: 'transition'
  readonly sessionId: string
  readonly sequence: number
  readonly transitionId: string
  readonly from: SessionState
  readonly to: SessionState
  readonly sourceTimestamp: string
  readonly monotonicTimestampMs: number | null
  readonly cause: 'user' | 'recovery' | 'systemInterruption'
  readonly receivedAt?: string
  readonly provenance?: ObservationProvenance
}

export interface RecorderGapObservation {
  readonly kind: 'gap'
  readonly sessionId: string
  readonly sequence: number
  readonly sourceTimestamp: string
  readonly monotonicTimestampMs: number | null
  readonly startedAt: string
  readonly endedAt: string
  readonly reason: 'processRestart' | 'osTermination' | 'reboot' | 'sensorDeliveryGap' | 'unknown'
  readonly receivedAt?: string
  readonly provenance?: ObservationProvenance
}

export interface ObservationProvenance {
  readonly origin: 'liveNative' | 'recordingReplay' | 'syntheticFixture'
  /** Stable provider/peripheral identifier where one exists; null is explicit absence. */
  readonly sourceId: string | null
  /** Identifies the process/clock domain for monotonicTimestampMs; null when unavailable. */
  readonly monotonicClockId: string | null
  /** Present only for replay, pointing back to the immutable captured row. */
  readonly lineage: { readonly savedWorkoutId: string; readonly sessionId: string; readonly sequence: number } | null
  /** Canonical journal input used to produce this normalized observation, when applicable. */
  readonly rawEvent?: { readonly eventId: string; readonly journalSequence: number }
}

/** The append-only, pre-decode recording source of truth. Payload is deliberately opaque. */
export interface RawWorkoutEvent {
  readonly formatVersion: 1
  readonly eventId: string
  readonly sessionId: string
  readonly journalSequence: number
  readonly kind: string
  readonly sourceTimestamp: string | null
  readonly receivedAt: string
  readonly monotonicTimestampMs: number | null
  readonly provenance: ObservationProvenance
  readonly batch: { readonly batchId: string; readonly index: number; readonly size: number } | null
  readonly payload: { readonly encoding: 'json'; readonly value: unknown } | { readonly encoding: 'base64'; readonly value: string }
}

export interface RawWorkoutEventPage {
  readonly afterJournalSequence: number | null
  readonly items: readonly RawWorkoutEvent[]
  readonly nextJournalSequence: number | null
  readonly oldestAvailableJournalSequence: number | null
  readonly latestJournalSequence: number
  readonly hasMore: boolean
  readonly droppedBeforeJournalSequence: false
}

export type RecorderObservation = RecorderLocationObservation | RecorderHeartRateObservation | RecorderHeartRatePacketObservation | RecorderHeartRateConnectionObservation | RecorderHostLifecycleObservation | RecorderTransitionObservation | RecorderGapObservation

export interface ObservationPage {
  readonly items: readonly RecorderObservation[]
  readonly nextSequence: number | null
  readonly oldestAvailableSequence: number | null
  readonly latestDurableSequence: number
  readonly hasMore: boolean
  readonly droppedBeforeSequence: boolean
}

export interface PermissionStatus {
  readonly location: StatusRow<{ readonly authorization: 'notDetermined' | 'denied' | 'restricted' | 'whenInUse' | 'always'; readonly precise: boolean | null }>
  readonly bluetooth: StatusRow<{ readonly authorization: 'notDetermined' | 'denied' | 'restricted' | 'allowed'; readonly power: 'unknown' | 'unsupported' | 'unauthorized' | 'poweredOff' | 'poweredOn' }>
  readonly promptsAutomatically: false
}

export interface LocationObservation {
  readonly cursor: number
  readonly source: 'coreLocation'
  readonly sourceTimestamp: string
  readonly receivedAt: string
  readonly latitudeDegrees: number
  readonly longitudeDegrees: number
  readonly horizontalAccuracyM: number
  readonly altitudeM: number | null
  readonly verticalAccuracyM: number | null
  readonly speedMps: number | null
  readonly speedAccuracyMps: number | null
  readonly courseDegrees: number | null
  readonly courseAccuracyDegrees: number | null
  readonly floorLevel: number | null
  readonly isSimulatedBySoftware: boolean | null
  readonly isProducedByAccessory: boolean | null
  /** iOS 15+ CLLocation. Omitted by older shells; null means unavailable on a captured fix. */
  readonly ellipsoidalAltitudeM?: number | null
}

export interface LocationProbeStatus {
  readonly availability: 'available' | 'unavailable'
  readonly state: 'inactive' | 'starting' | 'active' | 'stopping' | 'error'
  readonly reason: string
  readonly probeId: string | null
  readonly startedAt: string | null
  readonly expiresAt: string | null
  readonly backgroundMode: 'foregroundOnly' | 'continueWhenBackgrounded' | null
  readonly backgroundDeliveryActive: boolean
  readonly appLifecycle: 'active' | 'inactive' | 'background'
  readonly receivedCount: number
  readonly acceptedCount: number
  readonly rejectedCount: number
  readonly lastRejectionReason: string | null
  readonly retainedCount: number
  readonly oldestCursor: number | null
  readonly latestCursor: number | null
  readonly latestObservation: LocationObservation | null
  readonly lastError: string | null
}

export interface HeartRateDevice {
  readonly deviceId: string
  readonly name: string | null
  readonly rssi: number | null
  readonly lastSeenAt: string
  readonly isConnectable: boolean | null
  readonly advertisedServiceUuids: readonly string[]
}

export interface HeartRateMeasurement {
  readonly cursor: number
  readonly connectionId: string
  readonly deviceId: string
  readonly receivedAt: string
  readonly bpm: number
  readonly valueFormat: 'uint8' | 'uint16'
  readonly sensorContact: 'unsupported' | 'notDetected' | 'detected'
  readonly energyExpendedKJ: number | null
  readonly rrIntervalsSeconds: readonly number[]
  readonly rawFlags: number
  /** Exact bytes delivered for the BLE Heart Rate Measurement characteristic. */
  readonly rawCharacteristicBase64?: string
}

export interface SavedWorkoutSummary {
  readonly savedWorkoutId: string
  readonly sessionId: string
  readonly sport: 'cycling'
  readonly startedAt: string
  readonly finishedAt: string
  readonly durationMs: number
  readonly observationCount: number
  readonly latestSequence: number
  readonly metrics: WorkoutMetrics
  readonly hasFatalIssue: boolean
  readonly rawEventCount?: number
  readonly lastJournalSequence?: number
}

export interface ArchiveListPage {
  /** Echoes the requested cursor; null starts a snapshot-stable newest-first traversal. */
  readonly afterCursor: string | null
  readonly items: readonly SavedWorkoutSummary[]
  readonly nextCursor: string | null
  readonly hasMore: boolean
  readonly snapshotAt: string
}

export interface ArchiveObservationPage extends ObservationPage {
  /** Echoes the exclusive raw sequence cursor used for this page. */
  readonly afterSequence: number | null
}

export interface SavedWorkoutDetail {
  readonly summary: SavedWorkoutSummary
  readonly pinnedEngine: { readonly buildId: string; readonly apiVersion: 1; readonly checkpointSchemaVersion: 1 }
  readonly recordingFormatVersion: 1
  readonly units: 'SI'
  readonly derivation: {
    readonly algorithmId: string
    readonly engineBuildId: string
    readonly configId: string
    readonly firstInputSequence: number | null
    readonly lastInputSequence: number
  }
  readonly observations: ArchiveObservationPage
}

export interface HeartRateStatus {
  readonly availability: 'available' | 'unavailable'
  readonly state: 'inactive' | 'scanning' | 'connecting' | 'connected' | 'disconnecting' | 'error'
  readonly reason: string
  readonly scanEndsAt: string | null
  readonly devices: readonly HeartRateDevice[]
  readonly connectionId: string | null
  readonly connectedDevice: HeartRateDevice | null
  readonly backgroundModeConfigured: boolean
  readonly appLifecycle: 'active' | 'inactive' | 'background'
  readonly receivedCount: number
  readonly parseErrorCount: number
  readonly reconnectCount: number
  readonly retainedCount: number
  readonly oldestCursor: number | null
  readonly latestCursor: number | null
  readonly latestMeasurement: HeartRateMeasurement | null
  readonly lastError: string | null
}

export interface CursorPage<T> {
  readonly items: readonly T[]
  readonly nextCursor: number | null
  readonly oldestAvailableCursor: number | null
  readonly hasMore: boolean
  readonly droppedBeforeCursor: boolean
}

export interface HelloResult {
  readonly shellVersion: string
  readonly protocolVersion: 1
  readonly engineApiVersion: 1
  readonly checkpointSchemaVersion: 1
  readonly capabilities: readonly Capability[]
  readonly unavailableCapabilities: ReadonlyArray<{ readonly capability: 'workout.recorder' | 'sensors.location' | 'sensors.bluetoothHeartRate'; readonly reason: string }>
}

export interface DiagnosticSnapshot {
  readonly capturedAt: string
  readonly rows: readonly StatusRow[]
  readonly eventSequence: number
}

export type DiagnosticCheckId = 'bridgePing' | 'capabilityCompatibility' | 'diagnosticStorage' | 'engineFixture'
export interface DiagnosticCheckResult {
  readonly id: DiagnosticCheckId
  readonly outcome: 'pass' | 'fail' | 'notRun'
  readonly reason: string
  readonly startedAt: string | null
  readonly finishedAt: string | null
  readonly namespace: 'diagnostics' | 'engine-fixture'
}

export interface BuildSummary {
  readonly buildId: string
  readonly source: 'bundled' | 'installed'
  readonly engineBuildId: string
}
export interface AppBuildStatus {
  readonly active: BuildSummary
  readonly previous: BuildSummary | null
  readonly bundled: BuildSummary
  readonly downloaded: readonly BuildSummary[]
  readonly pendingActivationBuildId: string | null
  readonly lastFailure: string | null
}

export interface CommandResults {
  readonly 'bridge.hello': HelloResult
  readonly 'bridge.ping': { readonly nonce: string; readonly nativeReceivedAt: string; readonly nativeSentAt: string }
  readonly 'session.snapshot': SessionSnapshot
  readonly 'permissions.status': PermissionStatus
  readonly 'permissions.request': PermissionStatus
  readonly 'bridge.snapshot': { readonly sequence: number; readonly session: SessionSnapshot; readonly permissions: PermissionStatus; readonly location: LocationProbeStatus; readonly heartRate: HeartRateStatus; readonly diagnostics: DiagnosticSnapshot; readonly appBuild: AppBuildStatus }
  readonly 'location.status': LocationProbeStatus
  readonly 'location.start': LocationProbeStatus
  readonly 'location.stop': LocationProbeStatus
  readonly 'location.read': CursorPage<LocationObservation>
  readonly 'heartRate.status': HeartRateStatus
  readonly 'heartRate.scan': HeartRateStatus
  readonly 'heartRate.stopScan': HeartRateStatus
  readonly 'heartRate.connect': HeartRateStatus
  readonly 'heartRate.disconnect': HeartRateStatus
  readonly 'heartRate.read': CursorPage<HeartRateMeasurement>
  readonly 'diagnostics.snapshot': DiagnosticSnapshot
  readonly 'diagnostics.runChecks': { readonly results: readonly DiagnosticCheckResult[]; readonly workoutStateUnchanged: true }
  readonly 'diagnostics.export': { readonly presented: boolean; readonly exportId: string }
  readonly 'appBuild.status': AppBuildStatus
  readonly 'appBuild.download': { readonly build: BuildSummary; readonly activated: false }
  readonly 'appBuild.activate': { readonly active: BuildSummary; readonly reloadRequired: true }
  readonly 'appBuild.rollback': { readonly active: BuildSummary; readonly reloadRequired: true }
  readonly 'devSource.configure': { readonly source: { readonly kind: 'bundled' } | { readonly kind: 'development'; readonly url: string }; readonly reloadRequired: true }
  readonly 'ui.reload': { readonly accepted: true }
  readonly 'workout.start': SessionSnapshot
  readonly 'workout.pause': SessionSnapshot
  readonly 'workout.resume': SessionSnapshot
  readonly 'workout.finish': { readonly session: SessionSnapshot; readonly savedWorkoutId: string }
  readonly 'workout.recover': SessionSnapshot | { readonly session: SessionSnapshot; readonly savedWorkoutId: string }
  readonly 'workout.export': { readonly exportId: string; readonly presented: boolean; readonly format: 'workoutBundleV1' | 'gpx' }
  readonly 'observations.subscribe': { readonly subscriptionId: string; readonly afterSequence: number; readonly latestDurableSequence: number }
  readonly 'observations.unsubscribe': { readonly removed: true }
  readonly 'observations.read': ObservationPage
  readonly 'archive.list': ArchiveListPage
  readonly 'archive.detail': SavedWorkoutDetail
  readonly 'journal.read': RawWorkoutEventPage
}

export type BridgeErrorCode = 'invalidRequest' | 'unsupportedVersion' | 'unsupportedMethod' | 'invalidState' | 'revisionConflict' | 'permissionDenied' | 'sensorUnavailable' | 'storageFailure' | 'incompatibleBuild' | 'downloadFailure' | 'internalError'
export interface BridgeError { readonly code: BridgeErrorCode; readonly message: string; readonly retryable: boolean; readonly details?: Readonly<Record<string, unknown>> }
export type Reply<M extends MobileMethod = MobileMethod> =
  | { readonly protocolVersion: 1; readonly requestId: string; readonly ok: true; readonly result: CommandResults[M] }
  | { readonly protocolVersion: 1; readonly requestId: string; readonly ok: false; readonly error: BridgeError }

export interface NativeEvent {
  readonly protocolVersion: 1
  readonly sessionId: string | null
  readonly sequence: number
  readonly type: 'session.updated' | 'diagnostics.updated' | 'appBuild.updated' | 'permissions.updated' | 'location.updated' | 'heartRate.updated' | 'metrics.updated' | 'observations.appended' | 'recording.issue'
  readonly payload: SessionSnapshot | DiagnosticSnapshot | AppBuildStatus | PermissionStatus | LocationProbeStatus | HeartRateStatus | WorkoutMetrics | ObservationPage | RecordingIssue
}

export interface RecordingIssue {
  readonly issueId: string
  readonly severity: 'warning' | 'fatal'
  readonly code: 'poorLocation' | 'locationStale' | 'storageFailure' | 'engineFailure' | 'interrupted'
  readonly message: string
  readonly observedAt: string
  readonly durableSequence: number
}

export interface BuildManifest {
  readonly formatVersion: 1
  readonly buildId: string
  readonly createdAt: string
  readonly uiEntryPath: string
  readonly engineEntryPath: string
  readonly engineBuildId: string
  readonly bridgeProtocol: { readonly min: 1; readonly max: 1 }
  readonly engineApi: { readonly min: 1; readonly max: 1 }
  readonly checkpointSchemaVersion: 1
  readonly requiredCapabilities: readonly Capability[]
  readonly files: ReadonlyArray<{ readonly path: string; readonly role: 'ui' | 'engine' | 'asset'; readonly sizeBytes: number; readonly sha256: string }>
}
