# iPhone phase-1 shell contract

Status: frozen phase-1 base plus additive sensor-diagnostics contract. Protocol, engine API, and checkpoint schema remain version `1`.

This is deliberately a shell contract, not a recorder contract. It includes explicit, reusable native location and Bluetooth heart-rate primitives so Diagnostics can prove real sensor delivery on a phone. Their bounded in-memory observations are not a workout and are not durable recording. Workout recording remains advertised as unavailable. Merely opening the UI, reading any status/snapshot, or running isolated checks must not prompt for permission, start sensors, create a workout, or mutate an existing workout.

## Entry points and transport

TypeScript consumers import from:

- `src/shared/mobile/index.ts` — wire types, constants, and runtime parsers.
- `src/engine/shell/index.ts` — JavaScriptCore artifact types and deterministic fixture.

The privileged WKWebView main frame sends a JSON-compatible object to:

```js
window.webkit.messageHandlers.workoutAnalyze.postMessage(command)
```

Native delivers objects (not JSON strings) by calling exactly one of:

```js
window.WorkoutAnalyzeNative.receiveReply(reply)
window.WorkoutAnalyzeNative.receiveEvent(event)
```

The web entry installs `WorkoutAnalyzeNative` before sending `bridge.hello`. Native accepts messages only from the selected main-frame origin, never subframes. Each encoded command/reply/event is at most 262,144 UTF-8 bytes. IDs match `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`. Unknown keys, methods, versions, or invalid params are rejected rather than ignored.

## Envelopes

```json
{"protocolVersion":1,"requestId":"web-42","method":"bridge.ping","params":{"nonce":"n-7"}}
```

```json
{"protocolVersion":1,"requestId":"web-42","ok":true,"result":{"nonce":"n-7","nativeReceivedAt":"2026-09-19T12:00:00.100Z","nativeSentAt":"2026-09-19T12:00:00.102Z"}}
```

```json
{"protocolVersion":1,"requestId":"web-43","ok":false,"error":{"code":"invalidState","message":"An active session pins its engine build","retryable":false}}
```

Stable error codes are `invalidRequest`, `unsupportedVersion`, `unsupportedMethod`, `invalidState`, `permissionDenied`, `sensorUnavailable`, `storageFailure`, `incompatibleBuild`, `downloadFailure`, and `internalError`. A reply repeats the request ID exactly. Native retains mutation outcomes by request ID for reconnection-safe retries.

Events use the atomic snapshot sequence domain:

```json
{"protocolVersion":1,"sessionId":null,"sequence":8,"type":"appBuild.updated","payload":{"active":{"buildId":"bundled-1","source":"bundled","engineBuildId":"phase1-engine-v1"},"previous":null,"bundled":{"buildId":"bundled-1","source":"bundled","engineBuildId":"phase1-engine-v1"},"downloaded":[],"pendingActivationBuildId":null,"lastFailure":null}}
```

Events are `session.updated`, `diagnostics.updated`, `appBuild.updated`, `permissions.updated`, `location.updated`, and `heartRate.updated`. New clients fetch `bridge.snapshot`, atomically install its `sequence` and all payloads, discard queued events through that sequence, and apply only newer events. A gap requires another `bridge.snapshot`. Legacy clients may use `session.snapshot`; its `durableSequence` is the same authoritative event sequence even though phase 1 has no durable workout observations. Every emitted event increments one native-owned sequence that is monotonic for the process lifetime, including coalesced sensor status events. Sensor observation cursors are separate stream-local domains and are never used as event sequences.

## Closed method table

The exact params and results are defined by `CommandParams` and `CommandResults` in `contracts.ts`.

| Method | Params | Result / rule |
| --- | --- | --- |
| `bridge.hello` | `clientName`, `clientVersion`, `supportedProtocolVersions:[1]` | Versions, implemented method capabilities, and explicit unavailable sensor/recorder capabilities. |
| `bridge.ping` | `nonce` | Same nonce and native receive/send UTC timestamps. |
| `session.snapshot` | `{}` | Authoritative shell session stub. Phase 1 has `recorderAvailability:"unavailable"`. |
| `bridge.snapshot` | `{}` | Atomic event sequence plus session, permissions, location, HR, diagnostics, and app-build snapshots. |
| `permissions.status` | `{}` | Location/Bluetooth status only; always `promptsAutomatically:false`. |
| `permissions.request` | `permission:"locationWhenInUse"|"bluetooth"` | The only permission-prompt entry point; must follow an explicit user action. Returns both current permission rows. |
| `location.status` | `{}` | Current probe lifecycle, counters, latest accepted observation, cursor bounds, and background state. No prompt/start. |
| `location.start` | accuracy, distance filter, background mode, maximum duration | Starts one bounded, non-workout Core Location probe after permission exists. |
| `location.stop` | `probeId` | Idempotently stops that probe and location delivery. A stale different ID is `invalidState`. |
| `location.read` | `probeId`, `afterCursor`, `limit` | Reads up to 200 retained observations; reports cursor loss and pagination. |
| `heartRate.status` | `{}` | Bluetooth/scan/connection state, bounded devices, counters, latest measurement, and cursor bounds. No prompt/scan. |
| `heartRate.scan` / `heartRate.stopScan` | duration 1–30 seconds / `{}` | Starts or explicitly stops a bounded foreground scan for Heart Rate service `180D`. |
| `heartRate.connect` / `heartRate.disconnect` | `deviceId` / `connectionId` | Connects and subscribes to `2A37`, or explicitly tears down that connection. |
| `heartRate.read` | `connectionId`, `afterCursor`, `limit` | Reads up to 200 retained parsed measurements, optionally used for charts/replay diagnostics. |
| `diagnostics.snapshot` | `{}` | Typed status rows and event sequence. Read-only. |
| `diagnostics.runChecks` | `checks:null` for all, or a subset | Four isolated check results and `workoutStateUnchanged:true`. |
| `diagnostics.export` | `includeWorkoutObservations` | Presents native share UI and returns export ID. Default UI sends `false`. |
| `appBuild.status` | `{}` | Active, previous, bundled, downloaded, pending, last failure. |
| `appBuild.download` | HTTPS `manifestUrl` | Verified staged build; never activates it. |
| `appBuild.activate` | `buildId` | Atomically changes active pointer while idle; reload required. |
| `appBuild.rollback` | `target:"previous"|"bundled"` | Atomically changes active pointer; reload required. |
| `devSource.configure` | root HTTP(S) URL or `null` | Development source, or bundled source for `null`; reload required. Credentials/query/fragment are forbidden. HTTP is only accepted here and native restricts it to explicitly selected development hosts. |
| `ui.reload` | `{}` | Acknowledges, then reloads. Native session state survives. |

`appBuild.download` is HTTPS-only. Redirects must also remain HTTPS. Production shells should additionally require a configured trusted endpoint or signature. `devSource.configure` does not grant arbitrary pages bridge privileges: native changes its selected origin first, then loads that exact origin.

### Hello and capability availability

```json
{"protocolVersion":1,"requestId":"hello-1","method":"bridge.hello","params":{"clientName":"mobile-web","clientVersion":"0.1.0","supportedProtocolVersions":[1]}}
```

```json
{"protocolVersion":1,"requestId":"hello-1","ok":true,"result":{"shellVersion":"0.1.0","protocolVersion":1,"engineApiVersion":1,"checkpointSchemaVersion":1,"capabilities":["bridge.ping","session.snapshot","permissions.status","diagnostics.snapshot","diagnostics.runChecks","diagnostics.export","appBuild.status","appBuild.download","appBuild.activate","appBuild.rollback","devSource.configure","ui.reload","permissions.request","bridge.snapshot","location.status","location.start","location.stop","location.read","heartRate.status","heartRate.scan","heartRate.stopScan","heartRate.connect","heartRate.disconnect","heartRate.read"],"unavailableCapabilities":[{"capability":"workout.recorder","reason":"Phase 1 has no production recorder"}]}}
```

The original twelve shell capabilities remain mandatory. Sensor method bundles are additive and all-or-none per sensor. An older shell remains valid by omitting the new methods and listing `sensors.location` and/or `sensors.bluetoothHeartRate` in `unavailableCapabilities`. A shell implementing a sensor bundle omits its unavailable entry. `workout.recorder` is always unavailable in phase 1. Implementing probes must not be described as implementing recording.

## Status and diagnostics

Every status row has `id`, `label`, `status` (`ok|waiting|unavailable|error`), a nonempty human-actionable `reason`, `observedAt` (UTC or `null`), `freshness` (`fresh|stale|never`), and subsystem-specific `details`. `ok` is not valid for a stale observation. `unavailable` is expected for unimplemented recorder/sensors and is distinct from an operational error.

`permissions.status` never requests permission. `notDetermined` is normally `waiting` or `unavailable`, not an error. “No HR monitor selected” is unavailable/unconfigured, not recorder failure.

`permissions.request` is invoked only from an explicit Diagnostics button. For location it requests When In Use authorization; the shell does not automatically escalate to Always. For Bluetooth it initializes the native Bluetooth authorization path but does not scan or connect. Start/scan commands never prompt implicitly: they return `permissionDenied` or `sensorUnavailable` with actionable status when prerequisites are missing. A denial remains inspectable and opening/reloading Diagnostics never re-prompts.

## Live sensor probe semantics

### Location

`location.start` accepts `desiredAccuracy` (`best|nearestTenMeters|hundredMeters`), `distanceFilterM` (0–1000), `backgroundMode` (`foregroundOnly|continueWhenBackgrounded`), and `maxDurationSeconds` (10–1800). Only one probe exists. Repeating a completed request ID returns its original result; another start while active returns `invalidState`. The result supplies a generated `probeId`, start/expiry timestamps, actual background state, lifecycle, counts, cursors, and latest observation.

The native host stops the probe on explicit `location.stop`, expiry, service/authorization loss, or shell termination. `foregroundOnly` stops delivery when the app backgrounds. `continueWhenBackgrounded` requests native background delivery only when the target is configured and iOS permits it; `backgroundDeliveryActive` reports reality rather than echoing the request. The probe is volatile and capped at 2,048 accepted observations. It does not claim crash/relaunch continuity. UI reload may reconnect to a still-running native probe using `bridge.snapshot` and the returned `probeId`. Leaving Diagnostics should explicitly stop it; expiry is the safety net.

Each `LocationObservation` has a stream cursor, Core Location source and receipt UTC timestamps, coordinates, horizontal accuracy, and nullable altitude/vertical accuracy, speed/speed accuracy, course/course accuracy, floor, and iOS source-information flags. Invalid negative-accuracy fixes are counted but not exposed as valid observations. Status distinguishes received, accepted, rejected, and retained counts and gives the last rejection reason. Values use degrees, metres, metres/second, and UTC strings exactly as named; unavailable/invalid optional sensor values are `null`, never fabricated zeroes.

`location.read` uses exclusive `afterCursor`; `null` starts at the oldest retained item. `nextCursor` is the last returned cursor (or the supplied cursor when no item is returned), `hasMore` means another page is retained, and `droppedBeforeCursor` says the requested history predates `oldestAvailableCursor`. Cursors increase within a probe and are not reused.

### Bluetooth heart rate

`heartRate.scan` is an explicit 1–30 second foreground scan filtered to service `180D`; discovered devices are deduplicated by Core Bluetooth identifier and capped at 32 most recently seen entries. Scan automatically stops at `scanEndsAt`, on backgrounding, or on explicit `heartRate.stopScan`. Scanning must not silently continue after the UI says it stopped. Device IDs are opaque identifiers, names may be null, RSSI is dBm, and advertised service UUIDs are normalized strings.

`heartRate.connect` stops scanning, connects the selected device, discovers `180D`/`2A37`, and enables notifications. Its generated `connectionId` scopes reads and disconnects so stale UI cannot tear down a newer connection. `heartRate.disconnect` disables notifications/cancels the peripheral connection and is idempotent for that connection; a different stale ID is `invalidState`. The status reports native lifecycle, connected device, packet/parse-error/reconnect counts, and whether `bluetooth-central` background mode is configured. When configured, an explicit connection may receive/reconnect in background as iOS permits until disconnect, service loss, or shell termination; no cadence or uninterrupted delivery is promised. When not configured, status must say so rather than claim background support.

`HeartRateMeasurement` exposes receipt UTC time, BPM, wire format (`uint8|uint16`), contact state derived from flags (`unsupported|notDetected|detected`), optional cumulative energy expended in kJ, RR intervals converted from 1/1024 seconds to seconds, and raw flags. Arrays are bounded to 32 RR intervals and buffers to 2,048 measurements. Cursor paging matches location and is scoped to `connectionId`. Malformed/truncated `2A37` packets increment `parseErrorCount` and do not create a measurement.

### Events, rates, and privacy

Events carry coalesced status snapshots, not every raw sample. Send lifecycle/error transitions promptly; throttle `location.updated` to at most 1 Hz and `heartRate.updated` to at most 4 Hz. Raw accepted values remain available through bounded reads regardless of event coalescing. `permissions.updated` is sent for native authorization/power changes. Every event payload is validated and is at most the bridge message bound.

Probe buffers are in memory, separate from diagnostic logs/workout storage, and cleared when their probe/connection is superseded or the process ends. Normal diagnostics export includes statuses, counters, timestamps, and errors but no coordinates, device identifiers, names, BPM, or RR values. `includeWorkoutObservations` does not opt into probe data because these are not workout observations; a future explicit sensor-evidence export would require separate consent and contract.

`diagnostics.runChecks` has exactly these IDs:

- `bridgePing` — internal dispatcher round trip.
- `capabilityCompatibility` — protocol/API/capability comparison.
- `diagnosticStorage` — write/read/delete under native namespace `diagnostics/<run-id>` only.
- `engineFixture` — fresh JavaScriptCore instance and ephemeral namespace `engine-fixture/<run-id>` only.

Checks report `pass|fail|notRun`, reason, timestamps, and namespace. They must not access workout tables/files, append observations, alter a session revision/sequence, or reuse/mutate the active engine instance/checkpoint. Sensor state is inspected, never synthetically declared healthy. Export excludes coordinates, samples, secrets, and URL query data unless `includeWorkoutObservations:true` was an explicit user action.

## Installed-build manifest

The JSON manifest is `BuildManifest`. Example (hashes abbreviated here only; real hashes are exactly 64 lowercase hex characters):

```json
{
  "formatVersion": 1,
  "buildId": "phone-2026.09.19",
  "createdAt": "2026-09-19T12:00:00Z",
  "uiEntryPath": "ui/index.html",
  "engineEntryPath": "engine/tiny-engine.js",
  "engineBuildId": "phase1-engine-v2",
  "bridgeProtocol": {"min": 1, "max": 1},
  "engineApi": {"min": 1, "max": 1},
  "checkpointSchemaVersion": 1,
  "requiredCapabilities": ["bridge.ping", "session.snapshot"],
  "files": [
    {"path":"ui/index.html","role":"ui","sizeBytes":4812,"sha256":"<64 lowercase hex>"},
    {"path":"engine/tiny-engine.js","role":"engine","sizeBytes":3901,"sha256":"<64 lowercase hex>"}
  ]
}
```

Validation happens before activation: 1–1024 files; each is 1 byte through 32 MiB; total is at most 64 MiB; unique relative `/`-separated paths only; no empty, `.`, `..`, absolute, or backslash components, URL delimiters/percent escapes (`?`, `#`, `%`), or control characters; exact SHA-256 and declared size; both entry files present with matching roles; no undeclared extracted files; API ranges/capabilities compatible. Download into a fresh staging directory, reject links and non-regular files, verify while streaming with bounded bytes, then atomically rename. Never extract over an active build. Keep bundled and previous known-good builds. A workout (once implemented) pins its engine and blocks activation until idle.

## Headless engine artifact API

Evaluate one plain script (`tiny-engine-v1.js` or fixture release `tiny-engine-v2.js`) in a dedicated JavaScriptCore context. It installs exactly:

```js
globalThis.WorkoutAnalyzeEngine.describe()
globalThis.WorkoutAnalyzeEngine.create(checkpointOrNull)
```

`describe()` returns API/checkpoint versions, build/algorithm IDs, and max batch size. `create()` returns `processBatch({observations})` and `checkpoint()`. Inputs are JSON values, batches are at most 1,000 observations, and sequences must be contiguous. There are no DOM, Node/Bun, network, filesystem, timer, random, or clock dependencies. A checkpoint is accepted only by its exact engine build and algorithm, preventing accidental cross-build resume.

The frozen fixture sends values `2` and `3` at sequences `1` and `2`. V1 (`phase1-sum-v1`) yields display value `5`; V2 (`phase1-double-v2`) yields `10` with the same API. This is intentionally tiny—not workout analysis—but proves download/activation and changed native-hosted engine behavior between idle sessions without reinstalling the shell.
