# Vivari runtime compatibility audit — September 6, 2026

## Latest continuation: real OpenCode SQLite adapters pass

See [OpenCode checkpoint](vivari-opencode-checkpoint.md). Both actual pinned
adapters now pass in Chrome, including reload recovery. A verified `node:sea`
fix and host packaging advance SDK import to missing tree-sitter WASM assets.
Normal host creation/session and full migrations remain unverified. The report
records ESM false-success and oversized SDK mount failures discovered here.

## Current checkpoint: scoped SQLite qualification passes

The [SQLite qualification report](vivari-sqlite-qualification.md) supersedes the
paused checkpoint below. Shared local/browser SQL cases, local worker API/restart,
built-browser API/ownership/page-reload recovery, real OPFS failures/interrupted
replacements, final upstream verification and patched HMR pass. Failed persistence
quarantines DB paths until restart. The supported API remains a subset; OpenCode
installation/import/create and migrations have not advanced.

## Historical continuation checkpoint: source build + experimental SQLite facades

See [handoff](vivari-handoff.md) for exact commands, live sessions, implementation
ownership model, and remaining work. The original observations below describe
the unpatched baseline; a source patch now exists in `vivari/patches/`.

- Pristine pinned source build, its 14 browser baseline cases, full headless
  verification, and five-edit Vite/HMR benchmark passed.
- Shared official SQLite WASM 3.49.1-backed Node/Bun facades passed memory/write/
  separate-process recovery tests, exact int64 binds/reads, binary data, foreign
  keys, transactions, JSON/RETURNING, and >1 MiB parameter/result transport.
- A cross-process termination test correctly rejected contention and killed the
  holder with status 143, but reopening failed `no such table: owner`. A
  multi-statement exec committed a prefix before BEGIN and the adapter failed
  to persist that prefix. The fix uses SQLite's parser to persist each autocommit;
  it passes the focused unit test and builds, but browser rerun is pending.
- The final patch adds a one-kernel-per-origin Web Lock and atomic OPFS file/
  manifest replacements with surfaced write errors. Actual OPFS fault/crash and
  page-reload recovery are still unverified. Do not call this slice complete.
- Highest OpenCode checkpoint is unchanged: installation failed EBADPLATFORM;
  normal SDK import/create and migrations have not been attempted in this slice.

The user requested this pause/handoff to save context. There is no new architecture
decision being requested. Continue correctness qualification before advancing SDK
startup. Full details and evidence are retained in the handoff above.

**Direction: run mainline OpenCode inside Vivari, extending runtime compatibility.
sql.js already runs real SQLite WASM in this browser. The OpenCode host remains
unverified; its normal SQLite API adapters and native dependencies need work.**

This supersedes the proposed OpenCode-profile adaptation in the original
[result card](vivari-result.md). See the [updated plan](vivari_plan.md).
QEMU/BusyBox remains an option for Linux commands with a shared workspace;
SQLite stays browser-native WASM in that option too.

## Pins and method

- Vivari SDK `1.0.0`, inspected upstream source at
  `2629c71097238400c45aefa213ef61df4794c2b7` (MIT).
- OpenCode packages `0.0.0-dev-19167`, unchanged local inspection installation.
- sql.js `1.13.0`, SQLite `3.49.1`, installed by real npm inside Vivari.
- Existing browser session at `http://localhost:5190/`; warm, already-booted
  runtime. These are compatibility checks, not a new performance benchmark.
- Browser Control scripts mount dedicated `/runtime-probe` and `/sqlite-probe`
  directories. Workspace fixture files are not part of these tests.
- No runtime patches or OpenCode-specific profiles were applied in this slice.

## Browser observations: 14 isolated baseline cases

Each case ran under both `bun` and `node`, with a 15-second process timeout.
All completed without timeout. Six successful observations and eight expected
compatibility failures; the condition case reports selection rather than
asserting that Bun compatibility is correct.

| Case | `bun` | `node` |
| --- | --- | --- |
| Conditional package import | Selects **node**; Bun global reports `1.1.34` | Selects node; no Bun global |
| `bun:sqlite` create/query | Fails: no in-VM backend | Same failure |
| `node:sqlite` create/query | Module not found | Module not found |
| `bun:ffi` libc `dlopen` | Explicit unsupported error | Same failure |
| `node:ffi` libc `dlopen` | Module not found | Module not found |
| Filesystem read/write/rename/stat/exclusive create | Pass | Pass |
| Child process stdout/stderr separation and exit 7 | Pass | Pass |

Both commands report `linux` / `wasm32`, Node `24.18.0`, and internal Vivari
version `0.0.1`. These are emulation-reported versions, not proof of matching
desktop runtime implementations.

## Real SQLite WASM: passed

`scripts/sqlite.js` follows the existing upstream `scripts/spike-sqlite.mjs`
loading pattern: `initSqlJs({ locateFile: f => require.resolve('sql.js/dist/' + f) })`.

The actual browser probe verified:

- Parameterized text and binary inserts.
- Foreign-key rejection of an invalid reference.
- Transaction rollback restores the previous value.
- JSON extraction and `UPDATE ... RETURNING`.
- Exact read of integer `9007199254740993` using sql.js `useBigInt`.
- Export of a real 16,384-byte SQLite database to Vivari's VFS.
- Reopening that file in a **second process** recovers the row and exact BLOB.

Observed host-clock durations: install 14,329.190 ms; write/assert/export process
107.720 ms; second-process recovery 60.350 ms. These are single samples and include
process startup. They are not query-latency measurements.

This is explicit export/import persistence. Page-reload recovery, crash durability,
concurrent connections, WAL behavior, 64-bit parameter binding, and OpenCode's
actual migrations have not been verified. sql.js initialization is asynchronous;
OpenCode's Node/Bun SQLite constructors are synchronous. A runtime adapter must
arrange initialization before those constructors run and implement the statement
and persistence semantics, rather than just return the sql.js module.

## Existing Vivari implementation seams

Source paths below are relative to the pinned upstream Vivari checkout.

| Location | Finding / use |
| --- | --- |
| `packages/runtime/toolchain-shims.js` | Real registry substitutions already exist: esbuild → esbuild-wasm, rollup → @rollup/wasm-node, lightningcss → lightningcss-wasm; bcrypt → bcryptjs with version remapping. Reuse the mechanism only with qualified compatible implementations. |
| `packages/core/src/workers/fetcher-worker.ts` | Consumes the package alias tables during npm metadata fetching. A natural place to deliver a genuine native-package drop-in without editing OpenCode. |
| `packages/runtime/module.js:105–129` | Conditions are hardcoded to `node`, `require`, `default`, `import`; `bun` is absent. Explains browser selection even when the Bun global is present. Decide runtime mode deliberately before changing this ecosystem-wide behavior. |
| `packages/runtime/builtins/bun.js:803–816` | FFI symbols are exposed for import, but `dlopen` throws; `read` has no implementations. |
| `packages/runtime/builtins/bun.js:819–860` | SQLite constructor tries installed WASM packages; every query calls a throwing `runBackend`. Installing sql.js alone cannot complete this shim. |
| `packages/runtime/index.js` | Builtin registration/bootstrap; possible location to initialize a WASM backend and register `node:sqlite` plus `bun:sqlite`. |
| `packages/runtime/node/bindings/fs.js`, `packages/kernel-host/fs-server.js` | Existing shared VFS and FD ownership are the right starting point for filesystem/locking semantics. |
| `packages/core/vite.config.ts` | Source build bundles nested workers and generated Rust/WASM artifacts. A reproducible source build is needed before shipping patches; a checkout alone is insufficient. |

## OpenCode dependencies: actual source requirements

Paths relative to `@opencode-ai/core/dist` in the pinned installation:

- **SQLite:** `database/sqlite.node.js` calls `DatabaseSync`, `prepare`,
  `setReadBigInts`, `setReturnArrays`, `all`, `exec`, `close`, and exposes
  `loadExtension`; constructor enables foreign keys and startup requests WAL.
  `database/sqlite.bun.js` instead calls `Database`, `query`, `safeIntegers`,
  `all`, `values`, `run`, `serialize`, `close`, and `loadExtension`.
  Extension loading must remain explicitly unsupported unless actually implemented.
- **Process locks:** both `util/process-lock-ffi.node.js` and `.bun.js` call
  libc `flock(fd, LOCK_EX | LOCK_NB)` and read errno. `util/process-lock.js`
  holds the FD until scope release, then closes it. A runtime bridge needs
  real contention and close/process-exit release, not a success-returning FFI stub.
  The Node path also uses FFI; switching conditions does not eliminate it.
- **File finding:** `filesystem/fff.node.js` already catches native package import
  failure and reports the backend unavailable. The Bun implementation imports
  its native package eagerly. `chunks/provider-13v61wc5.js` selects the existing
  ripgrep/fuzzysort fallback when FFF is unavailable. That fallback itself needs
  working ripgrep execution. FFF calls include `isAvailable`, `create`,
  `fileSearch`, `directorySearch`, `mixedSearch`, and `destroy`.
  A failed FFF initialization after selecting its layer returns empty results,
  so tests must check search correctness, not merely absence of an exception.
- **PTY:** `pty/pty.node.js` eagerly loads `@lydell/node-pty`, with an existing
  `OPENCODE_NODE_PTY_PATH` override, and imports `node:sea`. The Bun path imports
  `bun-pty`. Both need spawn, PID, data/exit events, write, resize, and kill.
  Ordinary `child_process` success does not prove terminal semantics.

Installation remains a separate obstacle: npm rejects the required `fff-bun`
package before runtime fallback selection. No platform spoofing or forced install
was used in this audit. Browser host import remains unattempted beyond that gate.

## Next implementation slice

1. Establish a pinned source-patch/build path for Vivari and baseline it against
   the published runtime before patching.
2. Implement a shared WASM SQLite backend with a `node:sqlite` facade first,
   because that is what current module resolution selects; use the same backend
   to complete `bun:sqlite`. Qualify synchronous initialization, statement flags,
   transactions, migration SQL, and persistence. Keep the official SDK unchanged.
3. Implement and test VFS lock ownership/release, then expose only the supported
   libc locking surface through a clearly bounded compatibility bridge.
4. Resolve native-package installation and test mainline import. Prefer existing
   real fallbacks where they work; investigate ripgrep and PTY requirements next.
5. If Linux commands justify a QEMU/BusyBox backend, prove one shared-workspace
   edit/read/watch round trip and command cancellation before expanding routing.

The SQLite engine is now demonstrated; the adapter is still engineering work.
This supports proceeding with a concrete first subsystem, not an estimate that
the entire OpenCode host is a couple of small fixes away.

## Reproduction and evidence

See [`../vivari/README.md`](../vivari/README.md). Executable cases and browser
runners are committed. Raw report:
`doc/logs/vivari/1788669174311-runtime-sqlite.json` (gitignored); this document
retains key outcomes even if the local report is unavailable.
