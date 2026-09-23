# Handoff: native analysis store recovery and mobile navigation

## Goal and current blocker

The user wants the iPhone's segment analysis to stop publishing near-complete segments alongside a loop, then to use the Import from Mac and Segments & loops screens on the physical iPhone. The shared detector fix is committed as `1f8dc49`. Local replay of the phone capture removes all six 867–995 m cycling partials while keeping the 1,094 m / 200-traversal loop. **The on-phone analysis has not been rebuilt:** native DuckDB cannot open its durable store, so the bridge omits `database.query` and the phone UI cannot import or analyze yet.

The precise native error, captured by `f36d4c4`, is `databaseFailedToInitialize(reason: ... Failure while replaying WAL file .../analysis-native.duckdb.wal: Failed to commit: Assertion triggered .../art.cpp ... depth < key.get().len)`. The original `analysis.duckdb` also fails to open with the pinned DuckDB Swift 1.1.3. `ios/WorkoutAnalyze/DuckDBService.swift` currently tries the original and then `analysis-native.duckdb`; no third recovery store has been created. Do not delete or overwrite either existing DuckDB or the separate SQLite recorder journal.

## Preserved phone capture and deterministic replay

- Ignored, untouched physical-device capture: `/Users/kkrausse/Documents/repos/kkrausse/random/workout-analyze/data/phone-recovery-2026-09-23/`. It contains both DuckDB files and WALs, `recording-v1.sqlite` plus WAL, and diagnostic logs. Another earlier capture exists under `data/phone-recovery-2026-09-20/`.
- Run from `/Users/kkrausse/Documents/repos/kkrausse/random/workout-analyze`: `bun run scripts/replay-captured-analysis.ts`. It copies the native database **and WAL** to a disposable directory before Bun DuckDB 1.5.5 opens it; never open the preserved source directly with a writable host.
- Baseline prior to detector fix: 173 workouts, 195,928 samples, 31 routes, 1,477 traversals; exact route IDs and per-route workout/traversal counts reproduced locally with the saved config. The Mac `data/fitness.duckdb` has the same totals/settings but 1,313 saved traversals and five redundant lap segments rather than six. Details: `docs/phone-segment-reproduction-2026-09-23.md`.
- After the detector fix, the replay script intentionally exits nonzero because `missingFromReplay` lists the six suppressed old route IDs. Six newly surfaced longer segments fill the 12-per-sport limit; the total card count remains 31. Walking route IDs and support counts remain the same.

## UI work at handoff

The native app's saved-workout archive label `This iPhone` was incorrectly treated as proof of a local Bun host. It showed `Local analysis archive · Unavailable` even on the iPhone. Both **Workout library** (containing Import from Mac and Import saved iPhone workouts) and **Segments & loops** were hidden from Home whenever `analysisHostAvailable` was false. The current UI edits keep both pages navigable, show the native database-open failure clearly, and disable imports/rebuild until the database is available. Focused App/store tests and mobile typecheck passed. These edits should be committed before changing native recovery logic; the updated UI has not yet been installed on the phone.

The desktop mobile dev endpoint `http://127.0.0.1:4317/__workout/database` and the tailnet proxy at port 8443 answered a read-only query with 173 workouts. The phone development runner (`docs/iphone-dev-runner.md`) recently reported `transport: native`, `archiveSourceLabel: This iPhone`, three saved workouts, `analysisHostAvailable: false`, and no `database.query` capability. The active client ID changes on app reload; query `GET /__workout/run` again. The app currently loads `https://kevins-macbook-pro-2.tail7e28fb.ts.net:8443/` as its development UI source.

## Suggested next work

1. Confirm the UI change is committed and packaged. Fix native database recovery without changing the existing files: for example, after *both* existing stores fail, open a new uniquely named DuckDB 1.1.3 store, record the recovery choice and reasons in diagnostics, and verify `database.query` on the physical phone. Keep the original files/WAL and recorder SQLite intact; capture fresh copies before any migration.
2. Populate the new compatible store through the supported `Import from Mac` action, then `Import saved iPhone workouts`, then rebuild analysis using the same store actions as the UI (the runner exposes `app.actions`). Check source counts/config, saved-workout continuity, and resulting segment IDs. Do not issue lower-level bridge commands to duplicate a UI workflow.
3. Compare the phone's rebuilt route cards with the captured-input replay; note that importing Mac Parquet may order equal-timestamp samples differently for two iPhone rides. The desktop Browser Control Bun-backed CLI has repeatedly returned `Relay is draining for an explicit restart`, so visual comparison may still be blocked. Do not force-restart the shared relay.

Repo-wide commits must stage only `workout-analyze/...` paths. Other agents are modifying `oc-plugin-session-manager/` concurrently.
