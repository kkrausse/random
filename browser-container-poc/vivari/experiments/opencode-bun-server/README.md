# Conventional Bun server build probe

Invocation-only entry using the existing installed OpenCode V2 source image at
`../../.runtime/opencode-v2-source`. Required revision:
`d7a7256bb6b0952f486c95718cfbf460b1570a56`; upstream `bun.lock` SHA-256:
`b6ebc10fd743b192bf81437c0e95a89b850daffa6cfe9de0ba6491c13f1c3764`.

From this directory, reuse that image with ordinary dependency symlinks (run
once in a fresh local `node_modules`; this does not install workspace packages):

```sh
bun -e 'import {mkdirSync,symlinkSync,realpathSync} from "node:fs"; mkdirSync("node_modules/@opencode-ai",{recursive:true}); symlinkSync(realpathSync("../../.runtime/opencode-v2-source/packages/cli"),"node_modules/@opencode-ai/cli"); symlinkSync(realpathSync("../../.runtime/opencode-v2-source/packages/cli/node_modules/effect"),"node_modules/effect");'
bun run build > ../../.runtime/opencode-bun-server-build.log 2>&1
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
/Users/kkrausse/.nvm/versions/node/v24.7.0/bin/node scripts/opencode-bun-headless.mjs > .runtime/opencode-bun-headless.log 2>&1
```

The probe mounts every emitted file unchanged at `/app`, uses fresh in-memory
storage and `/home/direct`, probe-only auth and the direct probe's explicit
feature-disable flags. It has a 180-second deadline, input/mount/command/listen/
exit checkpoints, and terminates owned workers. Exit zero alone fails acceptance.
`VIVARI_SOURCE` uses the shared runtime resolver. Build artifacts and logs remain
under ignored `.runtime`.

## September 11 result

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

**Next bounded task:** supply the pinned ordinary `ws` package and its required
files through generic dependency delivery (or establish the Bun-target builtin
contract), then retry this exact artifact and stop at the next concrete blocker.
Ordinary builds are accepted; the direct TS stripper is **not necessarily the
critical path**. Later assets, native/TUI branches, HTTP and tools are unqualified.
