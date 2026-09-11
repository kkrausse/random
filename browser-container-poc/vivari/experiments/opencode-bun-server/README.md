# Conventional Bun server build probe

Invocation-only entry using the existing installed OpenCode V2 source image at
`../../.runtime/opencode-v2-source`. Required revision:
`d7a7256bb6b0952f486c95718cfbf460b1570a56`; upstream `bun.lock` SHA-256:
`b6ebc10fd743b192bf81437c0e95a89b850daffa6cfe9de0ba6491c13f1c3764`.

From this directory, reuse that image with ordinary dependency symlinks (run
once in a fresh local `node_modules`; this does not install workspace packages):

```sh
bun -e 'import {mkdirSync,symlinkSync,realpathSync} from "node:fs"; mkdirSync("node_modules/@opencode-ai",{recursive:true}); symlinkSync(realpathSync("../../.runtime/opencode-v2-source/packages/cli"),"node_modules/@opencode-ai/cli"); symlinkSync(realpathSync("../../.runtime/opencode-v2-source/packages/cli/node_modules/effect"),"node_modules/effect");'
bun run build > ../../.runtime/opencode-tree-sitter-build.log 2>&1
```

The package manifest describes local file dependencies; the symlinks preserve
the frozen upstream workspace's installed dependency resolution. Do not infer
that a fresh standalone `bun install` has been qualified. An initial
`bun install --ignore-scripts` using relative `link:` dependency declarations
failed with `FileNotFound: failed linking dependency/workspace to node_modules`
for both dependencies; those declarations were replaced with `file:` and the
existing image was linked explicitly. The generated experiment lock is ignored;
the upstream lock is the dependency pin.

The pinned CLI package exports `./server-process` from `src/server-process.ts`
but lists only `bin` in its publish `files`; this probe uses local source rather
than assuming npm provides a usable source export. No registry package install
was attempted.

Then from `browser-container-poc/vivari`:

```sh
/Users/kkrausse/.nvm/versions/node/v24.7.0/bin/node scripts/opencode-bun-headless.mjs > .runtime/opencode-storage-headless.log 2>&1
```

The probe mounts build output unchanged at `/app`, uses a fresh VFS and isolated
disk-backed SQLite snapshots with `/home/direct`, probe-only auth and the direct probe's explicit
feature-disable flags. It has a 180-second deadline, input/mount/command/listen/
exit checkpoints, and terminates owned workers. Exit zero alone fails acceptance.
`VIVARI_SOURCE` uses the shared runtime resolver. Build artifacts and logs remain
under ignored `.runtime`.

## September 11 initial Bun-target result (historical)

Bun **1.4.0 (34cbb9a40)** successfully bundled **2,938 modules** in 536 ms using
only `bun build ./server.ts --target=bun --outdir=../../.runtime/opencode-bun-server`.
Output: `server.js` (27,739,934 bytes) and four WASM files for Photon, tree-sitter,
Bash and PowerShell. JS SHA-256:
`d2d2ab971a7502e84ae12950477bd95a604f11f6e563efb5c5e9f46d67bb7891`.
No custom plugin, source edit, import rewrite, define or external flag was used.

On clean runtime `80d5cdd599fce4fa4817128461c865e009109d34`, native Node 24.7.0
headless execution stopped at the first concrete guest blocker:

```text
OPENCODE_BUN_COMMAND bun /app/server.js
Error: Cannot find module 'ws' from '/app'
OPENCODE_BUN_EXIT: code 143, signal SIGTERM, workerErrors includes MODULE_NOT_FOUND
```

The emitted JS retains static `ws` imports at lines 48153 and 517977 despite no
explicit external configuration. Only emitted files were mounted; `ws` was not
delivered. This is an observed resolution/delivery boundary, not yet proof that
WebSocket behavior is missing. Worker cleanup accounts for 143. There was no
listener checkpoint or server acceptance. The preexisting upstream TUI file
modification remains, so this is not a clean-upstream reproducibility receipt.

## September 11 approved Node-target continuation

The initial Node-target package build command used ordinary resolution:

```sh
bun build ./server.ts --target=node --outdir=../../.runtime/opencode-bun-server
```

Bun 1.4.0 successfully bundled **2,952 modules** (519 ms initially; 307 ms on
the clean-output repeat). Fresh output contains only `server.js` (28,319,086
bytes) and `ffi-rs.darwin-arm64-r0yfvhwh.node` (705,384 bytes). JS SHA-256:
`491a00fcac0927a161da09459d81aec5442f3c47b6489ac96f9166ec124a33e0`.
The native asset is delivered unchanged; its execution is not qualified.

**`ws` resolution passed.** The artifact contains the `ws@8.21.0` implementation
(including `lib/websocket.js`, `lib/websocket-server.js`, wrapper and index).
A search for bare `ws` static imports, `require()` and `import()` finds none.
No special external, plugin, dependency rewrite or runtime fix was added.

The same isolated headless probe on runtime `80d5cdd` reached:

```text
OPENCODE_BUN_COMMAND bun /app/server.js
Error: Cannot find module './impl/format' from '/app'
OPENCODE_BUN_EXIT: code 143, signal SIGTERM, workerErrors includes MODULE_NOT_FOUND
```

This comes from bundled `jsonc-parser@3.3.1/lib/umd/main.js`: the emitted UMD
factory retains `require2("./impl/format")` at line 56613. Resolution occurs
relative to `/app`, where that file is absent. This is the next concrete blocker;
whether the correct remedy is generic delivery, conventional bundler configuration
or loader semantics needs a focused reduction and native comparison.

The first Node-target probe also mounted four stale WASM assets from the earlier
build. To confirm a fresh-artifact result, the output directory was archived with
the following command from `vivari`, then build and probe were repeated:

```sh
bun -e 'import {renameSync} from "node:fs"; renameSync(".runtime/opencode-bun-server", ".runtime/opencode-bun-server-before-clean-node-" + Date.now())'
```

The fresh probe mounted only the JS and `.node` files and reproduced the same
failure, with no listener checkpoint. The guest execution command remains `bun`;
`--target=node` changes the host build's resolution, not the probe's guest command.
The source pin, lock hash and preexisting upstream TUI modification are unchanged.
Logs: `.runtime/opencode-node-server-build.log`, `.runtime/opencode-node-headless.log`
(initial), and `.runtime/opencode-node-headless-clean.log` (fresh output).

**Native reduction completed:** both native Node and Bun reproduce the bundled
UMD failure. Ordinary `--packages=external` plus unchanged package delivery and
ordinary unbundled delivery both pass parse/edit checks on both runtimes.
The bundle omits the implementation files and original require base; this does
not demonstrate a Vivari loader discrepancy. See the [minimal reproduction](jsonc-repro/README.md).
The old baseline selected jsonc-parser's published ESM entry, not replacement
package source. No ESM swap was used here.

## September 11 approved published-ESM entry selection

The user chose to keep bundling and explicitly select jsonc-parser's published
ESM implementation. `bun run build` now executes `bun ./build.ts`, which calls
`Bun.build` with `target: 'node'` and the same entry/output paths. Its only plugin
is an exact `/^jsonc-parser$/` `onResolve`: resolve the installed package from
the importer, then select `../esm/main.js` relative to its ordinary UMD entry.
There is no `onLoad`, package source replacement, behavioral source rewrite,
external flag, or Vivari-specific resolution logic. This is authorized build-time
entry selection and meets the unchanged-application goal.

Configuration assessment: executed `bun build --help` on installed Bun 1.4.0;
it exposes no alias or `mainFields` flag. Local `bun-types` declarations expose
neither, and its bundler comparison documents `mainFields` as unsupported.
`--conditions` does not select this package's legacy `module` field (the package
has no conditional exports). The small resolver hook provides explicit per-package
selection without changing global resolution or introducing tsconfig path mapping
across upstream workspace configs. No claim that every possible Bun alias surface
was exhaustively tested is needed for this supported plugin approach.

Archived the prior output directory before building to exclude stale assets:

```sh
# From vivari:
bun -e 'import {renameSync} from "node:fs"; renameSync(".runtime/opencode-bun-server", ".runtime/opencode-bun-server-before-jsonc-esm-" + Date.now())'
# From this experiment directory:
bun run build > ../../.runtime/opencode-jsonc-esm-build.log 2>&1
```

Build succeeded. Output is `server.js` (28,339,308 bytes) and the unchanged
705,384-byte native ffi-rs asset. JS SHA-256:
`bac87e4939fefd7aed6f8523ecaa3bb9d2a43656b5278fdff2a9d05d51561c87`.
Artifact inspection finds jsonc-parser ESM main plus scanner, string-intern,
format, parser and edit modules; no UMD main or dangling `require2("./impl/format")`.

The existing isolated guest probe on `80d5cdd` passes that earlier failure, then
stops at the next concrete blocker:

```text
Error: Cannot find module 'web-tree-sitter/tree-sitter.wasm' from '/app'
OPENCODE_BUN_EXIT: code 143, signal SIGTERM
```

The emitted bundle retains
`process.env.OPENCODE_TREE_SITTER_WASM_PATH ?? require4.resolve("web-tree-sitter/tree-sitter.wasm")`
at line 436986. That package asset is not among the two emitted files mounted in
this attempt. This is an asset-delivery boundary, not yet proof of a runtime WASM
defect. There was no listener checkpoint; cleanup explains exit 143. Source pin,
lock hash and preexisting TUI modification are unchanged. Logs are the build log
above and `.runtime/opencode-jsonc-esm-headless.log`.

## September 11 original tree-sitter asset delivery

The code bundle passed the previous module-loading failures; the deployment was
missing runtime-resolved data assets. `build.ts` now additionally resolves the
three installed tree-sitter WASM files from the pinned CLI dependency tree and
copies their original bytes into the existing output directory with `Bun.write`.
The exact jsonc ESM hook and Node target remain. There are no package source
edits, runtime shims or additional transforms.

The pinned `packages/core/src/shell/parser-wasm.node.ts` initializes runtime,
Bash and PowerShell asset paths together, so the bounded delivery includes all
three tightly coupled files. Upstream `packages/cli/vite.node.config.ts:197-199`
uses these same environment variables; the old baseline also copies these assets
but retains package layout. Our isolated probe explicitly sets:

| Original installed asset | Output / guest path | Upstream environment variable |
| --- | --- | --- |
| `web-tree-sitter@0.25.10/tree-sitter.wasm` | `tree-sitter.wasm` / `/app/tree-sitter.wasm` | `OPENCODE_TREE_SITTER_WASM_PATH` |
| `tree-sitter-bash@0.25.0/tree-sitter-bash.wasm` | `tree-sitter-bash.wasm` / `/app/tree-sitter-bash.wasm` | `OPENCODE_TREE_SITTER_BASH_WASM_PATH` |
| `tree-sitter-powershell@0.25.10/tree-sitter-powershell.wasm` | `tree-sitter-powershell.wasm` / `/app/tree-sitter-powershell.wasm` | `OPENCODE_TREE_SITTER_POWERSHELL_WASM_PATH` |

Build and the existing isolated headless probe were executed using the current
commands at the top of this README. Build succeeded, and separate SHA-256
comparisons verified each copied file against its installed original. Sizes:
205,488 / 1,380,769 / 983,236 bytes respectively. The JS remains **byte-identical**
to the preceding build (`bac87e4939fefd7aed6f8523ecaa3bb9d2a43656b5278fdff2a9d05d51561c87`).

On the same runtime `80d5cdd`, the probe now reports:

```text
OPENCODE_BUN_COMMAND bun /app/server.js
OPENCODE_BUN_LISTEN 4096
Error: SQLITE_CANTOPEN: durable persistence unavailable
OPENCODE_BUN_EXIT: code 143, signal SIGTERM
```

This passes the asset-path resolution blocker and reaches a listener checkpoint,
then fails during `DatabaseSync` through Vivari's SQLite builtin. The probe log
also reports OPFS sqlite3_vfs unavailable in the main thread. The next blocker
is durable persistence in this headless setup; its precise configuration/backend
cause has not been reduced here. No authenticated health, lifecycle acceptance
or actual tree-sitter parsing operation was exercised. Listener alone is not
server acceptance. Logs: `.runtime/opencode-tree-sitter-build.log` and
`.runtime/opencode-tree-sitter-headless.log`.

## September 11 headless storage setup and readiness (current)

**Authenticated headless readiness now passes.** The persistence failure was
missing harness setup, not an observed runtime defect:

- Fork `scripts/fs-worker.mjs:19` explicitly calls `createSqliteServer(vfs, null)`.
- `packages/kernel-host/sqlite-server.js:57` correctly rejects a durable pathname
  when no persistence adapter is available. It flushes exported committed bytes
  before acknowledging database operations when an adapter is supplied.
- The accepted browser baseline uses `Workspace.open(...opfsStore(...))`; the
  browser FS worker creates/restores OPFS persistence before SQLite startup.
- Existing integration `scripts/sqlite-headless-fs.mjs` already provides a real
  disk-snapshot test adapter. It supports `/runtime-probe/*.sqlite`, restoring
  saved bytes on worker startup and writing snapshots through temporary-file
  replacement. Its headless suite checks process ownership and worker restart.

The minimal probe now uses that **unchanged existing adapter**, with a unique
`.runtime/opencode-headless-storage-*` directory per run and upstream
`OPENCODE_DB=/runtime-probe/opencode.sqlite`. The directory is printed and retained
for inspection, never reused implicitly. Other VFS state remains ephemeral.
This is disk-backed snapshot/restart coverage, **not OPFS or power-loss durability**:
the adapter does not fsync, implement full filesystem persistence, or qualify
concurrent host ownership. No in-memory fallback or fake successful flush was added.

The code bundle, exact jsonc ESM hook and tree-sitter asset bytes are unchanged.
No build was necessary in this slice. Source remains `d7a7256` with its preexisting
TUI modification; runtime remains `80d5cdd599fce4fa4817128461c865e009109d34`.

Executed from `vivari` with native Node 24.7.0:

```sh
/Users/kkrausse/.nvm/versions/node/v24.7.0/bin/node scripts/sqlite-headless.mjs > .runtime/opencode-storage-contract.log 2>&1
/Users/kkrausse/.nvm/versions/node/v24.7.0/bin/node scripts/opencode-bun-headless.mjs > .runtime/opencode-storage-headless.log 2>&1
```

The SQLite suite exited zero, including write/recover under guest Node and Bun,
ownership rejection/release, and recovery after replacing the worker/kernel.
The OpenCode probe completed all **41 schema migrations**, then produced:

```text
OPENCODE_BUN_LISTEN 4096
OPENCODE_BUN_HEALTH status=200 body={"healthy":true,"version":"local","pid":1}
OPENCODE_BUN_HEALTH_PASS
OPENCODE_BUN_EXIT code=143 signal=SIGTERM workerErrors=[]
```

Health uses the existing public `Kernel.handleHttpRequest` test API with Basic
auth made from probe-only credentials. Each request has a five-second timeout;
readiness retries are bounded to 30 seconds, under the existing 180-second overall
deadline. The probe checks both status 200 and `healthy === true`, then deliberately
calls `kernel.stop(pid)`. Thus 143 is a diagnostic stop, **not a new startup blocker
or successful graceful shutdown**. The overall command remains nonzero so it
cannot be mistaken for complete server acceptance.

After the first completed run, native Node's real SQLite reopened only the fresh
`.runtime/opencode-headless-storage-kmvFOk/opencode.sqlite` in read-only mode;
`PRAGMA integrity_check` returned `ok` and `sqlite_master` contained **18 tables**.
This verifies actual disk bytes survived guest/worker termination. The sqlite-wasm
OPFS warning still appears in Node but is irrelevant to the supplied disk adapter.

## Shutdown investigation — stopped at authentication boundary

Pinned source evidence:

- `packages/cli/src/server-process.ts:114-123,148-152`: only `mode: 'service'`
  supplies managed lifecycle registration and awaits `server.shutdown`; default
  mode awaits `Effect.never`.
- `packages/server/src/service-status.ts:35-37`: stop rejects unmanaged servers
  or a mismatched instance ID. Thus the current default launcher cannot use this
  API to terminate its effect.
- `packages/server/src/process.ts:195-219`: authenticated
  `POST /api/service/stop` with `{instanceID}` accepts managed shutdown and triggers
  it after response finish/close. This is the selected supported path.
- `packages/cli/src/server-process.ts:62-67`: service mode uses service-config
  password or a generated credential, rather than the default-mode environment
  password. Read guest-created registration credentials, as the accepted baseline
  does, instead of assuming the default probe password applies.

One temporary service-mode attempt was built and executed before scope was narrowed:

```sh
# Experiment directory:
bun run build > ../../.runtime/opencode-lifecycle-build.log 2>&1
# vivari:
/Users/kkrausse/.nvm/versions/node/v24.7.0/bin/node scripts/opencode-bun-headless.mjs --lifecycle > .runtime/opencode-lifecycle-headless.log 2>&1
```

Result: listener 4096, then health **401** with the assumed probe credential;
overall timeout **124**. No stop request, session creation, restart, or retention
checkpoint was reached. The attempt wrote a guessed guest config location, but
its effective path was not established. This demonstrates an authentication/setup
blocker, not a shutdown/runtime failure.

The incomplete lifecycle implementation was removed; committed source retains
the earlier default-mode readiness probe. `--lifecycle` is **not a supported
committed option**. The ignored build/log are historical evidence (attempt JS
SHA-256 `765dd1b67583b645a01e904cdc0de525487e1b5c15db2b281ecad83fa5a5f059`);
rebuild from committed source before another experiment. No second execution was
made after the narrowing instruction. Runtime/source pins are unchanged.

**Next smallest task:** one isolated service-mode shutdown-only attempt using the
actual guest registration password/instance ID and explicit guest XDG paths.
Require stop accepted and clean exit; stop on first error. Session creation,
restart/retention, runtime fixes and model/tool/browser work are deferred.
Ordinary builds are accepted; the direct TS stripper is **not necessarily the
critical path**. Later assets, native/TUI branches, HTTP and tools are unqualified.
