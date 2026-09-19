# iPhone phase-1 shell contract

Status: frozen phase-1 contract. Protocol, engine API, and checkpoint schema are all version `1`.

This is deliberately a shell contract, not a recorder contract. Location, Bluetooth HR, and workout recording are advertised as unavailable. Merely opening the UI, reading status, or running diagnostics must not prompt for permission, start sensors, create a workout, or mutate an existing workout.

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

Phase 1 emits only `session.updated`, `diagnostics.updated`, and `appBuild.updated`. After hello, fetch `session.snapshot`; discard events through its authoritative sequence and apply only newer events. A gap requires another snapshot.

## Closed method table

The exact params and results are defined by `CommandParams` and `CommandResults` in `contracts.ts`.

| Method | Params | Result / rule |
| --- | --- | --- |
| `bridge.hello` | `clientName`, `clientVersion`, `supportedProtocolVersions:[1]` | Versions, advertised capabilities, and explicit unavailable sensor/recorder capabilities. |
| `bridge.ping` | `nonce` | Same nonce and native receive/send UTC timestamps. |
| `session.snapshot` | `{}` | Authoritative shell session stub. Phase 1 has `recorderAvailability:"unavailable"`. |
| `permissions.status` | `{}` | Location/Bluetooth status only; `promptsAutomatically:false`. No prompt command exists in phase 1. |
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

### Hello and unavailable features

```json
{"protocolVersion":1,"requestId":"hello-1","method":"bridge.hello","params":{"clientName":"mobile-web","clientVersion":"0.1.0","supportedProtocolVersions":[1]}}
```

```json
{"protocolVersion":1,"requestId":"hello-1","ok":true,"result":{"shellVersion":"0.1.0","protocolVersion":1,"engineApiVersion":1,"checkpointSchemaVersion":1,"capabilities":["bridge.ping","session.snapshot","permissions.status","diagnostics.snapshot","diagnostics.runChecks","diagnostics.export","appBuild.status","appBuild.download","appBuild.activate","appBuild.rollback","devSource.configure","ui.reload"],"unavailableCapabilities":[{"capability":"workout.recorder","reason":"Phase 1 has no production recorder"},{"capability":"sensors.location","reason":"Phase 1 does not start location services"},{"capability":"sensors.bluetoothHeartRate","reason":"Phase 1 does not scan or connect"}]}}
```

## Status and diagnostics

Every status row has `id`, `label`, `status` (`ok|waiting|unavailable|error`), a nonempty human-actionable `reason`, `observedAt` (UTC or `null`), `freshness` (`fresh|stale|never`), and subsystem-specific `details`. `ok` is not valid for a stale observation. `unavailable` is expected for unimplemented recorder/sensors and is distinct from an operational error.

`permissions.status` never requests permission. `notDetermined` is normally `waiting` or `unavailable`, not an error. “No HR monitor selected” is unavailable/unconfigured, not recorder failure.

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
