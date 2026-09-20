# iPhone native primitive ABI v1

Status: **frozen future cutover ABI; not active in the current app**. The existing Swift recorder, bridge, database, and selected build artifact remain the capture path until an explicit migration. This document lets native capture become lossless now without growing a second Swift business domain.

## Ownership boundary

- Native owns OS sensors/lifecycle, exact-byte capture, one serialized SQLite writer, files/share UI, and a serial JavaScriptCore context.
- TypeScript owns workout state and validation, request idempotency, recovery policy, parsing/projection, metrics, archive queries, and export shaping.
- React keeps the existing versioned workout commands. Native eventually forwards their JSON unchanged to the headless dispatcher; it does not add per-workout validation or state transitions.
- A source callback is durably appended **before** native or TypeScript parsing, filtering, sorting, or deduplication. Malformed, duplicate, and unknown data is retained.

## Globals and JSON envelope

Native installs this synchronous global before evaluating the domain bundle:

```ts
interface NativeHostGlobal {
  call(namespace: string, method: string, argsJSON: string): string
}

type HostReply =
  | { ok: true; result: unknown }
  | { ok: false; error: { code: string; message: string; retryable: boolean; details?: Record<string, unknown> } }

declare const NativeHost: NativeHostGlobal
```

`argsJSON` and the return value are JSON object texts. `call` executes on the single domain/JSC queue; native capture and SQLite work are serialized with that queue. Native returns an error envelope for operational failures and throws only when the ABI itself is unusable (for example, invalid JSON or a missing namespace). Domain code must not call this API from the main thread.

The plain browser-target IIFE will install exactly:

```ts
interface WorkoutDomainGlobal {
  dispatch(commandJSON: string): string
  onCaptureCommitted(captureId: string, throughCursor: number): void
  onAsyncCompleted(requestId: string, replyJSON: string): void
}

declare const WorkoutDomain: WorkoutDomainGlobal
```

`dispatch` accepts the existing `Command` JSON and synchronously returns the existing `Reply` JSON. `onCaptureCommitted` is called only after commit and in increasing `throughCursor` order on the serial JSC queue. Notifications may coalesce; TypeScript drains with `capture.read`. Reload/relaunch creates a new runtime, which reconstructs state from durable storage and capture rows rather than JSC memory.

## Frozen primitive calls

All argument and result names below are exact. Unknown object keys are ignored for additive compatibility. Unknown namespace/method pairs fail with `unsupportedPrimitive`.

### `capture`

Native assigns a contiguous, one-based `journalSequence` per capture and preserves callback and callback-batch order.

```ts
NativeHost.call('capture', 'open', JSON.stringify({
  captureId,                 // domain-generated stable string
  createdAt,                 // ISO-8601 UTC
  metadata,                  // opaque JSON object; no workout interpretation
}))
// => {ok:true,result:{captureId,throughCursor:number,state:'open'}}

NativeHost.call('capture', 'bind', JSON.stringify({
  captureId,
  sources: ('location' | 'bluetoothHeartRate' | 'hostLifecycle')[],
}))
// => {ok:true,result:{captureId,boundSources:string[]}}

NativeHost.call('capture', 'read', JSON.stringify({
  captureId, afterCursor: number | null, limit: number, // limit 1...1000
}))
// => {ok:true,result:{items:RawWorkoutEvent[],throughCursor:number,hasMore:boolean,state:'open'|'closed'}}

NativeHost.call('capture', 'appendHostEvent', JSON.stringify({
  captureId,
  event: RawEventInput,
}))
// => {ok:true,result:{eventId:string,journalSequence:number,throughCursor:number}}

NativeHost.call('capture', 'close', JSON.stringify({
  captureId, closedAt, expectedThroughCursor: number | null,
}))
// => {ok:true,result:{captureId,throughCursor:number,state:'closed'}}

NativeHost.call('capture', 'list', JSON.stringify({
  state: 'open' | 'closed' | null, afterCaptureId: string | null, limit: number,
}))
// => {ok:true,result:{items:{captureId:string,createdAt:string,closedAt:string|null,state:'open'|'closed',throughCursor:number,metadata:unknown}[],nextCaptureId:string|null}}
```

`bind` controls native source delivery but does not request permission. Rebinding is idempotent. `close` first fences all already-delivered source callbacks on the capture writer, commits them, then closes atomically. A mismatch in non-null `expectedThroughCursor` fails without closing. Closing never deletes rows. `appendHostEvent` is for domain-requested transitions/gaps; OS lifecycle callbacks arrive directly through the bound source.

`RawEventInput` omits native-assigned identity/order and otherwise has the canonical shape:

```ts
type RawEventInput = Omit<RawWorkoutEvent, 'eventId' | 'sessionId' | 'journalSequence'>

interface RawWorkoutEvent {
  formatVersion: 1
  eventId: string
  sessionId: string             // equals captureId at this boundary
  journalSequence: number
  kind: string
  sourceTimestamp: string | null
  receivedAt: string
  monotonicTimestampMs: number | null
  provenance: {
    origin: 'liveNative' | 'recordingReplay' | 'syntheticFixture'
    sourceId: string | null
    monotonicClockId: string | null
    lineage: { savedWorkoutId: string; sessionId: string; sequence: number } | null
  }
  batch: { batchId: string; index: number; size: number } | null
  payload: { encoding: 'json'; value: unknown } | { encoding: 'base64'; value: string }
}
```

Core Location payload JSON contains every available framework field as delivered. BLE payload base64 contains the exact characteristic bytes plus JSON metadata in a separate raw event or an additive JSON wrapper event; bytes are never reconstructed from decoded values.

### `storage`

The domain has a private SQLite database. SQL is intentionally generic so native does not acquire workout tables or mutation semantics.

```ts
type SQLValue = string | number | null // blobs cross as base64 strings with domain-owned encoding
type Statement = { sql: string; bindings: SQLValue[] }

NativeHost.call('storage', 'transaction', JSON.stringify({ statements: Statement[] }))
// => {ok:true,result:{statements:{rows:Record<string,SQLValue>[],changes:number,lastInsertRowId:number|null}[]}}

NativeHost.call('storage', 'read', JSON.stringify({ sql, bindings }))
// => {ok:true,result:{rows:Record<string,SQLValue>[]}}
```

`transaction` is `BEGIN IMMEDIATE`, all-or-nothing, with foreign keys enabled, WAL, FULL synchronous durability, and a busy timeout. Statement count, SQL length, row count, and returned bytes are bounded by native with explicit `limitExceeded`, never truncation. Only `transaction` mutates. TypeScript stores a command fingerprint and completed success/stable-error reply in the same transaction as each lifecycle mutation.

Capture storage and domain storage may be separate files. Atomicity is required within each primitive call, not across both files: Start opens capture before publishing success; Finish closes capture durably before committing the finished domain state. On a later domain commit failure, the closed raw capture remains discoverable and recoverable via `capture.list`.

### `event`, `clock`, and asynchronous OS work

```ts
NativeHost.call('event', 'emit', JSON.stringify({ event }))
// => {ok:true,result:{accepted:true}}       // event is the existing NativeEvent object

NativeHost.call('clock', 'now', '{}')
// => {ok:true,result:{wallTimestamp:string,monotonicTimestampMs:number|null,monotonicClockId:string|null}}

NativeHost.call('async', 'begin', JSON.stringify({
  requestId, operation: 'permission.request' | 'share.present' | 'network.fetch', arguments: unknown,
}))
// => {ok:true,result:{accepted:true}}
```

`async.begin` only accepts the request. Native later invokes `WorkoutDomain.onAsyncCompleted(requestId, replyJSON)` exactly once per accepted request on the serial JSC queue; `replyJSON` is a `HostReply`. Pending IDs and enough continuation state are persisted by TypeScript before `begin`, so duplicate/late completion is harmless. Capture, storage, event emission, and clock calls remain synchronous. No permission prompt, share sheet, or network wait may block `call`.

## Compatibility and cutover rule

The current `recording-v1.sqlite` and exports remain authoritative and untouched. A later cutover must ship a read-only legacy importer or adapter that maps every existing `journal_events` row (including `raw_encoding`, payload, provenance, and order), session, outcome, issue, and pinned engine identity into the domain model. It must prove row counts, contiguous journal positions, and byte-for-byte base64 payload equality before marking import complete; failure leaves legacy data readable and retryable.

The future package identity must explicitly pair `ui` and `domain/domain.js`; UI HMR/reload never replaces a running headless domain. Activating a new domain package is an idle-only operation. None of these package/build rules alter the current app until the separate migration is implemented and tested.
