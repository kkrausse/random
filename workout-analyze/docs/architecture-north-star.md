# Architecture north star

Status: design direction agreed in discussion on 2026-09-21. The first in-process Bun analysis slice described below is implemented; its database interface is execution-facing, not a completed wire protocol. Foreground journal consumers, browser transport, and Swift-native DuckDB remain pending integration verification. This document takes precedence over earlier proposals where they assume desktop-only analysis or a required companion computer.

## Same application, interchangeable local hosts

The browser should be a useful, persistent application and a faithful development environment for the iPhone application. Keep the browser / WKWebView React and TypeScript application substantially identical, including workout, history, and analysis behavior.

```text
         Shared React / TypeScript application
                    Shared host contract
                    /                  \
          iPhone Swift host       Local Mac Bun host
          Local device data       Local machine data
          GPS / Bluetooth         Replay / simulated inputs
```

The local Bun server is the development analog of the native Swift host. WKWebView messaging and the browser's local connection are transport adapters for the same application-facing contract. Platform-specific services belong behind that boundary; ordinary application workflows should not branch on Swift versus Bun.

Parity means shared behavior and data semantics, not identical hardware capabilities. The Bun host should support durable local workouts, history, and realistic replay through the application's normal workflows. Sensor simulation and platform capabilities should be explicit. Browser testing complements physical-iPhone verification of permissions, background execution, and recovery.

## Standalone iPhone is the target

An iPhone installation should be able to record, recover, retain history, browse, and analyze its locally available workouts without contacting another computer. This is a north-star requirement, not a claim that all of those features exist today.

The Bun host is not a required sync destination or phone backend. Importing historical data, exporting workouts, and optional transfer or sync may extend the local archive; ordinary operation must not depend on them. The requirement concerns locally available workouts, not offline acquisition from external providers.

## Journal, consumers, and projections

- Preserve a durable, ordered journal of original capture events as the recording source of truth.
- Process it with resumable consumers: read ordered batches, produce derived data, then commit progress.
- Track progress per consumer and processing version so independent consumers and rebuilds do not interfere.
- Treat normalized samples, summaries, segment detection, and effort history as derived projections.
- After interruption, consumers must resume without losing events or duplicating their effects. Prefer a checkpoint committed atomically with projection writes where possible; otherwise require replay-safe, idempotent effects before advancing the checkpoint. A separate journal and projection database do not provide a cross-database transaction automatically.

SQLite remains a reasonable journal implementation. A raw append-only file is an option, but would require framing, partial-write recovery, and durable checkpoint design. There is no decision to replace the existing journal. DuckDB may serve derived analysis without becoming the recording source of truth; Parquet may be useful for archives or transfer, but neither is a prerequisite.

## Execution decision: capture continuously, process on reopening

The native host must continue capturing and durably journaling events during an active recording while the UI is suspended. UI suspension or a lagging consumer must never intentionally skip, coalesce away, or discard original capture events. Actual sensor delivery and platform interruptions still need explicit diagnostics; this requirement is not a claim that an OS always delivers every physical observation.

For now, shared TypeScript consumers run in the foreground web application and resume from durable checkpoints when it reopens. Metrics, lap/segment recognition, and analysis may catch up from the journal. No separate background TypeScript runtime is required. Background processing may be revisited later if a concrete feature needs it; do not complicate the current design to provide it speculatively.

Catch-up should use ordered batches and preserve the state needed for deterministic processing across batch boundaries. It must remain resumable if the UI closes again. Fast catch-up is a performance goal to measure with recorded rides, not an assumed guarantee; distinguish current recording catch-up from expensive archive-wide analysis.

## Next design focus: where shared analysis executes

Downloaded Garmin history and app-recorded journals should converge through source adapters on the same logical workout/sample model. This is expected normalization work; the main architectural question is where analysis over that model executes.

Proposed shape for discussion, not a selected storage implementation:

```text
Retained Garmin originals -> Garmin source adapter --\
                                                     -> Canonical workouts/samples -> Analytics
Retained capture journal -> Journal consumer --------/
```

Keep originals replayable and retain source identity, import/processing version, and progress. Garmin originals need not be rewritten as synthetic sensor events; source-specific adapters should converge on a common normalized model. Define units, timestamps, missing measurements, pause semantics, and duplicate-import handling at that boundary. Cross-source duplicate workouts need an explicit identity/reconciliation policy rather than silently merging on timestamp.

The working direction is shared TypeScript normalization and analysis in the foreground browser/WKWebView, with bulk access to durable local inputs and outputs, and native DuckDB behind the Swift/Bun host contract. A unified database means a common logical archive per installation, not a central server or a requirement to store original journals and derived analytics in one physical database.

Currently `src/scripts/build-analysis.ts` is a thin Bun entry point. `src/services/AnalysisDatabase.ts` reads native DuckDB, invokes the TypeScript detector, and persists results. `src/services/SegmentDetector.ts` contains the matching algorithm, with a Node crypto dependency and a database-owned input type that need disentangling for web execution.

Recommended direction for discussion: make the analysis engine a portable TypeScript module run by the shared web application, preferably in a Web Worker to keep the UI responsive. A worker is part of the web runtime, not a separately hosted background execution service, and must not be relied on during iOS suspension. Keep the Bun CLI as an optional caller of the same engine. Separate database input/output from computation; host-side native SQL remains compatible with web-side TypeScript analysis. Before moving the existing whole-archive detector, evaluate its memory footprint and restart behavior on iPhone; journal checkpointing does not automatically make that detector incremental or resumable.

## Working storage and rebuild model

```text
Host: retained raw journal / imported originals
  -> shared web TypeScript consumer (preferably worker): normalize
  -> host: native DuckDB canonical workouts and samples
  -> shared analysis engine: DuckDB SQL + TypeScript computation
  -> host: native DuckDB derived routes, traversals, and other results
```

Keep the host interface primitive: ordered journal reads, generic parameterized DuckDB execution/querying, transactions, and bulk data transfer. Shared TypeScript owns normalization, schema/migrations, analysis SQL, and algorithms. Do not require new Swift domain methods for new analysis queries. Native DuckDB serves both Swift and Bun hosts; SQLite may continue to serve the separate capture journal.

The existing recorded ride has roughly 5,000–6,000 journal events, making batched host-to-web normalization and web-to-host insertion a reasonable starting point to measure. Do not design around one bridge request per event or assume whole-archive datasets have the same cost as one ride.

- **Normal ingestion:** consume new source data into canonical tables. Commit projection rows and the corresponding consumer checkpoint together in DuckDB where possible. Retain raw journal data independently for replay.
- **Normalization changes:** rebuild affected normalized workouts from retained originals with a new processing version, then invalidate dependent analysis. This is a data backfill, distinct from a schema migration; unrelated originals do not need to be reacquired.
- **Segment analysis:** accept a full rebuild over a defined normalized input revision when workouts or analysis logic change. Incremental route discovery is not a current requirement. This rebuild reads canonical data, not raw journals, unless normalization also changed.
- **Safe result replacement:** compute replacement results before publishing them. Replace all related derived tables in one transaction, or stage a new result generation and atomically publish it. Do not expose an empty/partial analysis between deletion and reinsertion. Preserve the previous successful results if a run is interrupted, and record their input revision/configuration so staleness is visible.
- **Replay/seek:** proposed default is isolated replay state rather than rolling back the canonical archive when the playback cursor moves backward. Explicit projection rebuilds replace persisted derived state; ordinary playback need not do so.

### Implemented analysis slice (2026-09-21)

The existing Bun CLI now runs route analysis through a portable TypeScript engine and a small execution-facing host interface for parameterized SQL, queries, transactions, and bulk insertion. Shared code owns normalized-input queries, analysis table schemas, the detector, and atomic result replacement; the Bun adapter owns only native DuckDB connection/value details. Detector IDs use a portable synchronous SHA-256 implementation and retain their previous values.

That TypeScript interface is not yet a browser/native wire contract. Its transaction callback executes client-side, `bigint` parameters and generic native result rows do not yet have bridge encodings, and a future transport must define transaction session ownership so every callback operation reaches the same native connection and transaction. The current `withBunDuckDbHost` adapter scopes one connection exclusively to one callback and expects sequential use; it does not serialize concurrent operations. The browser/WKWebView transport and Swift DuckDB adapter are not implemented yet.

## Remaining integration questions

This is a design direction, not authorization for an immediate storage migration. DuckDB-Wasm remains an alternative if native integration proves unsuitable, rather than the current default. Verify:

1. Bulk transfer, value encoding, connection/session ownership, and transaction isolation across the host bridge.
2. Durable checkpoints and any state needed to resume normalization across batches or UI suspension.
3. Phone memory/runtime for full analysis, and consistent input revisions while ingestion or backfills occur.
4. Import/replay, persistent history, deterministic processing, restart recovery, and analysis parity using the existing recorded ride on both hosts.

The current segment detector performs its geometric matching in TypeScript. Changing the database alone will not accelerate those loops; evaluate SQL preprocessing and query performance separately from matching performance.

## Current gap

The [browser workflow](mobile-browser-workflow.md) currently offers an in-memory simulator and a separate recorded-ride replay view. These are useful development tools, but do not yet fulfill the persistent interchangeable-host goal. Earlier desktop-companion and route-pack proposals describe an incremental starting point, not a permanent dependency on desktop analysis.
