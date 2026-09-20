# iPhone recording contract v1

Status: **frozen implementation contract** for the recording milestone. Route catalog, route matching, laps, and segments are deliberately absent. Recording must remain fully useful when no catalog is installed.

Canonical TypeScript entry points:

- Wire types and closed method/capability unions: `src/shared/mobile/contracts.ts`
- Untrusted JSON validation: `src/shared/mobile/validation.ts`
- Portable metrics engine: `src/engine/recording/index.ts`
- JavaScriptCore artifact/global: `src/engine/recording/recording-engine-v1.js` / `globalThis.WorkoutAnalyzeRecordingEngine`
- Installed composed artifact: `mobile/dist/engine/tiny-engine.js` (both recording and phase-1 diagnostic globals)
- Golden replay data: `src/engine/recording/fixtures.ts`

The existing location probe and BLE APIs remain compatible. A recorder reuses the selected BLE connection but never treats a missing/disconnected monitor as a recording failure.

## Capability and command rules

The nine `RECORDING_CAPABILITIES` are advertised as one group or not at all. The additive `ARCHIVE_CAPABILITIES` (`archive.list`, `archive.detail`) are a separate all-or-none group: their absence must not make `workout.recorder` unavailable. Legacy and currently installed shells remain valid without archive support. `bridge.hello` remains protocol version 1.

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

Every raw observation has UTC `sourceTimestamp`; location also has UTC `receivedAt`. Native records process-local monotonic milliseconds when available. Use monotonic differences within one process for active intervals. Persist UTC transitions as the cross-process fallback. Never extrapolate active time through an unknown interruption.

On launch, an unfinished session whose recorder process did not survive becomes `interrupted` in one transaction containing a `gap` observation and transition/revision change. `gap.startedAt` is the last time native can establish recording continuity; `gap.endedAt` is recovery detection. The engine counts only the interval ending at `startedAt`. `session.snapshot.recovery.required` blocks ordinary resume/finish; React presents Recover Resume/Finish, which call `workout.recover`.

## Atomic persistence and engine host

SQLite has one serialized writer. The conceptual commit order is:

1. Begin immediate transaction and verify request ID/session/revision.
2. Insert every raw delivery/event with contiguous session `sequence` values in receipt order. Preserve duplicate deliveries and full available sensor fields.
3. Insert any lifecycle transition and update session revision/state.
4. Commit raw input and session mutation. This makes input durable independently of engine success.
5. On the serial JavaScriptCore queue, project derivation-relevant raw rows to the engine's typed inputs, assign a separate contiguous engine-input sequence, and call `processBatch` in batches of at most 1,000. The native checkpoint stores both the last consumed raw sequence and engine checkpoint.
6. In a second transaction, upsert derived summary and checkpoint together, guarded by pinned engine build and both prior sequences. Derived writes use stable `(sessionId, algorithmId, lastRawSequence, lastEngineInputSequence)` identity.

If step 5/6 fails, recording continues, diagnostics expose backlog/failure, and replay resumes from the last checkpoint. Never advance a checkpoint without its summary. Do not emit a durable sequence until its transaction commits. WAL + foreign keys + busy timeout are expected; low-storage/write errors become a persistent fatal `recording.issue` and the UI must stop claiming data is saved.

Pin `engineBuildId`, API version, checkpoint schema, and algorithm ID at Start through Finish, including pauses/recovery. Installed engine updates apply only to the next workout. Development React HMR never changes the headless engine. To test an engine edit, build/publish the artifact, end the active session, activate that build, then start a new workout. Keep the bundled artifact and reject incompatible checkpoints rather than silently resetting one.

For recording v1, `WorkoutAnalyzeRecordingEngine.describe()` is exactly `{ apiVersion: 1, checkpointSchemaVersion: 1, engineBuildId: 'recording-engine-v1', algorithmId: 'ride-metrics-v1', maxBatchSize: 1000 }`. Native pins that recording descriptor on the workout; it must not substitute the installed package manifest ID. Restoring an active checkpoint deliberately discards its process-local monotonic origin and uses persisted UTC until a new active interval starts.

## Observation and reconnect API

Recorder rows use a session-local contiguous raw `sequence` assigned in callback receipt order. It is the stable observation identity together with `sessionId`; it is not the engine-input sequence. Location and HR source clocks remain independent. For every row, `sourceTimestamp` is measurement/event time, `receivedAt` is host receipt time where supplied, and `monotonicTimestampMs` is receipt time in the process/clock domain identified by optional `provenance.monotonicClockId`. Never compare monotonic values across different clock IDs or after relaunch. Batched Core Location fixes keep callback array order. Native must not sort or deduplicate before durable insertion: equal coordinates/timestamps and repeated BLE notifications remain separate raw rows. Validation/reordering/deduplication may occur only in the derivation projection and never modifies raw storage.

New shells attach optional `provenance` to raw rows: origin `liveNative`, stable provider/peripheral `sourceId` where available, monotonic clock-domain ID, and null lineage. Old rows/frames without it remain valid. Replay uses `recordingReplay` plus immutable `{savedWorkoutId, sessionId, sequence}` lineage; fixtures use `syntheticFixture` with null lineage. Transport/client identity is not sensor-source identity.

Location rows preserve all available `CLLocation` fields already named by the wire type, plus optional iOS 15+ `ellipsoidalAltitudeM`; unavailable values are null, not invented. Parsed HR rows preserve exact Heart Rate Measurement bytes in optional `rawCharacteristicBase64` (mandatory for newly captured notifications). An unparseable notification is a `heartRatePacket` row with bytes and parse error, not a dropped sample. `heartRateConnection` rows capture connect/disconnect/reconnect/failure boundaries. `hostLifecycle` captures available UIKit and protected-data callbacks; protected-data unavailability can correlate a lock but is not promised as a universal screen-lock detector. Start/pause/resume/finish/interruption remain transition/gap rows. No additional sensor permissions or unrelated device collection is implied.

```ts
observations.subscribe   { sessionId, afterSequence: number | null, maxBatchSize: 1..200 }
observations.read        { sessionId, afterSequence: number | null, limit: 1..200 }
observations.unsubscribe { subscriptionId }
archive.list             { afterCursor: string | null, limit: 1..100 }
archive.detail           { savedWorkoutId, afterSequence: number | null, limit: 1..200 }
```

There is one web subscription, owned by the central Zustand store/bridge client—not components. Event envelope `sequence` is the bounded bridge delivery sequence; observation `sequence` is durable session order. `observations.appended` pages are capped at the negotiated batch size and may be coalesced. Native retains at most 256 unacknowledged event envelopes per attached page; overflow drops old delivery events, not SQLite rows.

Reconnect algorithm: subscribe, fetch the atomic bridge/session snapshot, discard event envelopes at or below its event sequence, then apply newer contiguous envelopes. Any envelope gap triggers a new snapshot. For raw history, compare the page's `latestDurableSequence` to the session snapshot and page with `observations.read`; `droppedBeforeSequence` means the requested cursor predates retained/export-readable history and requires a full bounded reload, never an unbounded push. UI metric events may be coalesced to 1 Hz; transitions/issues are immediate.

`archive.list` is newest-finished-first. Its opaque cursor includes a list snapshot boundary and final `(finishedAt, savedWorkoutId)` key, so rides completed after page one do not cause duplicates or omissions in that traversal. `archive.detail` returns immutable metadata plus one lossless raw page; `afterSequence` is exclusive, pages are contiguous, and finished workouts have `oldestAvailableSequence = 1`, `droppedBeforeSequence = false`, and `observationCount = latestSequence`. Continue with returned `nextSequence`. Detail exposes pinned format/unit and derivation provenance. Use the summary `sessionId` with existing `workout.export`; archive discovery neither changes export nor the active-session snapshot.

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

The lossless ZIP bundle contains UTF-8 JSON files and SHA-256 checksums in a manifest: session metadata, pinned engine/config and versions, all raw location/HR packet/HR connection/host lifecycle/transition/gap rows in raw sequence order, final metrics, derivation input sequence bounds, engine checkpoint/algorithm IDs, provenance, and issues. Exact BLE characteristic bytes survive base64 round-trip. Format version is 1; units are SI and timestamps ISO-8601 UTC. Derived summaries are never substituted for raw input. GPX includes accepted geographic points plus elevation/time and optional HR extension, but is explicitly not re-imported as lossless source. Coordinates are included only in workout export, not default diagnostics export.

## Future deterministic replay boundary (contract only)

One typed recording source adapter supplies the same production domain inputs/actions from live native capture, immutable saved-recording replay, or synthetic fixtures. It has an injected clock; the bridge transport stays separate. Native SQLite is authoritative only for live capture, Zustand is only a reactive projection, and replay uses an isolated namespace that cannot mutate/export-as-live a real workout. A replay adapter must retain original lineage while assigning its own runtime delivery ordering, and feed the same store/processing pathways rather than create a parallel metrics engine. Explicit replay clock, pause/seek/speed controls and replay UI are later work. Fixtures and bug reproduction must never mutate the source recording. Session/raw sequence plus timestamps and issue durable sequence are sufficient to map a report to a ride moment; no generic UI interaction logger or user marker is required now.

## Implementation handoffs and gates

**Native (`ios/**`, separate owner):** implement schema/migrations, serialized transactions/idempotency table, lifecycle/recovery, Core Location ingestion, reuse of existing HR service, JavaScriptCore host, bounded event queue, bundle/GPX writer, and share sheet. Gate: physical-phone screen-lock ride with pause/resume, forced relaunch recovery, durable contiguous rows, checkpoint replay, saved export, and no duplicate mutation under retries.

**React (`mobile/**`, separate owner):** add recorder projection/actions to the single Zustand store and render Start/Live/Paused/Recovery/Saved/export flows. The store owns subscription/resync and narrow selectors; components own no native snapshots, polling, or subscriptions. Gate: simulator fixtures cover every state/error, duplicate replies and event gaps resnapshot, reload reattaches to the same session, and displayed stale values become `—`.

**Explicitly deferred:** route packs, matching, automatic laps, segment comparisons, and route-derived events. No API in this contract implies that a catalog or matcher exists.
