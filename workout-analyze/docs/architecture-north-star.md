# Architecture north star

Status: design direction agreed in discussion on 2026-09-21; not a description of completed implementation. Foreground consumer execution is the current direction; storage selection and database placement remain open. This document takes precedence over earlier proposals where they assume desktop-only analysis or a required companion computer.

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

The working proposal is shared TypeScript normalization and analysis in the foreground browser/WKWebView, with bulk access to durable local inputs and outputs. Database execution may still live behind the Swift/Bun host contract or in the shared web runtime. Choosing foreground consumers does not itself choose database placement. A unified database means a common logical archive per installation, not a central server or a requirement to store original journals and derived analytics in one physical database.

Currently `src/scripts/build-analysis.ts` is a thin Bun entry point. `src/services/AnalysisDatabase.ts` reads native DuckDB, invokes the TypeScript detector, and persists results. `src/services/SegmentDetector.ts` contains the matching algorithm, with a Node crypto dependency and a database-owned input type that need disentangling for web execution.

Recommended direction for discussion: make the analysis engine a portable TypeScript module run by the shared web application, preferably in a Web Worker to keep the UI responsive. A worker is part of the web runtime, not a separately hosted background execution service, and must not be relied on during iOS suspension. Keep the Bun CLI as an optional caller of the same engine. Separate database input/output from computation; host-side native SQL remains compatible with web-side TypeScript analysis. Before moving the existing whole-archive detector, evaluate its memory footprint and restart behavior on iPhone; journal checkpointing does not automatically make that detector incremental or resumable.

## Decisions deliberately left open

Do not select or migrate storage on the strength of this document. Evaluate placement symmetrically across the two hosts:

| Option | iPhone | Mac browser development |
| --- | --- | --- |
| Analysis database behind the host contract | Native engine in Swift host | Native engine in Bun host |
| Analysis database in shared web runtime | DuckDB-Wasm in WKWebView | DuckDB-Wasm in browser |

A browser-versus-iPhone split is not the intended architectural boundary. Both options still need persistence, recovery, version compatibility, and lifecycle verification. Foreground TypeScript consumers can call host-side database operations; native database bindings do not require moving those consumers into Swift or adding a background runtime.

Before choosing, establish:

1. How do Garmin originals and recorded journals converge on a canonical model, and what batching and persistence contract supports foreground normalization and analysis on both platforms?
2. Who owns durable writes, consumer checkpoints, and projection rebuilds? Define recovery behavior before optimizing database access.
3. What host operations and capability signals let the same application exercise recording, replay, history, and analysis in both environments? Keep transport details out of application logic.
4. What evidence demonstrates parity? Use the existing recorded ride to check import/replay, persistent history, deterministic processing, restart recovery, and eventually analysis results across hosts.

The current segment detector performs its geometric matching in TypeScript. Changing the database alone will not accelerate those loops; evaluate SQL preprocessing and query performance separately from matching performance.

## Current gap

The [browser workflow](mobile-browser-workflow.md) currently offers an in-memory simulator and a separate recorded-ride replay view. These are useful development tools, but do not yet fulfill the persistent interchangeable-host goal. Earlier desktop-companion and route-pack proposals describe an incremental starting point, not a permanent dependency on desktop analysis.
