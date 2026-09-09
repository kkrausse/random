# kev-browser-agent-kit · Terminal agent demo

Earlier shell-first OpenCode integration, powered by the Vivari browser runtime.
For current public package consumption, start with [the editable app demo](../editable-app-demo/README.md).

Open **http://127.0.0.1:5216/**. Boot automatically delivers and hash-verifies
the matched OpenCode V2 package, installs `opencode2`, installs the fixture
dependencies, starts the guest OpenCode service and Vite, then opens `/workspace`.
The preview is below the shell. Setup runs again after a reload; existing
workspace files and the dedicated V2 configuration are preserved.

```sh
opencode2
opencode2 --continue
opencode2 --prompt "Your task here"
```

For `--prompt`, wait for the TUI input to settle, then press Enter. Ctrl+C
returns to the shell. Long character-by-character TUI input still has the
runtime's known FFI pin-count/latency limitation; the fresh-process `--prompt`
workaround is recommended for longer tasks. The audited text/layout scratch
adapters sharply reduce retained allocations, but sustained responsiveness is
not qualified. See [performance results](PERFORMANCE-RESULTS.md) for measured
runs, variability, and remaining work.

## Diagnostics

Expand **Diagnostics** for timestamped boot phases, asset verification, kernel
messages, dependency installation output, service/Vite output and process exits.
**Download diagnostics** exports those logs plus bounded terminal output and the
visible screen, process state, browser/isolation details, preview state and
snapshot SHA-256 hashes. Buffers retain their most recent one million characters.

## Host setup

With the runtime and matched V2 package prepared in `../vivari/.runtime`:

```sh
bun build.ts
bun serve.ts
```

`build.ts` snapshots the runtime, public npm vendor bundle, all pinned V2 CLI
and parser assets, native renderer, and fixture. `bun build.ts --ui-only`
rebuilds the interface against the existing snapshot. The host server serves
assets and proxies public model access; guest shell, service and Vite execute
in browser workers.

## Acceptance

Run `accept.js` through the Browser Control CLI on a dedicated :5216 or :5217 session.
It checks two consecutive boots/reloads, the real OpenCode launcher and selected
Muse Spark model, Ctrl+C, shell stop/restart, live preview and diagnostics.
The receipt is written to ignored `evidence/shell-v2.json`.

The updated launcher also returned a real `SHELL_DEMO_MODEL_OK` response from
Muse Spark 1.3 Free. This supersedes the old provider-dialog-only :5216 snapshot.
