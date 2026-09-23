# Native UI source state

`BuildManager` is the sole native authority for UI source selection. `developmentURL`, when present, wins; otherwise the active bundled/installed build supplies the UI. Startup, native recovery, `devSource.configure`, build activation/rollback, and reload all resolve through `BuildManager.activeUIURL()`.

The existing `appBuild.status.active` field is **not the effective web UI source**. Its strict phase-1 contract is the active bundled/installed build artifact and engine pointer. Its `source` remains `bundled | installed`; React must label it “Build source” rather than “Current source.” `lastFailure` is an unresolved current build/load operation failure and clears when a new load starts or the current generation completes its hello.

Native lifecycle truth is available without changing the strict bridge contract in the `webBuild` diagnostics row under `details.uiSource`:

- `configured`: selected development origin or build pointer
- `targetUrl`: URL of the current load generation
- `loadedUrl`: last URL that completed `bridge.hello` in this process
- `loadState`: `notLoaded | navigating | awaitingHello | ready | failed`
- `currentFailure`: failure for the current target, or null
- `lastFailureHistory`: retained historical failure, not current health
- `generation`: native load generation

A future first-class `appBuild.status.uiSource` requires a coordinated shared-contract revision because current clients reject unknown status keys.

## Native analysis database

The installed shell opens `Application Support/WorkoutAnalyze/analysis.duckdb` through the official `duckdb-swift` package pinned to 1.1.3. `bridge.hello` advertises the seven `database.*` capabilities only when that durable store opened successfully. The WKWebView adapter exposes generic execute/query/bulk/transaction primitives; schemas, normalization, and analysis remain in shared TypeScript.

At startup, an existing recovery store (oldest first) is authoritative. If it cannot open, the shell reports the failure and does not silently select a later empty recovery store. Without a recovery store, the original and native stores are tried in order; a failed **existing** native store stops startup rather than generating an empty recovery. A missing database with a stranded `.wal` is never recreated at that basename. Existing databases, WALs, and the independent `recording-v1.sqlite` journal remain in place. The `analysisDatabase` diagnostics row and database log entries record failures and selection; availability enables the `database.*` bridge capabilities.

An explicit `analysis-recovery-selection.json` marker can select a separately imported `analysis-restored-*.duckdb` artifact ahead of the stranded oldest recovery. Before first selection the native engine verifies its SHA-256, absent WAL, source WAL fingerprint, data counts and route/traversal/workout identity; only then does it atomically record `analysis-recovery-activated.json`. Later launches require the matching marker and receipt, allowing normal checkpointed writes to change the selected database file. Any failed verification is diagnostic and fails closed without selecting an empty fallback. The original databases/WALs and SQLite recorder journal remain untouched; details and physical-device evidence are in `docs/phone-native-wal-recovery-2026-09-23.md`.

Each transaction ID owns one DuckDB connection. The actor serializes operations, abandoned sessions expire after 60 seconds, and all open transactions roll back when the app leaves the active scene. Completed transactions and standalone writes checkpoint when no transaction is open, so a normal relaunch reads the database file without having to replay a large outstanding WAL. Native query cursors page 200 rows at a time; web bulk inserts are split below the bridge size limit. None of this changes or replaces the recorder's SQLite journal.
