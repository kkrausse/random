# Architecture north star

Status: design direction agreed in discussion on 2026-09-21; not a description of completed implementation. Storage selection and execution placement remain open. This document takes precedence over earlier proposals where they assume desktop-only analysis or a required companion computer.

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

## Decisions deliberately left open

Do not select or migrate storage on the strength of this document. Evaluate placement symmetrically across the two hosts:

| Option | iPhone | Mac browser development |
| --- | --- | --- |
| Analysis database behind the host contract | Native engine in Swift host | Native engine in Bun host |
| Analysis database in shared web runtime | DuckDB-Wasm in WKWebView | DuckDB-Wasm in browser |

A browser-versus-iPhone split is not the intended architectural boundary. Both options still need persistence, recovery, version compatibility, and lifecycle verification. Shared TypeScript consumers introduce a separate execution question: native database bindings alone do not provide a runtime for shared TypeScript processing.

Before choosing, establish:

1. Which processing must continue during a locked-screen ride, and which can catch up when the app opens? Durable capture must survive UI suspension; live metrics, recognition, and archive analysis may have different deadlines.
2. Who owns durable writes, consumer checkpoints, and projection rebuilds? Define recovery behavior before optimizing database access.
3. What host operations and capability signals let the same application exercise recording, replay, history, and analysis in both environments? Keep transport details out of application logic.
4. What evidence demonstrates parity? Use the existing recorded ride to check import/replay, persistent history, deterministic processing, restart recovery, and eventually analysis results across hosts.

The current segment detector performs its geometric matching in TypeScript. Changing the database alone will not accelerate those loops; evaluate SQL preprocessing and query performance separately from matching performance.

## Current gap

The [browser workflow](mobile-browser-workflow.md) currently offers an in-memory simulator and a separate recorded-ride replay view. These are useful development tools, but do not yet fulfill the persistent interchangeable-host goal. Earlier desktop-companion and route-pack proposals describe an incremental starting point, not a permanent dependency on desktop analysis.
