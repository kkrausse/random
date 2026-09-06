# SQLite qualification checkpoint — 2026-09-06

**The scoped SQLite feasibility gate passes locally and in Chrome.** The earlier
termination regression is resolved. This is a qualified positional-parameter
SQLite subset, not full Node/Bun conformance or a working OpenCode host.

## Reproducible local → browser gate

From `browser-container-poc/vivari`, with the patched server running on port 5192:

```sh
bun run qualify:sqlite tidy-otter-432
# Optional third CLI argument: another patched harness URL.
# bun run qualify:sqlite <session> http://localhost:<port>/
```

This one local command builds the recorded source patch, runs the Bun engine
contract and Node-worker runtime probes, runs upstream verification, navigates
the selected browser session to the harness, and checks API/ownership/reload/OPFS.
It saves a JSON report containing the build receipt and browser results. It
replaces the dedicated probe databases and reloads that harness tab.

There are two levels of shared test code:

- `probes/sqlite-contract.js`: identical SQL assertions against real SQLite WASM
  and Rust VFS in Bun and a real Chrome worker. Chrome uses the actual OPFS mirror;
  the Bun unit test uses a mock persistence hook for fast engine feedback.
- `probes/runtime/sqlite-api.cjs` and `sqlite-owner.cjs`: identical guest programs
  through the real facades, FS server and synchronous SAB transport in local
  Node worker_threads and the built browser runtime. The headless test adapter
  saves SQLite snapshots to an isolated temporary host directory and restores
  them in a fresh kernel. It is explicitly not an OPFS emulation.

A pure headless pass cannot guarantee browser behavior. The **combined command**
is the passing gate: it includes real browser storage, Web Locks, worker teardown
and bundled-runtime delivery instead of assuming they behave like local files.

## Passing evidence

Environment: Bun 1.4.0, host Node 24.18.0 on Apple Silicon, Chrome 152 on macOS,
12 reported logical cores, 16 GB browser-reported device memory. Vivari revision
`2629c71097238400c45aefa213ef61df4794c2b7`; SQLite 3.49.1 from official
`@sqlite.org/sqlite-wasm@3.49.1-build1`. Final workers:
`fs-worker-BDLnKstk.js`, `process-worker-DU7Me_3K.js`, kernel `kernel-worker-uzKRS857.js`.

| Gate | Result |
| --- | --- |
| Pinned patched source build | PASS |
| Shared engine contract + injected-flush regression | PASS, 2 Bun tests; 13 shared contract checks |
| Local worker API, both `node` and `bun` commands | PASS: memory/write/second-process recover |
| Local ownership + complete kernel restart | PASS: contention, kill status 143, rollback, both databases recovered |
| Built Chrome runtime API, both commands | PASS: memory/write/second-process recover |
| Built Chrome ownership | PASS: SQLITE_BUSY; kill 143; committed prefix retained |
| Page navigation/reload → new kernel | PASS: database recovered by both commands |
| Real OPFS storage qualification | PASS, 31 recorded checks |
| Two complete kernels on the same origin | PASS: second kernel's persistent open rejected; memory SQL works; one exclusive `vivari-vfs-owner` lock |
| Final upstream `verify-node.mjs` | PASS, 90 processes spawned |
| Patched harness TypeScript + production build | PASS |
| Final patched Vite/HMR | PASS, five edits + five restorations + three preview reloads |

The shared contract additionally checks trigger bodies/quoted semicolons,
successful prefixes before SQL errors, savepoints, transaction rollback, int64
limits, infinities, NaN → SQL NULL, parameter count errors, ATTACH rejection,
and `PRAGMA integrity_check`. API tests retain the >1 MiB parameter/result,
BLOB, JSON, foreign-key, RETURNING, serialization, and connection contention cases.

Raw ignored evidence:

- `logs/vivari/1788674794578-sqlite-qualification.json`
- `logs/vivari/1788675094552-profile.json`

The two-kernel check is reproducible with `scripts/sqlite-kernel-lock.js` in a
second booted tab at the same origin while the first remains booted. The temporary
second session `cosmic-tiger-633` was torn down/deleted after the check. Its presence
exposed existing preview SW routing ambiguity: the SW can choose the other kernel
tab even after teardown. Closing that test tab and renavigating the preview
restored routing; SQLite ownership itself remained correct.

HMR samples (ms), ordered warm edits: **55.015, 32.635, 37.850, 36.940, 36.835**;
median **36.940**, worst **55.015**. Restorations: 39.770, 35.475, 37.805, 34.525,
37.080. Preview reloads: **49.695, 36.205, 33.015**. Same-document identity was
asserted for every HMR edit/restore; the source was restored. The benchmark uses
the host clock and visible DOM geometry, with 150 ms pacing outside timed regions.
Guest fixture Vite remains 7.1.4. Install was 12,996.660 ms and delegated to real
npm as before; it is not evidence of frozen Bun lock semantics.

## Failure semantics now enforced

1. SQLite's own parser identifies exec boundaries. Every committed prefix is
   persisted before a later BEGIN; triggers are not split on semicolons.
2. A failed persistence operation poisons the connection **and quarantines the
   database path until kernel restart**. Closing/reopening cannot accidentally
   promote failed in-memory bytes into an acknowledged commit.
3. An acknowledged operation has awaited the OPFS flush. An operation that fails
   or is interrupted before acknowledgment can recover as old **or** new:
   replacing a DB file can succeed before replacing the manifest fails.
4. Tests lock actual OPFS files with exclusive sync access handles, provoking
   Chromium's real `NoModificationAllowedError` for database and manifest writes.
   DB-file failure recovers the preceding committed value; manifest failure in
   this run recovered the new, unacknowledged value. Both reopen with integrity OK.
5. Interruption tests write into actual replacement streams, pause before close,
   terminate the worker, and reopen in another worker. DB-stream interruption
   recovered the old value; manifest-stream interruption recovered the new value.
   Both retain integrity and release their Web Lock.

## Remaining limits / assessment point

- These tests cover actual OPFS errors and worker interruption, **not physical
  power loss, OS/browser-process crash, quota exhaustion, or storage eviction**.
- One live connection per canonical DB pathname; one persistent kernel per
  origin. WAL, native extensions, ATTACH, path aliases, named bindings and read-only
  options remain unsupported. Errors are not fully Node/Bun-compatible structured
  error objects. Raw filesystem mutation of an open database is outside the model.
- Runtime snapshot persistence exports entire databases, including on reads;
  large-database performance has not been measured. No scalable WAL/VFS claim.
- Actual OpenCode migrations remain unrun. The highest OpenCode checkpoint is
  still installation failure (`EBADPLATFORM`, required `@ff-labs/fff-bun@0.10.5`).
  No SDK import or `OpenCode.create()` has succeeded.

**Recommendation:** this is a useful SQLite checkpoint for the requested
assessment. Next investigate the packaging barrier, then run real SDK import and
migrations as soon as the graph permits. Keep the combined SQLite gate mandatory
for future runtime changes; expand the subset when a real call path needs it.
