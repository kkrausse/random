# iPhone recording contract v1

Status: **frozen implementation contract** for the recording milestone. Route catalog, route matching, laps, and segments are deliberately absent. Recording must remain fully useful when no catalog is installed.

Canonical TypeScript entry points:

- Wire types and closed method/capability unions: `src/shared/mobile/contracts.ts`
- Untrusted JSON validation: `src/shared/mobile/validation.ts`
- Portable metrics engine: `src/engine/recording/index.ts`
- Raw decoder/projector and cursor consumer: `src/replay/decoder.ts` / `src/replay/consumer.ts`
- Recording source and replay controller: `src/replay/source.ts` / `src/replay/controller.ts`
- Golden replay data: `src/engine/recording/fixtures.ts`

The existing location probe and BLE APIs remain compatible. A recorder reuses the selected BLE connection but never treats a missing/disconnected monitor as a recording failure.

## Capability and command rules

The nine `RECORDING_CAPABILITIES` are advertised as one group or not at all. The additive `ARCHIVE_CAPABILITIES` (`archive.list`, `archive.detail`) are a separate all-or-none group. `JOURNAL_CAPABILITIES` contains independent `journal.read`. Absence of either additive group must not make `workout.recorder` unavailable. Legacy and currently installed shells remain valid without them. `bridge.hello` remains protocol version 1.

These are TypeScript domain contracts at the composed app boundary, not a requirement for a matching Swift business-command switch or duplicate Swift validator per method. There is one JavaScript runtime: the visible WKWebView/browser runtime. TypeScript implements decode, projection, metrics, checkpoints, and replay there over broad native append/read primitives. `bridge.hello` advertises a domain capability only when the composed dispatcher supports it end to end. Swift remains authoritative for durable live bytes and OS callbacks; it must not decode/filter them before journal append. No JavaScriptCore or second headless engine is part of this model.

Lifecycle requests are:

```ts
workout.start   { expectedRevision, sport: 'cycling', startPolicy }
workout.pause   { sessionId, expectedRevision }
workout.resume  { sessionId, expectedRevision }
workout.finish  { sessionId, expectedRevision }
workout.recover { sessionId, expectedRevision, action: 'resume' | 'finish' }
```

The envelope `requestId` is the idempotency key. Native stores the completed result (success or stable error) in the same SQLite transaction as a mutation and returns that result for every retry. An unseen request with the wrong revision returns `revisionConflict`, including the current revision/session snapshot in error details. Reusing a request ID with different method/params is `invalidRequest`. Retain mutation outcomes for at least as long as the workout record.

Legal transitions are `idle → recording ⇄ paused → finished` and `recording|paused → interrupted → recording|finished` through `workout.recover`. There is one unfinished session. Start at revision 0 creates revision 1. Every persisted lifecycle transition increments revision exactly once. Start/pause/resume/finish/recover replies are sent only after commit. Finish is save: its reply includes `savedWorkoutId`; sharing is separate.

`startPolicy: waitForReliableLocation` starts and persists the session immediately, while metrics report location `waiting`; it does not defer creation or active time. This keeps retries and background handoff unambiguous.

## Clocks and recovery

Every raw journal event has nullable UTC `sourceTimestamp` (null when the source supplied none), UTC `receivedAt`, and process-local receipt `monotonicTimestampMs` when available. Use monotonic differences only inside the `provenance.monotonicClockId` domain. Persist UTC transitions as the cross-process fallback. Never extrapolate active time through an unknown interruption.

On launch, an unfinished session whose recorder process did not survive becomes `interrupted` in one transaction containing a `gap` observation and transition/revision change. `gap.startedAt` is the last time native can establish recording continuity; `gap.endedAt` is recovery detection. The engine counts only the interval ending at `startedAt`. `session.snapshot.recovery.required` blocks ordinary resume/finish; React presents Recover Resume/Finish, which call `workout.recover`.

## Atomic persistence and engine host

SQLite has one serialized writer. The conceptual commit order is:

1. Begin immediate transaction and verify request ID/session/revision.
2. Before parsing, decoding, filtering, or engine work, append each delivered `RawWorkoutEvent` to the journal with contiguous `journalSequence` in receipt order. Preserve duplicate, malformed, and unknown events and original callback batch order.
3. Insert any lifecycle mutation's raw event and update session revision/state.
4. Commit journal input and lifecycle mutation. This is the capture durability boundary; a Stop/Finish reply waits until pending source callbacks are serialized and this commit succeeds.
5. Only after that commit, decode/project journal rows into optional normalized `RecorderObservation` rows and engine inputs. Decode rejection records a processing failure but never updates/deletes the journal event. Assign normalized observation and engine-input sequences independently.
6. In the foreground WKWebView runtime, call `processBatch` in batches of at most 1,000. Commit a replay/consumer checkpoint containing source/session/namespace identity, last consumed journal sequence, independent normalized and engine-input positions, and the engine checkpoint. Persist the checkpoint only after projection and engine work complete. A redelivered uncommitted batch is safe because sequence domains are idempotent.

If decode/engine work fails, recording continues, diagnostics expose backlog/failure, and projection resumes from its checkpoint. Never advance a projection/checkpoint without its matching result. Do not emit a journal sequence until its transaction commits. WAL + foreign keys + busy timeout are expected; low-storage/write errors become a persistent fatal `recording.issue` and the UI must stop claiming data is saved.

Pin `engineBuildId`, API version, checkpoint schema, and algorithm ID at Start through Finish, including pauses/recovery. Reject incompatible checkpoints rather than silently resetting one. The engine and consumer execute in the same WKWebView runtime; development replay uses the same imported metrics engine as live journal consumption.

For recording v1, `WorkoutAnalyzeRecordingEngine.describe()` is exactly `{ apiVersion: 1, checkpointSchemaVersion: 1, engineBuildId: 'recording-engine-v1', algorithmId: 'ride-metrics-v1', maxBatchSize: 1000 }`. Native pins that recording descriptor on the workout; it must not substitute the installed package manifest ID. Restoring an active checkpoint deliberately discards its process-local monotonic origin and uses persisted UTC until a new active interval starts.

## Observation and reconnect API

`RawWorkoutEvent` is the canonical append-only record. `(sessionId, journalSequence)` and stable `eventId` identify an event. Its version-1 envelope contains opaque `kind`, nullable source time, receipt wall/monotonic times, provenance, optional `{batchId,index,size}`, and either bounded unknown JSON or base64 bytes. Validators deliberately do not require a known event kind or decoded GPS/HR shape. `journalSequence` is separate from normalized observation `sequence`, engine-input sequence, and bridge event sequence.

Location and HR source clocks remain independent. Batched Core Location fixes retain callback array order and serialize every available framework field as delivered into JSON; do not first construct a reduced normalized location. BLE notifications journal exact bytes plus available peripheral, service, characteristic, connection, and receipt metadata before invoking the HR decoder. Equal fixes, repeated notifications, unparseable bytes, unknown future fields/kinds, connection changes, host lifecycle callbacks, workout transitions, and gaps are separate journal events. Native must not sort or deduplicate before journal commit. Validation/reordering/deduplication may occur only in projection and never modifies raw storage.

Journal events require provenance: origin `liveNative`, stable provider/peripheral `sourceId` where available, monotonic clock-domain ID, and null lineage. Normalized observations accept it optionally for compatibility and may add `rawEvent: {eventId,journalSequence}`. Replay uses `recordingReplay` plus immutable original-recording lineage; fixtures use `syntheticFixture` with null lineage. Transport/client identity is not sensor-source identity.

Normalized location rows retain the existing fields plus optional iOS 15+ `ellipsoidalAltitudeM`; parsed HR rows may copy exact bytes in optional `rawCharacteristicBase64`. Convenience `heartRatePacket`, `heartRateConnection`, and `hostLifecycle` projections remain valid, but journal retention—not successful projection—is the losslessness guarantee. Protected-data unavailability can correlate a lock but is not promised as a universal screen-lock detector. No additional sensor permissions or unrelated device collection is implied.

```ts
observations.subscribe   { sessionId, afterSequence: number | null, maxBatchSize: 1..200 }
observations.read        { sessionId, afterSequence: number | null, limit: 1..200 }
observations.unsubscribe { subscriptionId }
archive.list             { afterCursor: string | null, limit: 1..100 }
archive.detail           { savedWorkoutId, afterSequence: number | null, limit: 1..200 }
journal.read             { sessionId, afterJournalSequence: number | null, limit: 1..200 }
```

There is one web subscription, owned by the central Zustand store/bridge client—not components. Event envelope `sequence` is the bounded bridge delivery sequence; observation `sequence` is durable session order. `observations.appended` pages are capped at the negotiated batch size and may be coalesced. Native retains at most 256 unacknowledged event envelopes per attached page; overflow drops old delivery events, not SQLite rows.

Reconnect algorithm: subscribe, fetch the atomic bridge/session snapshot, discard event envelopes at or below its event sequence, then apply newer contiguous envelopes. Any envelope gap triggers a new snapshot. For raw history, compare the page's `latestDurableSequence` to the session snapshot and page with `observations.read`; `droppedBeforeSequence` means the requested cursor predates retained/export-readable history and requires a full bounded reload, never an unbounded push. UI metric events may be coalesced to 1 Hz; transitions/issues are immediate.

`archive.list` is newest-finished-first. Its opaque cursor includes a list snapshot boundary and final `(finishedAt, savedWorkoutId)` key, so rides completed after page one do not cause duplicates or omissions in that traversal. `archive.detail` returns immutable metadata plus one bounded normalized-observation page; it is not the canonical raw API. Detail exposes pinned format/unit and derivation provenance. Optional summary `rawEventCount`/`lastJournalSequence` are equal for the contiguous journal. Use summary `sessionId` with `journal.read` and existing `workout.export`.

`journal.read` is bounded, cursor-exclusive, contiguous, and never filters by understood kind. Pages echo `afterJournalSequence`, use `nextJournalSequence`, and for retained workouts report oldest 1 and `droppedBeforeJournalSequence: false`. Unknown JSON values/keys and base64 bytes round-trip unchanged. The capability is advertised independently so its rollout cannot disable Start/Stop on a recorder host.

## Metrics v1

The engine is deterministic, has no DOM/Node/Bun/network/timers, and receives an explicit evaluation clock. Thresholds frozen in `ride-metrics-v1`:

- Accept location for derivation at horizontal accuracy ≤50 m and receipt age ≤15 s.
- Break the distance anchor on poor/stale/out-of-order fixes, pauses, gaps, >30 s location gaps, or implied speed >25 m/s. Never bridge across them.
- Prefer nonnegative reported speed with null/≤3 m/s speed accuracy; otherwise use accepted position delta. Current speed/location become stale after 8 s and return null, never zero.
- Accept altitude only with non-null vertical accuracy ≤10 m. Add positive changes only when they exceed a 3 m deadband. Ascent is estimated.
- HR becomes stale after 10 s. Raw 8/16-bit BLE fields remain in storage/wire observations; metrics expose BPM and observation time.
- Average speed is accepted distance / active duration. Pause and interruption stop active duration and distance.
- A `processBatch` failure is atomic in memory: no observation from that batch advances the checkpoint. Gradual positive altitude changes accumulate against the elevation deadband baseline; valid descent resets that baseline.

Golden tests cover distance, poor accuracy, stale delivery, pause/resume, stale speed/HR, interruption gaps, replay idempotence, and sequence gaps. The checked-in plain-JS artifact is executed in tests and compared with the TypeScript implementation.

## Save and export

Finish commits locally before returning. `workout.export` supports lossless `workoutBundleV1` and convenience `gpx`; export failure never deletes or modifies the workout. Both invoke the native share sheet and return `{ exportId, presented, format }`.

The lossless ZIP bundle contains the complete versioned raw journal in `journalSequence` order plus checksummed session metadata, pinned engine/config and versions, normalized projections, final metrics, derivation input bounds/checkpoints, and issues. It includes rejected, duplicate, malformed, and unknown events; exact bytes survive base64 round-trip. Format version is 1; normalized units are SI and timestamps ISO-8601 UTC, while opaque payloads are not rewritten. Derived summaries are never substituted for journal input. GPX is convenience-only and not a lossless/re-import source.

## Deterministic journal consumption and replay

`RecordingSource` supplies bounded immutable raw pages from either the development bundle adapter or a future adapter over native `journal.read`. Both feed `createJournalConsumer`: it validates source/session identity and strict raw continuity, decodes zero-or-more normalized observations and engine inputs, runs the existing recording engine, then commits one checkpoint. Unknown kinds, malformed known payloads, and recognized duplicate deliveries still advance the raw cursor; the opaque source event is never rewritten. The projector checkpoint retains emitted dedupe identities and a separate duplicate count, so retries, page boundaries, and checkpoint restoration produce the same projection. Journal, normalized observation, and engine-input sequences remain distinct.

The compatibility dedupe identities are `location:${sourceTimestamp}:${latitudeDegrees}:${longitudeDegrees}` and `heartRate:${connectionId}:${receivedAt}:${rawFlags}`. Engine progression treats each projected input as a durable checkpoint boundary, restoring through `create(checkpoint)` before the next input. This deliberately drops process-local monotonic origins and makes durable replay metrics invariant to transport page size and commit retry while retaining wall-clock continuity.

Replay has an injected clock and load/play/pause/speed/seek controls. Seek deterministically rebuilds from the immutable beginning (a future optimization may select a compatible earlier checkpoint). The Zustand store owns the controller and projects its output into the same session metrics and trail used by the mobile ride UI. Replay uses an isolated namespace, is visibly labeled, exposes no live mutation or export action, and retains lineage back to each immutable source journal row.

### Local development replay

Place exactly one ignored workout bundle ZIP in `data/local-replays/`, or set `WORKOUT_LOCAL_REPLAY_ZIP` to its absolute path. Then run:

```sh
bun run mobile:dev
```

Open `http://localhost:4317/?replay=local` (or use **Load immutable local replay** on the development home screen). The Vite-only plugin validates the bundle's session and full continuity once, then serves pages capped at 200 events. The routes do not exist in production builds and never return an entire workout in one response. For an aggregate, coordinate-free decoder check, run `bun run mobile:replay:check`.

## Implementation handoffs and gates

**Native/host (`ios/**`, separate owner):** keep primitives broad: capture OS sensor/lifecycle callbacks, atomically append/read opaque journal events before decode, durably host headless JavaScriptCore in background, and provide file/share primitives. Domain lifecycle/archive dispatch, projection, and strict business validation may remain TypeScript; do not mirror every method schema in Swift. Gate: physical-phone screen-lock ride with pause/resume, forced relaunch recovery, complete contiguous journal, checkpoint replay, saved export, and no duplicate mutation under retries.

**React (`mobile/**`, separate owner):** add recorder projection/actions to the single Zustand store and render Start/Live/Paused/Recovery/Saved/export flows. The store owns subscription/resync and narrow selectors; components own no native snapshots, polling, or subscriptions. Gate: simulator fixtures cover every state/error, duplicate replies and event gaps resnapshot, reload reattaches to the same session, and displayed stale values become `—`.

**Explicitly deferred:** route packs, matching, automatic laps, segment comparisons, and route-derived events. No API in this contract implies that a catalog or matcher exists.
