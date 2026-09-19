export const MOBILE_PROTOCOL_VERSION = 1 as const
export const MOBILE_BRIDGE_HANDLER = 'workoutAnalyze' as const
export const MOBILE_NATIVE_RECEIVER = 'WorkoutAnalyzeNative' as const
export const MOBILE_MAX_MESSAGE_BYTES = 256 * 1024

export type Capability =
  | 'bridge.ping'
  | 'session.snapshot'
  | 'permissions.status'
  | 'diagnostics.snapshot'
  | 'diagnostics.runChecks'
  | 'diagnostics.export'
  | 'appBuild.status'
  | 'appBuild.download'
  | 'appBuild.activate'
  | 'appBuild.rollback'
  | 'devSource.configure'
  | 'ui.reload'

export const PHASE1_CAPABILITIES: ReadonlyArray<Capability> = [
  'bridge.ping', 'session.snapshot', 'permissions.status',
  'diagnostics.snapshot', 'diagnostics.runChecks', 'diagnostics.export',
  'appBuild.status', 'appBuild.download', 'appBuild.activate',
  'appBuild.rollback', 'devSource.configure', 'ui.reload',
]

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
  readonly 'diagnostics.snapshot': Record<string, never>
  readonly 'diagnostics.runChecks': { readonly checks: readonly DiagnosticCheckId[] | null }
  readonly 'diagnostics.export': { readonly includeWorkoutObservations: boolean }
  readonly 'appBuild.status': Record<string, never>
  readonly 'appBuild.download': { readonly manifestUrl: string }
  readonly 'appBuild.activate': { readonly buildId: string }
  readonly 'appBuild.rollback': { readonly target: 'previous' | 'bundled' }
  readonly 'devSource.configure': { readonly url: string | null }
  readonly 'ui.reload': Record<string, never>
}

export interface Command<M extends MobileMethod = MobileMethod> {
  readonly protocolVersion: 1
  readonly requestId: string
  readonly method: M
  readonly params: CommandParams[M]
}

export type SessionState = 'idle' | 'recording' | 'paused' | 'finished' | 'interrupted'
export interface SessionSnapshot {
  readonly sessionId: string | null
  readonly state: SessionState
  readonly revision: number
  readonly durableSequence: number
  readonly recorderAvailability: 'unavailable'
  readonly recorderUnavailableReason: string
  readonly pinnedEngine: { readonly buildId: string; readonly apiVersion: 1; readonly checkpointSchemaVersion: 1 } | null
  readonly capturedAt: string
}

export interface PermissionStatus {
  readonly location: StatusRow<{ readonly authorization: 'notDetermined' | 'denied' | 'restricted' | 'whenInUse' | 'always'; readonly precise: boolean | null }>
  readonly bluetooth: StatusRow<{ readonly authorization: 'notDetermined' | 'denied' | 'restricted' | 'allowed'; readonly power: 'unknown' | 'unsupported' | 'unauthorized' | 'poweredOff' | 'poweredOn' }>
  readonly promptsAutomatically: false
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
  readonly 'diagnostics.snapshot': DiagnosticSnapshot
  readonly 'diagnostics.runChecks': { readonly results: readonly DiagnosticCheckResult[]; readonly workoutStateUnchanged: true }
  readonly 'diagnostics.export': { readonly presented: boolean; readonly exportId: string }
  readonly 'appBuild.status': AppBuildStatus
  readonly 'appBuild.download': { readonly build: BuildSummary; readonly activated: false }
  readonly 'appBuild.activate': { readonly active: BuildSummary; readonly reloadRequired: true }
  readonly 'appBuild.rollback': { readonly active: BuildSummary; readonly reloadRequired: true }
  readonly 'devSource.configure': { readonly source: { readonly kind: 'bundled' } | { readonly kind: 'development'; readonly url: string }; readonly reloadRequired: true }
  readonly 'ui.reload': { readonly accepted: true }
}

export type BridgeErrorCode = 'invalidRequest' | 'unsupportedVersion' | 'unsupportedMethod' | 'invalidState' | 'permissionDenied' | 'sensorUnavailable' | 'storageFailure' | 'incompatibleBuild' | 'downloadFailure' | 'internalError'
export interface BridgeError { readonly code: BridgeErrorCode; readonly message: string; readonly retryable: boolean; readonly details?: Readonly<Record<string, unknown>> }
export type Reply<M extends MobileMethod = MobileMethod> =
  | { readonly protocolVersion: 1; readonly requestId: string; readonly ok: true; readonly result: CommandResults[M] }
  | { readonly protocolVersion: 1; readonly requestId: string; readonly ok: false; readonly error: BridgeError }

export interface NativeEvent {
  readonly protocolVersion: 1
  readonly sessionId: string | null
  readonly sequence: number
  readonly type: 'session.updated' | 'diagnostics.updated' | 'appBuild.updated'
  readonly payload: SessionSnapshot | DiagnosticSnapshot | AppBuildStatus
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
