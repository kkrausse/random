# Browser Linux + explicit Vite accelerator

**Working vertical slice:** a real QEMU Linux shell edits the React fixture,
an explicit verified save-sync commits those bytes into Vivari's separate VFS,
and browser-worker Vite updates the adjacent preview without replacing its
Document. Linux owns terminal/native execution; Vite is an explicitly started
accelerator. `node` and `bun` in Linux remain the stock Linux binaries.

Live proof: **http://127.0.0.1:5213/**, Browser Control **`lucky-panda-267`**.
Preserve that page to retain its Linux overlay. See the
[measured results and failure investigation](../doc/vivari-qemu-hybrid-results.md).

## Run from this directory

```sh
bun run setup
bun run dev
```

`setup` verifies `artifacts.lock.json` and builds the small isolated syscall
wait-loop overlay. This experiment reuses these **existing generated inputs**:

- `../qemu/public/qemu/`: custom Alpine toolchain image and POPCNT-fixed QEMU.
- `../qemu/node_modules/`: terminal dependencies from its frozen `bun.lock`.
- `../vivari/.runtime/baseline/`: pristine source at
  `2629c71097238400c45aefa213ef61df4794c2b7`, existing Rust/Wasm products and
  installed Vite build dependencies. **No shared patched runtime is rebuilt.**
- `../vivari/public/vendor/npm-pack.bin`: pinned real npm 10.9.2 payload.

If absent, follow [QEMU setup/build](../doc/README.md) and
[Vivari baseline source build](../vivari/README.md#pinned-source-build-and-sqlite-handoff).
QEMU's recipe needs Docker/native QEMU and pinned downloads; Vivari's original
build needs Bun, Rust 1.93.0 + Wasm targets, and wasm-pack 0.13.1. This local
overlay only rebuilds JS worker bundles (~0.2s with existing inputs), not Rust
or QEMU. Changed/missing pins fail; this project does not silently download a
different guest or modify another experiment. Baseline sources are checked
for the exact revision and tracked cleanliness; input/output hashes are in
`runtime-build.json`.

The 389.62 MiB QEMU files are referenced in place, never copied to a new vendor
tree. Small runtime/helper/fixture snapshots are ignored under `.artifacts/`.
The QEMU terminal is compiled from its captured source, using sibling installed
terminal packages. The static server verifies input hashes, builds only the
harness, and serves fixed routes with COOP/COEP. It has no execution API,
application Vite server, model relay, HTTP transform proxy, or host filesystem
write endpoint. Host `/preview/5173/` returns 404; the browser Service Worker
routes it to worker Vite. `POST /` returns 405.

### Manual sequence

1. **Start Linux**. At `demo login:`, type `root` (no password). Wait for
   `demo:/workspace#`; login prints versions, including a slow OpenCode version
   check. This is not an OpenCode TUI test.
2. **Boot accelerator**. On a fresh origin, **Load prebaked worker dependencies**
   if `.artifacts/deps/hybrid-deps.bin` is available. Otherwise use **Install
   worker dependencies**, which runs real `npm ci` in a browser worker against
   `worker-package-lock.json`.
3. **Connect Linux PTY bridge**, only at the Linux shell prompt. This transfers
   the pinned existing guest helper, sets the effective
   `BUN_JSC_useFTLJIT=false`, and opens a real `/dev/pts/0` Linux shell. Native
   tools execute inside QEMU. A hybrid adapter corrects the reused bridge's
   initial `[columns, rows]` geometry reversal; later resize forwarding is the
   existing QEMU implementation.
4. **accel start vite**. It synchronizes the bounded source file first, then
   spawns `node node_modules/vite/bin/vite.js --host 0.0.0.0 --port 5173
   --strictPort` in a Vivari process worker. Wait for the heading.
5. In the **Linux terminal**, or the **Linux shell command** field, run:

   ```sh
   sed -i 's/Ready for an agent edit/Hello from Linux/' src/WelcomeCard.tsx
   ```

6. Click **Sync Linux save**. The visible heading changes via Vite HMR. Restore:

   ```sh
   sed -i 's/Hello from Linux/Ready for an agent edit/' src/WelcomeCard.tsx
   ```

   Click **Sync Linux save** again. Ordinary saves without this explicit sync
   do not update the worker copy.
7. **accel stop** terminates the Vite worker service; Linux and its shell remain
   alive. Start again to recreate the preview. These are UI service controls;
   a Linux `accel` command has not been installed.

Keep one kernel/page per origin. Reloading the outer page destroys Linux's
in-memory disk overlay and both process sets. Vivari source persistence is
origin-local OPFS, but it is only a replica: a later sync replaces the selected
worker source with Linux's version. Use `PORT=5214 bun run dev` for an unused
origin; do not reuse another agent's active Vivari origin.

## Filesystem boundary: explicit single-file snapshots

There is **no shared mounted filesystem** in this slice. QEMU uses a private
virtio block disk, `-nic none`, and its serial console; no 9p/virtiofs device is
configured. The source authority is Linux `/workspace`.

The only synchronized path is `/workspace/src/WelcomeCard.tsx`, maximum 32 KiB.
Other fixture source/config files are initialized from the pinned identical
fixture; edits to them are not synchronized. Dependencies and caches are always
separate. Protocol in `src/sync.ts`:

1. One Linux shell command emits SHA-256, base64 bytes, and a second SHA-256.
   Reject a changing file, invalid frame, oversized file, or nonzero command.
2. Recompute SHA-256 in the browser. Write a temporary file **outside `src/`**
   in the worker VFS; verify its bytes before committing.
3. Rename the staged file over the target with the real VFS rename operation,
   then read back and hash the target. This avoids exposing partial source to
   Vite. Temporary files are removed on failure.
4. Return a sequence/hash/byte-count/timing receipt. UI operations serialize.
   The real Vite watcher notices the rename; the real HMR client updates React.

This is snapshot consistency for one successful synchronization, not continuous
coherence, a multi-file transaction, a durable OPFS commit, or a guarantee against
future concurrent Linux writes. A source can change after capture; sync again.
No watcher automatically copies files and no worker writes flow back to Linux.

## Prebaked dependencies: worker-specific, not Linux portability

The Linux image already has its own installed fixture dependencies, Bun 1.4.2,
and OpenCode beta-19157. Those native packages never enter Vivari.

The optional worker archive was generated **inside Vivari after real Vite
dependency optimization**. It contains 6,195 dependency files / 104,990,455
logical dependency bytes, plus the root npm lock (6,196 archive entries),
compressed to 26,324,873 bytes. It includes the worker's `.vite` cache prepared
for `/workspace`, Vite 7.1.4, and `esbuild-wasm` 0.25.12. `.bin` symlinks are
omitted because this accelerator launches Vite's JS entry directly. Other
symlinks reject during capture. Package notices/licenses remain in the archive.

Recreate after installing and rendering the fixture in the browser:

```sh
# From repository root. Allow a 180-second outer command timeout.
browser-control execute --session SESSION --file browser-container-poc/hybrid/scripts/capture-deps.js
```

Run this only once at a time. The runner executes `pack-deps.cjs` in the worker,
then exports 256 KiB chunks to the ignored archive and records its digest,
runtime fingerprints, workspace path, and npm lock in the owned JSON files.
Set `state.hybridRoot` to an absolute project path if the CLI's working directory
is elsewhere. Archive loading verifies its SHA-256, fixture package hash, and
runtime JS fingerprints, then uses the **pinned internal `vv-create-project`
batch protocol** to mount binary files without the 1 MiB syscall limit.
No host command performs fixture transforms. Loading is not a portable native
dependency installer; recapture for a different runtime/project/path.

## Checks

```sh
bun test scripts/*.test.ts
bun run build
bunx --package node-bin-darwin-arm64@24.18.0 node scripts/verify-runtime.mjs
# Against a ready preview, from repository root:
browser-control execute --session SESSION --file browser-container-poc/hybrid/scripts/accept-browser.js
```

Read `window.hybridAcceptance` until `phase: "complete"` and `restored: true`.
The asynchronous runner measures five warm native Linux edits and restorations,
checks exact guest/worker bytes, and retains the same iframe Document/time origin.
It does not reload the VM. `window.hybrid` exposes the same browser-only operations
and bounded text diagnostics for qualification. Local raw evidence is ignored in
`evidence/`; the checked-in results contain the key measurements.

## Isolated runtime fix and licensing

The initial patched and pristine baseline Vivari builds both failed under the
hybrid scheduling load, although the baseline no-QEMU control rendered normally.
A late notification from syscall N can wake syscall N+1 before N+1's response.
`scripts/syscall-wait.ts` adds a state-checking wait loop at exactly two source
sites: process `fs-client.js` and kernel `kernel-fs.js`. `build-runtime.ts` applies
this via a source-loader overlay while bundling workers from the pinned baseline.
No generated JS is patched by hand; no sibling source or FFI patch is changed.
The negative-control test reproduces a stale wake returning request bytes and
requires the patched wait to retry; the upstream suite runs the same overlay in
both parent and inherited worker loaders. This is not a general scheduler audit.

Vivari is MIT; its notice is emitted as `assets/LICENSE.vivari.txt`. QEMU-Wasm
and Linux retain their upstream licensing; see [QEMU pins/recipe](../doc/README.md)
and [upstream QEMU source](https://github.com/ktock/qemu-wasm/tree/0ef7b4e2814b231705d8371dd7997f5b72e70baf).
