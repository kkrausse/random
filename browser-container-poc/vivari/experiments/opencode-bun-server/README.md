# Conventional Bun server build probe

Invocation-only entry using the existing installed OpenCode V2 source image at
`../../.runtime/opencode-v2-source`. Required revision:
`d7a7256bb6b0952f486c95718cfbf460b1570a56`; upstream `bun.lock` SHA-256:
`b6ebc10fd743b192bf81437c0e95a89b850daffa6cfe9de0ba6491c13f1c3764`.

From this directory, reuse that image with ordinary dependency symlinks (run
once in a fresh local `node_modules`; this does not install workspace packages):

```sh
bun -e 'import {mkdirSync,symlinkSync,realpathSync} from "node:fs"; mkdirSync("node_modules/@opencode-ai",{recursive:true}); symlinkSync(realpathSync("../../.runtime/opencode-v2-source/packages/cli"),"node_modules/@opencode-ai/cli"); symlinkSync(realpathSync("../../.runtime/opencode-v2-source/packages/cli/node_modules/effect"),"node_modules/effect");'
bun run build > ../../.runtime/opencode-node-server-build.log 2>&1
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
/Users/kkrausse/.nvm/versions/node/v24.7.0/bin/node scripts/opencode-bun-headless.mjs > .runtime/opencode-node-headless-clean.log 2>&1
```

The probe mounts every emitted file unchanged at `/app`, uses fresh in-memory
storage and `/home/direct`, probe-only auth and the direct probe's explicit
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

The package build command now uses ordinary Node-target resolution:

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

**Next bounded task:** reduce the emitted jsonc-parser UMD relative-require failure
and compare native behavior before selecting a normal build/delivery remedy.
Ordinary builds are accepted; the direct TS stripper is **not necessarily the
critical path**. Later assets, native/TUI branches, HTTP and tools are unqualified.
