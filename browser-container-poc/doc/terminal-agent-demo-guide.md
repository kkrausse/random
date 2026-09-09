# OpenCode in Vivari — shell-first demo

## Shell-first update

Catalog proxy follow-up: `/api/catalog/api.json` now forwards to the fixed public
`https://models.opencode.ai/api.json` endpoint. Both the guest server and shell
receive `OPENCODE_MODELS_URL=http://host.vivari.internal:5216/api/catalog` (using
the actual page port). This does not proxy inference requests. Browser verification
returned HTTP 200 with 213 providers and 102 Zen model entries; the guest server
wrote its URL-specific catalog cache containing Zen, and the startup fetch error
did not recur. The TUI still displayed only **Other Custom provider**, consistent
with the separately recorded legacy/API route mismatch. Catalog connectivity alone
does not resolve the picker or qualify inference.

The page now boots automatically to the guest `/workspace` shell. Use **Launch
OpenCode**, or type `bun /opencode-tui/cli/entry.cjs`, to open the TUI. Ctrl+C
returns to the shell. **Stop shell** terminates that shell and its children;
**Start shell** opens a replacement. The guest OpenCode server is still prepared
in the background during boot. Model catalog/backend qualification is unchanged.

For UI-only updates, use `bun build.ts --ui-only` to keep the existing pinned
runtime and guest assets. The acceptance runner now verifies shell-first boot,
`pwd`, TUI launch/input, Ctrl+C, relaunch, and stop/recovery, leaving a shell ready.

The original qualification record below describes the earlier auto-TUI UI;
its button labels and final provider-dialog state are historical.

## Open it now

**URL: http://127.0.0.1:5216/**

The agent has started the host server and left a visible Chrome tab showing the
actual **Connect a provider** dialog. Browser Control session: `rapid-raven-074`.
Use that existing tab if it is open. Keep one tab at this origin: the browser
filesystem belongs to the origin, and concurrent kernels can contend for it.

For a new page load:

1. Open the URL in Chrome on this Mac.
2. Click **Start OpenCode** once.
3. Wait for **TUI provider dialog rendered** above the black terminal. Boot,
   nine asset installations with guest SHA-256 verification, and server startup
   took about four seconds here; allow up to a minute on a slower machine.
4. Click inside the black terminal. Type `nemotron` to verify input. The search
   currently says **No results found**. This is the known provider/backend gate,
   not failure to launch the terminal.
5. Press **Control+C** (Control, not Command on Mac). The real guest shell returns.
   Click **Start OpenCode** to launch again.

No command, API key, package installation, or host OpenCode service is needed for
this already-prepared provider-dialog demo. This has **not** qualified a model
response, model-driven file edit, or Vite HMR from this TUI.

## If the URL is unavailable: host commands

These commands go in **macOS Terminal**, not the webpage terminal:

```sh
cd /Users/kkrausse/Documents/repos/kkrausse/random/browser-container-poc/terminal-agent-demo
bun serve.ts
```

Keep that Terminal running. Open the exact URL printed by it. The default is
`http://127.0.0.1:5216/`. Host port 5216 serves only UI/static assets; guest port
4096 runs OpenCode inside browser workers. Opening `http://127.0.0.1:4096` in the
host browser is not the demo URL.

If the command says port 5216 is occupied, first try the existing URL. Do not
terminate unrelated listeners. `PORT=5217 bun serve.ts` selects another port,
which is a distinct browser filesystem and needs its own Start operation.

## Build from the existing Vivari artifacts

The checked-in harness is small Bun/TypeScript tooling. It references existing
Vivari dependencies read-only and does not modify their package or lockfiles.

```sh
cd /Users/kkrausse/Documents/repos/kkrausse/random/browser-container-poc/terminal-agent-demo
bun build.ts
bun serve.ts
```

`build.ts` snapshots the patched runtime, fixture, native OpenTUI reactor/manifest
and CLI-mode OpenCode package into ignored `.snapshot/`, then bundles the UI.
The server reads that snapshot, so later shared-runtime rebuilds do not silently
replace this demo's workers. The full hash inventory is `.snapshot/hashes.json`
and is included in downloadable diagnostics. CLI bytes are checked against the
upstream packaging receipt before copying; runtime copies are compared against
their source. If the source is changing, wait for packaging/build to finish and
retry. Do not rebuild the snapshot during an active demo.

Required existing paths under `../vivari/`:

- `node_modules/` from its frozen Bun install (including xterm and fit addon).
- `.runtime/patched/packages/core/dist/` from its patched runtime build.
- `.runtime/opencode-tui-package/receipt.json` and its CLI assets.
- `.runtime/opentui-source/packages/core/src/zig/zig-out/bin/opentui.wasm`.
- `.runtime/opentui.ffi.json` and `fixture/`.

If these are missing, prepare the shared project using [Vivari README](../vivari/README.md)
and [wire build instructions](vivari-wire-results.md#reproduce-and-evidence).
Those are host builds: Bun 1.4.0, Rust 1.93.0 with wasm32 targets,
wasm-pack 0.13.1, and Zig 0.15.2 for native OpenTUI. The OpenCode packaging source
is a frozen install at revision `5cf9f517cfec3ef68d3e68a12a6a4b3163947f44`.
Full toolchain/source builds can take substantially longer than the four-second
browser launch; the measurement assumes those artifacts already exist.

The qualified snapshot records:

| Artifact | SHA-256 |
|---|---|
| OpenCode CLI | `6e81300afce54b0a500efeabf6a7af3d82a25e5e882a9f4664ab8d60518e2c43` |
| OpenTUI WASM | `a1e064b36d97c103ddff053a4e99d05817d83b5e5d05dfbef047106a496b10a5` |
| FFI manifest | `31d7b0dfd07406ccb5b08e0b5d0d6f5e4751fed28fd21ffdd8cabb859bf10a59` |
| Runtime SDK index | `5a2c8e7c3d245401bd56a03274e970007c1de45336a6ca8c2098e239340e999b` |
| Kernel worker | `b57c4697f15b6801072c5bfd8d57be3eff38a820b625a45b012c4259e4447331` |

## What Start does, and the exact guest commands

Start uses the real `Vivari.boot`, filesystem and `spawn` APIs. It mounts the
existing fixture only when `/workspace/package.json` is absent, transfers the
prepackaged CLI/native assets in 256 KiB chunks, verifies them inside the guest,
then starts this **guest** background process:

```sh
node /opencode-tui/cli/entry.cjs serve --port 4096 --register
```

After the actual `server listening` log, it opens a real interactive guest `sh`
and types this **guest** foreground command automatically:

```sh
bun /opencode-tui/cli/entry.cjs
```

You can also type that command manually at the webpage's `workspace$` prompt
after Control+C. Do not enter it into macOS Terminal: `/opencode-tui` is a browser
filesystem path. Do not start a second server on guest port 4096 in this demo.

## Observed startup/usability failures and recovery

| Symptom | Observed cause / action |
|---|---|
| `sh: opencode2: not found` | Reproduced on the isolated guest shell. The packaged source CLI exists at an absolute path; this snapshot does not install an `opencode2` PATH launcher. Use Start or the full guest command above. A launcher added to another origin does not install it here. |
| Guided launch from an older URL fails | A URL alone does not establish prerequisites. Guest processes disappear on reload; normal package installation does not provision this source CLI/native FFI artifact. This launcher installs/verifies them and starts the required guest server every new page load. |
| TUI auto-start cannot find/start service | The pinned source's non-Bun `process.execPath` auto-start path treats the runtime as a compiled executable. The explicit separately running guest server is required; Start waits for it. |
| Empty provider results | Actual dialog is visible and accepts input, but server logs `Failed to fetch models.dev`. The pinned TUI/server legacy-vs-`/api/...` mismatch is documented in the wire results. Model/backend work is separate and remains unresolved in this snapshot. |
| Blank terminal after Control+C with direct SDK spawn | Reproduced while developing this wrapper: direct `spawn('bun', ...)` cleared the rendered TUI but did not settle its exit promise within 30 seconds. The final launcher uses real guest `sh` for foreground signal ownership; Control+C and relaunch pass. |
| TUI is stuck | Click **Stop TUI**, wait for the exit status, then **Start OpenCode**. This stops the dedicated shell and its child; the separately owned guest server stays alive. |
| Boot/server/install failure | Expand **Diagnostics** or click **Download diagnostics**. The current phase, failure, server output and all asset hashes are outside guest terminal output. Server readiness has a 60-second deadline; guest assembly commands have a 30-second timeout. Retry Start after a failure; reload this same tab if the kernel is unhealthy. |
| Isolation error or assets missing | Use `bun serve.ts` and the HTTP URL, not `file://index.html` or a generic static server. Worker responses need COOP/COEP. Build the snapshot if files are missing. |

Reload preserves origin-scoped files and starts fresh processes; Start re-delivers
the pinned binaries but preserves an existing workspace. It does not clear OPFS.
Origins 5202, 5203, 5204, 5205 and other running services were left intact.

## Verification and evidence

Verified live in visible Chrome, on a previously unused origin and again after
reload: provider dialog, typed search, real Control+C return to shell, second
launch, and Stop/recovery. The final screenshot was opened and visually inspected.

- `../terminal-agent-demo/evidence/final.png`: current provider dialog.
- `../terminal-agent-demo/evidence/provider-search.png`: typed `nemotron`, no results.
- `../terminal-agent-demo/evidence/final.json`: phases/server logs/hash inventory and gates.
- `.snapshot/hashes.json`: complete generated snapshot inventory.

These generated files are local and gitignored. To repeat through the Bun-backed
Browser Control CLI, from the repository root, using this demo's session:

```sh
browser-control execute --session rapid-raven-074 --file browser-container-poc/terminal-agent-demo/accept.js
```

The runner deliberately reloads only :5216. It never clears browser storage.
It leaves the provider dialog visible. It is a UI/launch gate, not a model gate.

## Integration handoff

No changes to shared `vivari/src/main.ts`, guest backend, runtime patches or
package/lockfiles are required. The concurrent backend owner can package a repaired
CLI normally; once packaging completes, rebuild this snapshot and repeat the
acceptance runner. Its updated hashes will identify the new qualification.
The demo has no model proxy route or provider configuration; a complete model
workflow needs explicit transport/provider integration and a separate acceptance
gate before its scope can be upgraded. Current UI stays deliberately minimal.
