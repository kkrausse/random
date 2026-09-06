# Vivari handoff — 2026-09-06

## Resumed SQLite checkpoint (supersedes the paused status below)

See [SQLite qualification](vivari-sqlite-qualification.md) for the current
passing gate and precise limitations. `bun run qualify:sqlite tidy-otter-432`
now passes shared local/browser SQL cases, local worker API and restart, built
Chrome API/ownership, page-reload recovery, and real OPFS failure/interruption
tests. Final upstream verification and patched Vite/HMR also pass.

The committed-prefix bug is verified fixed in the browser. Persistence failures
now quarantine the DB pathname until kernel restart. Nonfinite number transport
and positional-parameter count validation are covered. Current FS worker:
`fs-worker-BDLnKstk.js`; process worker `process-worker-DU7Me_3K.js`.

SQLite is a qualified subset, not full Node/Bun conformance. Actual quota
exhaustion/power-loss behavior, large-database performance and OpenCode migrations
remain open. OpenCode's installation/import/create checkpoint is unchanged.
`tidy-otter-432` is retained with the patched Vite fixture running on port 5192.
Inspect sessions/listeners before continuing; the driver twice found that session
at `about:blank`, recovered by navigating explicitly to the harness URL.

## Historical pause record

**Paused at the user's request to save context. SQLite is an experimental
implementation, not a completed slice. No new OpenCode host checkpoint passed.**

Read applicable AGENTS.md, `vivari_plan.md`, `vivari-runtime-audit.md`, and
`../vivari/README.md`. Keep official OpenCode `0.0.0-dev-19167` and its normal
`OpenCode.create()` inside Vivari. The original stop-and-flag rules still apply.

## Highest passing checkpoints

- Built pristine Vivari revision `2629c71097238400c45aefa213ef61df4794c2b7`
  from source, including its existing Rust/WASM components. Source build runs
  on the Mac; runtime/SQLite execution remains in browser workers.
- Pristine source build reproduced all 14 published-runtime probe outcomes in
  Chrome: filesystem/subprocess success, Node conditions selected under Bun,
  and the same missing SQLite/FFI failures.
- Pristine source build's complete upstream `verify-node.mjs`: **PASS**, 90
  processes spawned. It initially needed the WASI test fixture; the build script
  now builds that too.
- Baseline browser Vite/HMR: five edit/restore cycles and three preview reloads
  passed. Edit times: 63.830, 36.690, 35.000, 36.475, 34.260 ms. Source restored.
- Patched browser API tests: **memory, write, second-process recover all passed**
  on `fs-worker-DtrPFmk-.js` / `process-worker-DbIzBuWo.js`, including positional
  bindings, exact int64 binding/reads, BLOBs, rows/arrays, rollback, foreign keys,
  JSON, RETURNING, a 1,100,000-character parameter/result, Bun serialization,
  same-process connection contention, and explicit unsupported operations.
- Patched upstream `verify-node.mjs`: **PASS**, before the final multi-statement
  persistence and Web Lock changes. It needs real host Node with WASM bytes
  injected explicitly; Bun's file-fetch behavior had hidden that headless issue.
- Final focused unit test `bun test scripts/sqlite-server.test.ts`: **PASS** for
  committed-prefix survival, owner release/rollback, and injected flush failure
  poisoning. This uses real SQLite WASM and VFS but a mock persistence hook;
  it does not qualify OPFS failure/crash behavior.
- Final patched source build: **PASS**. Current FS worker is
  `fs-worker-BKAxMrE_.js`, kernel `kernel-worker-BR_x2Qha.js`.

**Exact OpenCode status:** installation remains the highest attempted checkpoint,
with the previously recorded `EBADPLATFORM` for required `@ff-labs/fff-bun@0.10.5`.
No SDK import, `OpenCode.create()`, real session, migrations, or tools were run
in this continuation. No credentials were requested.

## First thing to resume: rerun the failing browser ownership regression

Reproduction after booting patched `http://localhost:5192/`:

```sh
browser-control execute --session tidy-otter-432 --file browser-container-poc/vivari/scripts/sqlite-owner.js
browser-control execute --session tidy-otter-432 'return await page.evaluate(()=>window.sqliteOwnerProbe)'
```

Last observed result: holder printed `SQLITE_OWNER_HELD`; a second process
correctly got SQLITE_BUSY; killing holder returned **143**; recovery failed:

```text
SQLITE_ERROR: sqlite3 result code 1: no such table: owner
```

Expected: recovery sees `committed`, not the uncommitted update. Confirmed root
cause: one `exec` contained CREATE/INSERT commits followed by BEGIN/UPDATE.
The adapter persisted only at the end of the whole exec, when autocommit was
false, so it missed the committed prefix. On process death the whole connection
closed, and only the old empty snapshot remained in VFS.

**Fix is implemented and built, and passes the focused unit test; browser rerun
is pending.** SQLite's own prepare/tail parser now iterates statement boundaries
and persists each autocommit before a later BEGIN. It also persists successful
prefixes of failing multi-statement execs. Do not replace this with splitting on
semicolons (triggers/quoted strings break that).

An earlier separate reopen failure was `SQLITE_DESERIALIZE: 23` (SQLITE_AUTH):
the guest ATTACH-denying authorizer was installed before trusted deserialize,
which internally needs ATTACH. Moving it after deserialize fixed second-process
reopen in the browser. FREEONCLOSE also owns buffers on deserialize failure;
the extra free was removed.

## Files and implementation model

- `../vivari/scripts/build-runtime.ts`: baseline/patch/build path; immutable
  upstream revision, locked dependencies, artifact/patch SHA-256 receipts in
  ignored `.runtime/*-build.json`. It refuses unrecognized source edits.
- `../vivari/patches/0001-sqlite.patch`: full source patch, including upstream
  architecture/agent/roadmap notes. Editable checkout is `.runtime/patched`;
  never edit emitted workers or installed package files.
- `kernel-host/sqlite-server.js` in that patch initializes official SQLite WASM
  in the **existing FS worker** before ready; thin Node/Bun facades use the
  existing synchronous SAB bridge. Request/result bodies use temporary VFS
  files and normal chunked fd IO, avoiding the 1 MiB SAB limit.
- One live connection per canonical database path, even in the same process.
  Client unregistration closes its databases, rolling back active transactions.
  Symlink/hardlink aliases and ATTACH are rejected. Raw FS mutation of an open
  DB is outside the ownership model. WAL is not implemented: the actual memory
  journal result is returned. Native extensions remain unsupported.
- Committed snapshots export without closing the SQLite connection, mutate VFS
  as whole files, and wait for the OPFS flush before acknowledgement. The mirror
  now uses writable-stream atomic replacements for file/manifest contents and
  propagates queued write errors. Failed flushes poison the SQLite connection.
- Final patch additionally takes a lifetime browser **Web Lock** for one
  persistent kernel per origin. This cross-kernel guard has **not been browser
  tested yet**. It is not the libc flock API needed by OpenCode.
- Ordinary `fsync`/`fdatasync` are still upstream no-ops. SQLite does not use
  them; it explicitly awaits the persistence backend through its deferred RPC.

## Backend choice and build tools

`@sqlite.org/sqlite-wasm@3.49.1-build1`, package gitHead
`003ed2ee58785690dd3feeba45345caa4bc98657`, package metadata Apache-2.0 / SQLite
public domain. SQLite engine stays **3.49.1**. `sql.js@1.13.0` (MIT) remains a
comparison dependency only. `bun scripts/qualify-sqlite-backends.ts` proves:
sql.js binds BigInt as TEXT, omits int64-bind/autocommit exports, and rolls back
an active transaction during export; official WASM preserves these semantics.
This comparison ran on the host using WASM, not native SQLite.

Build tools: Bun 1.4.0; Rust 1.93.0; wasm-pack 0.13.1; upstream locked build
Vite 8.1.5; harness Vite remains 7.1.4. Rust was just a source-build prerequisite.
A Rust 1.94.0 download attempt timed out; existing 1.93.0 works and is used.
The build script itself does not install/change Rust. See README for commands.

## Live environment to retain

| Browser Control session | Origin | Runtime |
| --- | --- | --- |
| `brisk-sparrow-097` | `http://localhost:5190/` | original published SDK |
| `clever-walrus-097` | `http://localhost:5191/` | source baseline, Vite fixture running |
| `tidy-otter-432` | `http://localhost:5192/` | older loaded patched workers; reload for final build |

Host servers on all three ports were retained. Inspect listeners/sessions first.
Port 5192 was restarted once to adopt dynamic asset enumeration. Config HMR is
disabled; stale cached asset names previously returned HTML for a new worker URL
and hung boot. `../vivari/browser-control.todo.md` records this resolved issue.
On `tidy-otter-432`, CLI `state.sqliteApiResult` has the passing API report and
`state.sqliteOwnerResult` has the failing ownership report. Reports in page
globals disappear on reload; save evidence before navigating.

## Remaining work / qualification gaps

1. Reload patched page, boot, run API + owner probes. Then save results, reload
   again, boot, set CLI `state.sqliteMode = 'recover'`, rerun `sqlite-api.js`.
   **Page-reload database recovery has not yet been verified.**
2. Qualify the lifetime Web Lock with two kernels on one origin and release on
   termination/reload. Test actual OPFS write/quota failure and interrupted
   snapshot/manifest replacement. Current atomic-write design is not evidence
   of crash/power-loss durability. Review failed-write/reopen semantics carefully.
3. Rerun upstream verification after the final changes and Vite/HMR against the
   patched runtime. Only the source baseline HMR has been measured in this slice.
4. Harden only required API correctness: numeric edge cases (JSON currently
   cannot represent nonfinite numbers), errors/codes, transaction error paths,
   statement validation, and supported options. Named bindings/read-only options
   are not implemented. OpenCode's observed path uses positional parameters and
   default writable constructors. Do not claim full Node/Bun SQLite conformance.
5. Resolve the real SDK packaging barrier using allowed host-side packaging or
   explicit genuine substitutions, then normal import/create. Run actual
   migrations as soon as the graph permits. libc locks, FFF/ripgrep, PTY, and
   command/cancellation remain untouched. No architecture decision is currently
   being requested; this is a user-requested handoff, not completion.

Raw baseline HMR report: `logs/vivari/1788672022569-profile.json` (ignored).
Source receipts and build artifacts stay ignored. The committed audit/handoff
retain passing results and exact failures without relying on ephemeral reports.
