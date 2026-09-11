# OpenCode2 server-only baseline — implementation handoff

September 10, 2026. **P0 server-only baseline acceptance passed.**

## P1 continuation — September 11

The runtime-owned streaming bridge now replaces the process-per-request adapter.
Both the focused real-browser bridge suite and this complete server workflow pass
on clean runtime `48d4ca12fd478a6e28b0838830a4724ee771213e`. Distribution:
`028a96fdd9e2c86963e9ca4f2a46f41f16fe40996011caec70d702b45e731aa7`.
The source configuration pin is advanced. See the
[current P1 handoff](runtime-http-stream-handoff.md) for implementation, shutdown
semantics, regression receipts and continuation commands. The P0 record below
describes its earlier revision and the adapter P1 has now replaced.

## Latest: complete browser acceptance passed

The consolidated `serverBaseline.qualify()` passed on fresh origin
`http://127.0.0.1:43924`, Browser Control session `tidy-badger-830`, using the
normal (non-trace) package. All 19 delivered assets passed integrity checks.

- Real server readiness, session creation, and model SSE output passed.
- Model-driven **read, edit, grep, and glob all completed successfully**.
- Workspace readback verified exact `BASELINE_AFTER\n` bytes.
- Both graceful stops exited `{exitCode:0, signal:null, forced:false}`.
- Restart produced new service/listener identities; the old endpoint rejected requests.
- The real session and edited file survived the server-process restart.
- Runtime stopped and workspace flushed/closed successfully at completion.

Qualified runtime source: `bd5a60c13a317ed79ae579da182535b1925ece66` (clean build);
distribution: `f4b058e1cb4df1ea319f7baa3d54570a2e058872a4bbc9d8edb0f2312e24a0a9`.
The `runtime-source.json` qualified pin now identifies this revision.
OpenCode source remains `d7a7256bb6b0952f486c95718cfbf460b1570a56`;
model: `muse-spark-1.3-contributor-free`.

Local ignored receipt: `doc/logs/opencode-server/acceptance-2026-09-10.json`,
containing the result and selected PASS/tool/exit checkpoints, without credentials
or model reasoning. This qualifies server-process restart within the same runtime,
not a page reload or full runtime reopen. The browser origin is now used; select
a new port for another fresh acceptance run.

**At P0 acceptance:** this workflow became the regression gate for P1. P1 now
passes it as recorded above; the packaging adaptations below still apply.

## Earlier continuation: clean build prepared, browser connection blocked

- Rebuilt the normal server package: 2,945 inputs, 19 assets, no trace instrumentation.
- Clean release runtime build passed using explicit revision
  `bd5a60c13a317ed79ae579da182535b1925ece66`; the qualified configuration pin is
  intentionally still unchanged pending browser acceptance.
- Regenerated workspace distribution:
  `f4b058e1cb4df1ea319f7baa3d54570a2e058872a4bbc9d8edb0f2312e24a0a9`.
- All six fork headless contracts passed on native host Node 24.7.0:
  node-entry, fs-remove, stream-consumers, vm-import, process-warning, sea.
- Started the acceptance host at `http://127.0.0.1:43924/`; recheck availability
  when resuming. Browser Control's relay is reachable but its extension is disconnected.
  No browser acceptance was executed in this continuation. Reconnect the extension,
  then use the asynchronous qualification workflow below on this unused origin.

## What is implemented

- `vivari/scripts/package-opencode-server.ts` builds upstream
  `packages/cli/src/server-process.ts` at
  `d7a7256bb6b0952f486c95718cfbf460b1570a56`, in managed-service mode.
- Native ESM output, no CommonJS lowering, import.meta rewriting, renderer setup,
  Solid compiler, OpenTUI scratch adapter, or server source patch.
- Build-time graph audit rejects OpenTUI, Solid, and UI package inputs. Latest
  normal build: **2,945 source inputs, 19 delivered assets**.
- Receipt records input graph, source/lock identity, hashes, external dependencies,
  and adaptations. All search assets are included.
- `vivari/scripts/serve-opencode-server.ts` serves the isolated browser harness,
  runtime distribution, package assets, and public-model proxy on localhost.
- `vivari/probes/opencode-server.ts` contains a runnable acceptance workflow using
  Workspace/Runtime/Endpoint: health, create session, SSE, model read/edit/grep/glob,
  graceful stop, restart, old-listener rejection, session/edit retention, cleanup.

**The consolidated acceptance function now passes end to end**, as recorded above.
The following incremental results and implementation notes explain how it got there.

## Verified so far

In fresh browser origins using the fork distribution:

1. All delivered assets verified by SHA-256 before installation.
2. Real upstream server completed 41 database migrations and became ready.
3. Authenticated `/api/health` returned 200; `/api/session` created a real session.
4. Real model output streamed through `/api/event`, including
   `session.text.delta`, text completion, and successful execution.
5. Model-driven **read and edit succeeded**; read/verification saw the edited file.
6. Graceful `/api/service/stop` returned `{accepted:true}`; the execution exited
   with `{exitCode:0, signal:null, forced:false}` after the filesystem fix.
7. Fork contracts `node-entry`, `fs-remove`, `stream-consumers`, `vm-import`,
   `process-warning`, and `sea` all pass in headless guest workers.
8. `node-entry` and `fs-remove` also pass against native Node. This session used
   Node **24.7.0**, available at `~/.nvm/versions/node/v24.7.0/bin/node`; the prior
   migration qualified 24.18.0. Bare `node` in this harness resolves to a Bun shim.

Local, ignored browser evidence: `doc/logs/opencode-server/checkpoint.json`.
It contains selected fixture-related tool/text events and diagnostic logs, not
service passwords or model reasoning metadata. Browser session was
`tidy-comet-605`; its workspace was closed at handoff.

## Runtime fixes in the standalone fork

Canonical source: sibling `../vivari`, branch `browser-runtime`.

- `packages/kernel-host/coreutils.js`: `node` invokes `Module.runMain()` and
  propagates its async evaluation to the process loop. Previously `require()`
  lost entry top-level-await rejection and falsely exited zero.
- `packages/runtime/esm.js`: `.mjs`/`.mts` select ESM even without static module
  syntax. Needed for a plain top-level-await entry.
- `packages/runtime/node/internal/fs/rimraf.js` and `node/loader.js`: restore
  Node v24.18.0's recursive-removal algorithm behind the builtin factory. Missing
  `internal/fs/rimraf` broke normal server shutdown cleanup.
- `node/bindings/fs.js`: honor `readdir(..., 'buffer')`, which rimraf uses.
- Independent `node-entry` / `fs-remove` regression fixtures and architecture /
  workflow / roadmap notes accompany the changes.

The latest integration build and workspace distribution include these fixes,
rebuilt from clean commit `bd5a60c` before the complete browser acceptance.
The qualified fork revision in `runtime-source` configuration has been advanced.

## Remaining adaptations and blockers

1. **jsonc-parser package selection:** Bun leaves unresolved `./impl/format`
   requires in its UMD build. Select the same package's published ESM build;
   record this behavioral packaging choice. No dependency source is rewritten.
2. **Search executable discovery:** `/bin/rg` was delivered, but `which` rejects
   its mode because Vivari's chmod is a no-op. Upstream then tried selecting a
   native ripgrep for `wasm32-linux` and failed. Latest packager also delivers the
   runner at `/workspace/.server/cache/opencode/bin/rg`, which the unchanged
    upstream binary resolver accepts by file existence. **Fresh-run model-driven
    grep/glob with this delivery passed.** The resolver caches a failed
   lookup, so adding a file to an already-failed live server is not a valid retry;
   restart the server or use a fresh origin.
3. Search runner itself retains the pre-existing `package-ripgrep.ts` adaptations:
   host decoding of published compressed WASM, fixed receipt-managed WASM path,
   CJS lowering, published WASI shim limitations. Exact receipt is hashed.
4. FFF and filewatcher are disabled via upstream environment options; snapshots
   are disabled via configuration. Native PTY / FFF / canvas / simulation imports
   remain external, and those feature paths are not qualified.
5. Tree-sitter and Photon WASM/package/license assets are delivered conservatively;
   reducing unused assets remains an audit task.
6. The pinned catalog must be supplied as a snapshot. Its SHA-256 is
   `93c9a67396a5a459c4cd6c4ea3514ef86652019ed2bc1a3589dbc624c4a42ea9`.
   It is already in `.runtime/opencode-server-package/models.json` locally.
   Clean machines use `OPENCODE_MODELS_SNAPSHOT=/path/to/models.json`;
   reproducible remote snapshot distribution is not yet established.
7. `--trace` is an optional diagnostic build mode that logs static yield-site
   checkpoints in four server modules. It is recorded in the receipt. The final
   package at handoff was rebuilt **without** it; do not qualify a diagnostic build
   as the normal delivery accidentally.
8. The public `nemotron-3.5-lightning-free` route returned only keep-alives for
   minutes in both browser and host-side checks. Qualification now selects
   `muse-spark-1.3-contributor-free`, which returned real output promptly.

## Important pinned API detail

The prompt endpoint accepts prompt input, **not a model selection**. Extra
`model` and `agent` fields are ignored by decoding. Set the model at session
creation with `{model:{providerID:'opencode', id:'...'}}` or through
`POST /api/session/:id/model`. The identifier field is `id`, not `modelID`.

Service auth is read from the **guest-created** registration under
`/.server/state/opencode/service-local.json` through Workspace.fs. Never log its
password or copy host OpenCode credentials into this harness.

## Resume here

From `random/browser-container-poc/vivari`:

```sh
# If prerequisites are not installed, use the existing pinned source checkout:
# .runtime/opencode-v2-source (anomalyco/opencode at d7a7256...)
# and its frozen bun.lock dependencies.
bun install --frozen-lockfile --cwd probes/ripgrep
bun scripts/package-ripgrep.ts
bun scripts/package-opencode-server.ts
bun scripts/build-runtime.ts
bun ../workspace-api/scripts/distribution.ts
PORT=43923 bun scripts/serve-opencode-server.ts
```

Use Browser Control **CLI only**, following its skill:

```sh
browser-control execute 'await page.goto("http://127.0.0.1:43923/"); await page.waitForFunction(() => !!window.startServerBaseline); return await page.evaluate(() => window.startServerBaseline())'
```

Continue with the returned session ID. Start the long acceptance asynchronously
so CLI timeouts cannot strand an execute call:

```js
await page.evaluate(() => {
  window.baselineResult = { status: 'running' }
  window.serverBaseline.qualify().then(
    result => window.baselineResult = result,
    error => window.baselineResult = { status: 'FAIL', error: String(error) },
  )
})
return 'qualification started'
```

Inspect the page/result later. The contract permits 180 seconds for model/tool
completion and bounded readiness/shutdown waits. Require `RESULT ... PASS`, all
four successful tool events, actual edited bytes, clean exits, a new listener
identity, and session retention. Do not count launch/import/exit-zero alone.

Always choose a fresh origin/port for a new full run: Workspace v0 only supports
id `default`, and the harness refuses a previously used acceptance store. No
browser storage clearing is needed.

If a future run exposes a runtime blocker, isolate it in the fork, add a focused
contract, rebuild and repackage the distribution, then rerun in a new origin.
P0's workflow is the regression gate for the HTTP bridge and passed again for P1.
Use the current P1 handoff for the latest qualified source and distribution.

## Concurrent work / operational notes

- Existing changes in `opencode-chat`, `todo-app-demo`, and other experiments
  belong to other work; no changes from those paths are part of this checkpoint.
- The source checkout contains a pre-existing TUI optional-process-metrics patch;
  it is accepted only as the exact known patch and excluded from the audited
  server graph. The packager does not apply or modify it.
- Source instructions request an `opencode-dev` skill; loading it failed because
  it is not available in this environment. The general OpenCode skill was loaded.
- All changes must be committed with explicit paths in their respective repos.
