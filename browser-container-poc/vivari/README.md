# Vivari feasibility POC

**Latest continuation:** [OpenCode compatibility checkpoint](../doc/vivari-opencode-checkpoint.md).
The real Node/Bun SQLite adapters pass, including reload recovery. Host packaging
passes normal SDK import/create/session/readback/close with the default in-memory
host database, plus explicit file-backed SDK recovery after page reload. Run
`bun scripts/package-opencode.ts host` (or `sqlite-adapter`), then the Browser
Control `scripts/opencode-packaged.js` runner against a booted patched runtime.
The checkpoint document explains selection, exact failures, and packaging scope.

Minimal browser-native runtime, command output, and real Vite preview. The local
Vite server delivers the harness/assets; fixture commands execute in Vivari workers.
See the [result card](../doc/vivari-result.md) for measured performance and the
blocked real-host checkpoint.

## Run

```sh
cd browser-container-poc/vivari
bun run setup
bun run dev
```

Open `http://127.0.0.1:5190`. Click **Boot and mount fixture**, **Install
dependencies**, then **Start Vite**. Wait for the fixture heading. **Test** runs
the fixture's Bun tests. The command field accepts a JSON argv array, for example
`["node","-e","console.log(process.cwd())"]`. Stop command terminates the most
recently spawned command; it is not a complete terminal/job manager.

The origin needs COOP/COEP, including on worker responses. Source files use
Vivari's OPFS persistence. Boot only mounts the fixture if its package manifest
is absent; changing the host fixture does not overwrite an existing VFS workspace.
Reinstallation was required after page reload in the tested SDK. Outer harness
HMR is disabled to avoid destroying an active guest run when editing the harness.

## Pins and adaptations

- `@vivari/core@1.0.0`, upstream gitHead
  `2629c71097238400c45aefa213ef61df4794c2b7`, MIT (`LICENSE.vivari`).
- Host Bun used during development: `1.4.0 (34cbb9a40)`; host dependencies are
  frozen in `bun.lock`.
- The original QEMU fixture and Bun lock were copied verbatim, then a test file
  was added. Direct fixture package versions remain identical.
- Published worker URLs are root-relative `/assets/*`; the Vite plugin serves
  and emits the exact packaged worker files at those paths, and `/sw.js`.
- Published SDK omits `vendor/npm-pack.bin`. `scripts/vendor-npm.ts` builds that
  asset from locked `npm@10.9.2`, using the pinned upstream archive format. No
  runtime work is delegated to host npm.
- Published SDK forwards outbound preview tunnels but omits inbound delivery.
  `src/main.ts` forwards kernel `vv-ws`/`vv-sse` envelopes to the preview iframe.
- `bun install --frozen-lockfile` actually delegates to npm and rewrites the Bun
  lock in this runtime. This is recorded as a compatibility failure, not frozen
  dependency reproducibility. Capture the resulting tree before comparisons.
- `node:test` was unavailable; the added test uses `bun:test` instead.
- Runtime source patches now live in `patches/`; installed packages and generated
  worker bundles are never hand-edited. The published SDK remains the default.

## Browser probes

Use the Bun-backed Browser Control CLI and retain its returned session ID:

```sh
browser-control execute 'await page.goto("http://127.0.0.1:5190"); return await snapshot()'
# Boot/install/start using the visible controls, then:
browser-control execute --session <id> --file browser-container-poc/vivari/scripts/profile.js
browser-control execute --session <id> --file browser-container-poc/vivari/scripts/capture.js
browser-control execute --session <id> --file browser-container-poc/vivari/scripts/opencode.js
```

Run those commands from the repo root. Browser Control's relay working directory
must be the repo root, `browser-container-poc`, or `vivari`. Profiling brings the
tab forward, measures five edits plus their restorations followed by three
preview-only reloads, and writes raw JSON under `doc/logs/vivari/` (gitignored).
It asserts document identity for HMR. There is 150 ms pacing between edits,
outside timed regions: an immediate restoration was lost by the watcher in an
earlier probe. Visibility is DOM geometry observed on the host animation clock,
not compositor paint or all-assets-loaded timing.

The OpenCode probe mounts `probes/opencode` at `/opencode-probe`, installs the
real pinned V2 SDK using npm with `--legacy-peer-deps`, then runs `bun host.mjs`
to import, create a host, and create a session for `/workspace`. Inspect
`window.hostProbe` (phase, output, error, duration); it has a 180-second timeout
per command. No provider credentials are needed for these checkpoints.
The sibling Bun lock records the host-side inspection dependency tree; the
browser's npm tree may differ. The harness does not run a network OpenCode host.

## Runtime-first OpenCode follow-up

The current direction keeps the normal pinned OpenCode SDK inside Vivari and
extends Vivari's runtime/dependency compatibility. See the
[updated plan](../doc/vivari_plan.md) and [runtime audit](../doc/vivari-runtime-audit.md).
SQLite uses browser-native WASM; QEMU/BusyBox remains an option for Linux commands.

After boot, run the isolated compatibility probes:

```sh
browser-control execute --session <id> --file browser-container-poc/vivari/scripts/runtime.js
# Inspect window.runtimeProbe until phase is complete or failed.
browser-control execute --session <id> --file browser-container-poc/vivari/scripts/sqlite.js
# Inspect window.sqliteProbe until phase is complete or failed.
```

The runtime runner checks seven cases under each of `bun` and `node`; current
SQLite/FFI builtin failures are expected and retained in its report. The SQLite
runner installs pinned sql.js 1.13.0, executes real database assertions, exports
to `/sqlite-probe/session.sqlite`, and recovers it in a second process. Re-running
the SQLite runner replaces that dedicated probe database. Neither runner proves
page-reload database recovery or a working OpenCode database adapter. Reports are
available on `window`; runners start asynchronously so Browser Control calls stay
short. Process timeouts are 15 seconds per baseline case and 90 seconds per SQLite
phase. No provider credentials are needed.

Build check: `bun run build`. For static deployment, serve `dist/` with the same
isolation headers. The production bundle includes all four worker files, the
service worker, and npm payload.

## Pinned source build and SQLite handoff

**Current checkpoint:** [scoped SQLite qualification passes](../doc/vivari-sqlite-qualification.md).
Run the combined local/browser gate from this directory with a Browser Control
session and the patched server already listening:

```sh
bun run qualify:sqlite tidy-otter-432
```

It rebuilds the patch, runs the shared Bun contract, local Vivari-worker API and
disk-restart tests, upstream verification, then built-browser API, ownership,
page-reload recovery and real OPFS failure/interruption tests. It navigates that
session to `http://localhost:5192/` (an optional URL argument overrides it),
replaces dedicated probe DBs, and writes a build-linked JSON report under
`../doc/logs/vivari/`. Browser-only probes require the dev server's source access.
The supported SQLite API is a subset; pure headless success is not OPFS proof.

Fast standalone checks:

```sh
bun test scripts/sqlite-server.test.ts
# Node >=24 required; the pinned Apple Silicon runner is:
bunx --package node-bin-darwin-arm64@24.18.0 node scripts/sqlite-headless.mjs
```

The shared contract lives in `probes/sqlite-contract.js`. Real OPFS fault tests
use unique `vv-sqlite-test-*` roots and remove only those roots afterward. They
exercise actual exclusive-handle write errors and termination before stream
close, not quota exhaustion or power-loss simulation. Failed DB paths require a
kernel restart; an unacknowledged operation may recover old or new data.

See [handoff](../doc/vivari-handoff.md) for the current checkpoint and limitations.
Source builds run on the Mac; application and SQLite execution run in browser
workers. Rust is only the existing Vivari VFS/codec/crypto build prerequisite.

Prerequisites: Bun 1.4.0; Rust 1.93.0 with `wasm32-unknown-unknown` and
`wasm32-wasip1` targets (`rustup target add --toolchain 1.93.0 ...`). The build
invokes wasm-pack 0.13.1 explicitly and respects upstream Cargo locks and the
npm lock migrated by Bun. It does not install/upgrade the Rust toolchain.

```sh
bun run setup
bun scripts/build-runtime.ts baseline
bun scripts/build-runtime.ts patched
# Run one server per build; inspect existing listeners before choosing ports.
VIVARI_DIST=.runtime/baseline/packages/core/dist bunx vite --host 127.0.0.1 --port 5191 --strictPort
VIVARI_DIST=.runtime/patched/packages/core/dist bunx vite --host 127.0.0.1 --port 5192 --strictPort
```

The script clones revision `2629c71097238400c45aefa213ef61df4794c2b7` into
gitignored `.runtime/<mode>`, builds web/headless WASM plus the upstream WASI test
fixture, builds the core SDK, and records patch/lock/asset SHA-256 hashes in
`.runtime/<mode>-build.json`. It accepts a pristine checkout or exactly the
recorded single patch; unrecognized source edits cause a failure. New patches
are applied to source with `git apply`, never to `node_modules` or emitted JS.
For editing an existing patched checkout, export its reviewed diff with
`git diff --binary HEAD > ../../patches/0001-sqlite.patch` from that checkout;
new source files must first be marked with `git add -N <your-files>`.

SQLite uses `@sqlite.org/sqlite-wasm@3.49.1-build1` (package metadata Apache-2.0;
SQLite code public domain), keeping SQLite **3.49.1**. The POC's frozen Bun lock
pins delivery of this dependency; the upstream build resolves it from the
enclosing POC installation. `LICENSE.sqlite-wasm` records the Apache license;
build output includes it and Vivari's license. `sql.js@1.13.0` remains a pinned
comparison probe (MIT), not the new runtime backend.

```sh
bun scripts/qualify-sqlite-backends.ts
bun test scripts/sqlite-server.test.ts
# From each .runtime/<mode> directory, on this Apple Silicon host:
bunx --package node-bin-darwin-arm64@24.18.0 node scripts/verify-node.mjs
# From repo root, after booting the patched browser:
browser-control execute --session <id> --file browser-container-poc/vivari/scripts/sqlite-api.js
browser-control execute --session <id> --file browser-container-poc/vivari/scripts/sqlite-owner.js
```

Inspect `window.sqliteApiProbe` / `window.sqliteOwnerProbe` until complete or
failed. The API runner replaces only `/runtime-probe/api.sqlite`. For a reload
check, save its report, reload the page, boot, set `state.sqliteMode = "recover"`
through Browser Control, then rerun `sqlite-api.js`. This mode does not rewrite
the database. Reset `state.sqliteMode` before running the full suite again.

`VIVARI_DIST` also selects production assets: use
`VIVARI_DIST=.runtime/patched/packages/core/dist bun run build` for deployment.
The asset middleware re-reads filenames after rebuilds. Changes to the Vite
configuration itself require restarting that host server because harness HMR is
disabled. An already-running browser retains its old workers until page reload.
