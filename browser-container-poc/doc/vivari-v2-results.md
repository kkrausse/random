# Vivari matched V2 continuation

This continues `3988806`. The older provider-dialog demo remains on :5205;
the matched V2 experiment uses **http://127.0.0.1:5206/**.

## Source and protocol

The old source pin (`5cf9f517`) deliberately connects a legacy TUI SDK to the new
server and supplies empty legacy-path fallbacks. Prefix rewriting cannot repair
its session/event protocol. The new isolated source pin is
`d7a7256bb6b0952f486c95718cfbf460b1570a56`: it uses the V2 generated client,
location data and session events, while still pinning qualified OpenTUI 0.4.5 and
Solid 1.9.10. The current V2 branch uses OpenTUI 0.5.10/Zig 0.16, which needs a
separate native port; it is not silently substituted here.

The only application source patch guards optional devtools process metrics.
Unavailable CPU/memory/loop metrics show an explicit unavailable state. No fake
provider responses or measurements were introduced. The TUI package typecheck
passes. Parser WASM and sound assets are delivered from pinned dependencies;
simulation/native canvas packages stay external and fail if explicitly requested.

The public catalog was downloaded from `https://models.opencode.ai/api.json` and
delivered using `OPENCODE_MODELS_PATH` with network refresh disabled. SHA-256:
`93c9a67396a5a459c4cd6c4ea3514ef86652019ed2bc1a3589dbc624c4a42ea9`.
Packaging rejects changed catalog bytes pending an explicit pin review.
The real `/api/model?directory=/workspace` returned 31 free models, including
`nemotron-3.5-lightning-free`. Initial location initialization may return an empty
list before the real `catalog.updated` event completes.

## Launchers and reproduction

Both origins expose `opencode2` in the guest shell. :5205 retains the original
`bun /opencode-tui/cli/entry.cjs` path. :5206 uses its isolated V2 profile and
`node /opencode-v2/run.cjs`, which launches guest Bun. Installers refuse an unknown
existing executable; the known previous launcher is upgradeable. Input is piped
explicitly so existing live workers can use the launcher too.

From `browser-container-poc/vivari`, after the native/runtime setup in
`vivari-wire-results.md`:

```sh
git clone https://github.com/anomalyco/opencode.git .runtime/opencode-v2-source
git -C .runtime/opencode-v2-source checkout --detach d7a7256bb6b0952f486c95718cfbf460b1570a56
bun install --cwd .runtime/opencode-v2-source --frozen-lockfile
bun scripts/package-opencode-tui.ts --v2
bun run dev --port 5206 --strictPort
```

Boot and open a shell in :5206. Using Browser Control CLI with its explicit session:

1. Set `state.ffiOrigin = 'http://127.0.0.1:5206/'` and run `scripts/ffi-browser.js`.
2. Run `scripts/opencode-v2-browser.js`. Asset SHA-256 is checked in a guest worker;
   repeated delivery skips matching assets. It starts only its own guest service
   on 4106 and installs the launcher.
3. The optional `probes/runtime/configure-opencode-v2.cjs` installs a dedicated
   public-model proxy profile. Run it in a guest worker, then restart only the
   owned V2 service to load it. It refuses an existing config.
4. Start the host transport with `VIVARI_MODEL_API_KEY= bun scripts/web-server.ts`.
   This explicitly uses public access; it never discovers host credentials.
5. In the guest shell, run `opencode2`. Use `/models` to select a model.

V2 XDG paths are below `/home/user/vivari-v2`; the old service/database and OPFS
remain intact. Full CLI automatic service startup is still unqualified; the
delivery script starts the real service separately. The full CLI's `--help` and
API commands expose an existing process.exit sentinel/Effect interaction that can
report exit 1 after producing valid output; help text alone is not an exit gate.

## Runtime changes and checks

- Node stream consumers: split UTF-8, incomplete sequence, binary collection,
  WHATWG streams, JSON and propagated failures.
- VM evaluated dynamic imports: existing guest resolver, namespace identity,
  Script/function/sandbox paths, ordinary completion and rejection.
- Real deferred process warning events and stderr diagnostics, including actual
  EventEmitter listener-limit metadata.
- Inherited child input forwarding with cleanup; foreground shell preserves CR
  instead of rewriting Return to newline. Independent test passes through the
  actual interactive shell and checks UTF-8/CR and listener cleanup.
- Full upstream `verify-node.mjs` and source rebuild passed after these changes.

Rebuilding used to delete hashed assets still referenced by live kernels. Original
assets were recovered from the previous harness build, restoring old spawn URLs.
`build-runtime.ts` now retains prior assets across builds. No live OPFS reset was
performed; only the owned :5206 jobs were stopped for its runtime reloads.

Build-linked evidence is in ignored `doc/logs/vivari/v2-*` logs and receipts.
See the final acceptance section below for end-to-end status.

## End-to-end acceptance — passed

On :5206 (`clever-falcon-351`), the full CLI `opencode2` rendered a real model
response, `VIVARI_TUI_MODEL_OK`, from **Muse Spark 1.3 Free / OpenCode Zen**.
The subsequent actual TUI submission read and edited
`/workspace/src/WelcomeCard.tsx`, replacing only the heading text with
`VIVARI TUI HMR VERIFIED`, and rendered `EDIT_COMPLETE` (8.1 seconds reported by
the TUI). The selected model was Muse Spark, not Nemotron; listing Nemotron does
not count as executing it.

The exact byte diff matched that one replacement. Vite emitted
`hot updated: /src/WelcomeCard.tsx`, the real preview displayed the new heading,
and the saved iframe `Document` reference remained identical. The original file
was restored byte-for-byte; the preview hot-updated back in the same Document.
The guest fixture suite then passed both tests. No credentials were read/copied.
`opencode2 --continue` reopened the completed edit session after CLI shutdown;
the live demo is left on that recovered session with the fixture restored.
Native layout responded to 186×19 → 116×26 (footer moved to row 26 and the diff
became single-column), then Ctrl+C returned to a working shell while the separate
service and Vite remained alive. Old xterm row tails persisted outside the resized
width; repaint cleanliness remains unqualified.

Evidence, visually inspected:

- `doc/logs/vivari/v2-hmr.json`: original/changed source, exact diff, Document
  identity, native TUI transcript with model and `EDIT_COMPLETE`.
- `doc/logs/vivari/v2-hmr.png`: actual TUI and updated preview together.
- `doc/logs/vivari/v2-hmr-restored.json`: restoration and same-Document proof.
- `doc/logs/vivari/v2-runtime-browser.json`: stream, VM/thread, warning probes.
- `v2-headless.log`, `v2-runtime-verify.log`, `v2-runtime-build.log`,
  `v2-compatible-package.log`, `v2-tui-typecheck.log`: final checks.

### Repeat the visible edit

Use :5206, install dependencies after boot if the Vite executable is absent,
then Start Vite. Wait for the actual fixture preview. In a fresh guest CLI:

```sh
opencode2 --prompt "Read /workspace/src/WelcomeCard.tsx and use edit to replace Ready for an agent edit with VIVARI TUI HMR VERIFIED. Change nothing else. No shell commands. Reply EDIT_COMPLETE."
```

Wait for the prompt to render, then press **Enter**. `--prompt` pre-fills the real
TUI input; it does not run an SDK substitute. Ctrl+C returns to the shell; wait
for the fresh `workspace$` prompt before entering another command.

### Remaining limitations

Long character-by-character prompt entry exhausted the existing 64 MiB FFI pin
budget (`editBufferGetText` → `ptr`) because transient owners are retained until
close. The successful gate used a **fresh CLI process and `--prompt`**. Ordinary
long-lived interactive use is not qualified, and the budget was not raised to
conceal the issue. Input/rendering can lag; wait for native visible state.

The first submission also exposed a browser Worker constructor escaping guest
file resolution. The runtime now hides that host constructor and implements
`process.getBuiltinModule` via the existing eager/lazy builtin registry. OpenTUI
selects its real node:worker_threads implementation; its pinned parser worker is
packaged and explicitly located. Independent guest-thread and browser tests pass.

The repository-referenced `opencode-dev` skill was unavailable in this harness;
the loaded OpenCode/browser-control guidance and pinned source were used.
