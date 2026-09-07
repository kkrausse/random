# QEMU Linux + Vivari Vite hybrid — first vertical slice

2026-09-06 local / 2026-09-07 UTC. **PASS: a native Linux terminal edit reaches
browser-worker Vite through explicit verified synchronization and updates React
in the same iframe Document.** The implementation is isolated in
[`../hybrid/`](../hybrid/README.md).

Live: **http://127.0.0.1:5213/**, Browser Control **`lucky-panda-267`**.
Linux is idle at its working PTY; the Vite accelerator is running; the original
fixture is restored. Browser Control CLI `0.7.0`, Bun-backed only. Viewport
1634×946 CSS pixels; screenshots were opened and visually inspected.

## What actually runs where

```text
browser tab
  QEMU iframe / Wasm worker
    x86-64 Alpine Linux, private disk overlay, native /dev/pts/0 shell
    /workspace/src/WelcomeCard.tsx  ← authoritative source
            │ serial exec: hash / base64 / hash
            ▼
  explicit “Sync Linux save” coordinator
    validate capture → stage → verify → atomic VFS rename → verify target
            │
            ▼
  independent Vivari VFS / Node-compatible process worker
    real Vite 7.1.4 + esbuild-wasm 0.25.12 + React Refresh
            │ real HTTP / Vite HMR envelopes, browser Service Worker
            ▼
  adjacent preview iframe — Document retained across edits
```

The host Bun server delivers static harness/runtime/image/dependency bytes. It
does not run guest commands or fixture transforms. Verified host-only requests:
`GET /` → 200 with COOP/COEP; `GET /preview/5173/` and
`GET /src/WelcomeCard.tsx` → 404; `POST /` → 405. Successful preview modules are
served through the browser worker's Service Worker path. Linux's stock `node`
and `bun` have not been replaced or redirected.

## Acceptance evidence

The repeatable runner uses native Linux `sh`, `base64`, and `mv` to save a new
React heading, then calls the same explicit synchronization operation as the
UI. It checks both exact base64 byte strings, SHA-256, iframe Document identity,
time origin, and restoration after every sample. There is 250 ms pacing outside
the timed regions. Visibility is observed DOM geometry on the browser animation
clock, not compositor-paint timing or a model-driven edit.

### Final fresh-origin / prebaked-dependency run

| Warm edit | Linux save | Capture + verified sync | Sync ack → visible | Total edit → visible |
|---|---:|---:|---:|---:|
| 1 | 255.150 ms | 430.055 ms | 41.395 ms | **726.600 ms** |
| 2 | 215.345 ms | 314.055 ms | 38.275 ms | **567.675 ms** |
| 3 | 188.535 ms | 345.370 ms | 30.320 ms | **564.225 ms** |
| 4 | 174.865 ms | 316.440 ms | 28.360 ms | **519.665 ms** |
| 5 | 175.755 ms | 293.335 ms | 33.570 ms | **502.660 ms** |

Median **564.225 ms**. The earlier fixed-runtime warm batch, before dependency
packaging, passed at **615.060 / 483.710 / 516.165 / 492.080 / 549.355 ms**.
These are small sequential batches, not a statistically controlled speedup
claim against the older QEMU-only measurements. The old QEMU experiment recorded
roughly 1.9s best warm edits and substantial variance; most remaining hybrid
latency is now the Linux serial capture/save boundary, rather than Vite transform.

Final batch:

- Every edit's guest and worker source matched exactly; the edited files were
  335 bytes. Every restoration recovered the original 334 bytes.
- Original SHA-256:
  `5ff542b3c7f646327c44ba6536f74f8b750b65602bdead19d5c9362f297e0a32`.
- Document sentinel: `0fa63130-ae04-4759-bc50-95265bd1cbd7`.
- `performance.timeOrigin`: `1788750939131.535`, unchanged for all five edits
  and their restorations. Actual Vite `js-update` messages were recorded.

### Actual keyboard/PTY proof, beyond the command API

Using Browser Control's real keyboard input in xterm:

1. Typed `printf HYBRID_PTY_OK; tty; uname -m`. Linux printed
   `HYBRID_PTY_OK/dev/pts/0` and `x86_64`.
2. Typed `sed -i 's/Ready for an agent edit/Typed Linux PTY edit/'
   src/WelcomeCard.tsx`, then clicked **Sync Linux save**.
3. Preview displayed **Typed Linux PTY edit**; exact guest/worker bytes and the
   expected one-string source change matched; the same Document survived.
4. Typed the inverse Linux `sed`, synchronized, and verified exact restoration.
5. Ctrl-C interrupted native `sleep 60`; the next typed command printed
   `HYBRID_CTRL_C_OK` and `stty size` returned `24 80`.

The existing serial helper initially interprets xterm-pty's `[cols, rows]` in
reverse, producing an 80-row/24-column guest PTY until resize. Hybrid's connection
adapter now sends a corrective resize immediately after readiness; the live
equivalent was exercised before the successful Ctrl-C/geometry check. Existing
QEMU source remains untouched.

Additional checks:

- Deliberately corrupted the worker **staging** write. Synchronization rejected
  with `Worker staging hash mismatch`; target source and preview Document stayed
  unchanged, and the staging file was removed. A subsequent ordinary sync passed.
- **accel stop** removed the worker Vite service while a Linux command still
  printed `LINUX_SURVIVES_ACCEL_STOP`. **accel start vite** rendered the original
  fixture again. Service restart intentionally creates a new preview Document;
  this is separate from same-Document edit acceptance.

## Cold/startup costs — boundaries matter

The final proof used a new origin, new Linux guest, new accelerator kernel, and
the browser-produced dependency pack. Browser-wide HTTP/Wasm caches were **not
cleared**, and assets came from local static delivery, not a WAN download.
These are separately timed interactive phases, not one uninterrupted
boot-to-preview stopwatch; there were development/inspection gaps between clicks.

| Phase | Observed |
|---|---:|
| Accelerator boot + fixture mount | **408.150 ms** |
| Load, hash-check, decompress, decode and mount prebaked worker dependencies | **5,838.660 ms** |
| Linux start → detected login prompt | **26,100.060 ms** |
| Linux start → detected `/workspace` root prompt | **76,700.075 ms** |
| Fresh Linux bridge transfer/start | **7,685.840 ms** |
| Explicit Vite start, including initial Linux sync → server ready | **1,029.905 ms** |
| Same Vite start → first visible fixture | **1,873.335 ms** |
| Vite's own readiness message | **439 ms** |

Linux root-prompt timing includes root login dispatch and the image's native
Bun/OpenCode version probes. The image's OpenCode probe is visibly slow. The
initial investigation's coarsely observed first root prompt was about 140s;
that was not a tightly observed benchmark and is not silently discarded as a
cold success. The final prompt timings above have a 100 ms observation interval.

Payload/artifact costs:

- Existing QEMU artifacts: **408,543,741 bytes / 389.62 MiB**. The root filesystem
  package alone is **338,807,702 bytes**; the Wasm emulator is **41,350,146 bytes**.
  Linux gets 512 MiB guest RAM; QEMU retains its large fixed Wasm memory allocation
  (~2.3 GB). This hybrid does not solve the emulation/image memory budget.
- In the final local resource trace, rootfs delivery took **588.075 ms** and
  reported 338,808,002 transfer bytes including Resource Timing overhead.
  Some other entries report zero transfer size and worker entries have anomalous
  negative durations; they are retained in raw evidence and not interpreted as
  zero-cost uncached downloads. Use payload sizes for network planning.
- Isolated fixed runtime JS: about **4.62 MB** plus the emitted MIT notice.
- npm bootstrap payload: **2,786,525 bytes**.
- Worker dependency pack: **26,324,873 compressed bytes**, 6,196 files,
  **104,990,455 logical bytes** (plus the small root npm lock in the archive).
- First worker `npm install` attempts took 14–17s and exposed the race below.
  After the fix, install with an existing browser npm cache took **5.219s**.
  A separate real browser `npm ci --no-audit --no-fund` using the committed
  worker lock passed in **5.988s**. Neither cached result is a clean-network npm
  install claim. The worker-generated archive took **8.012s** to construct;
  exporting its bytes through Browser Control took over a minute.

## Why a runtime overlay was necessary

Initial fully hash-verified runs used the concurrently developed patched build
(`process-worker-Dwjl77PL.js`, SHA-256
`c4220c8dbaf01a00a90890e3111606945caa1ccc2ab8a0aa234885868b1293ba`). npm warned
`TAR_ENTRY_ERROR Offset is outside the bounds of the DataView` / `EBADF`; Vite
started, but esbuild Go/Wasm panicked in `syscall.mapJSError`, then reported
`The service is no longer running: esbuild service exited with code 2`.

The pristine baseline build (`process-worker-BGsnlvE5.js`, SHA-256
`af86b2501de3911c1dc92d5554c66d7ba44d4a9ec98c2946003f687a02234ce2`) reproduced
with QEMU active. A **separate no-QEMU control**, same baseline and fixture,
installed without warnings and rendered successfully. This excludes attributing
the finding solely to the other agent's recent FFI/ABI work.

A temporary worker-local diagnostic wrapper reported a filesystem read of
Lucide's `webhook.js` with a 716-byte buffer failing at `Uint8Array.set` inside
the syscall-backed binding. A standalone read of the same 715-byte file worked.
The synchronization defect is concrete:

1. Responder stores `STATE_RESPONSE_OK` for request N.
2. Caller observes it before responder's `Atomics.notify`, so its wait returns
   `not-equal` and it can submit N+1 immediately.
3. The delayed notification for N wakes N+1 while its state is still
   `STATE_REQUEST`.
4. The old client waits only once, then consumes its request bytes/stale response
   length as if they were a response.

The two-site source overlay changes the wait to:

```js
while (Atomics.load(ctrl, I_STATE) === STATE_REQUEST) {
  Atomics.wait(ctrl, I_STATE, STATE_REQUEST);
}
```

It applies to process `packages/runtime/fs-client.js` and kernel
`packages/kernel-host/kernel-fs.js`. The test forces exactly the stale-wakeup
interleaving: old code returns in request state; patched code waits again.
It is a deterministic negative control, not a claim that the precise CPU
interleaving was traced in the failing Chrome run. The failure shape, direct
source defect, no-QEMU control, and successful hybrid reruns support the diagnosis.

The fixed worker is `process-worker-BupKD3E8.js`, SHA-256
`f7a3e22feab90c102ee57f1401c62c61f4ae76dfd44a9c7ed3aeada892a4b96a`.
Its kernel is `kernel-worker-C2LklNSp.js`, SHA-256
`5e5a7cb76c358c68755a4f25c78d76ce35378a3121eeb9c5c25d5c124c030d04`.
`hybrid/runtime-build.json` records source, Wasm-input and output hashes.
Builds use a source-loader overlay over the clean pinned baseline, with no
shared source edits and no hand-edited generated runtime bundle.

During development, replacing only the accelerator kernel exposed an existing
SDK teardown limitation: its old Service Worker listener retained the HTTP
MessagePort. The first fixed-runtime preview needed a preview-only retry after
disabling that destroyed worker's listener. **The final :5213 proof was a clean
page/kernel boot and required no such workaround.** This runtime-replacement
trick is not part of the product or reproduction steps.

## Scope, persistence, and next milestones

- **Not a coherent shared filesystem.** QEMU has a private block disk; no
  shared mount is configured. Sync is explicit, Linux-authoritative, one fixed
  regular source file, <=32 KiB, using a verified snapshot and staged rename.
  No multi-file transaction, durable OPFS acknowledgment, background watcher,
  bidirectional write flow, or protection against edits after capture is claimed.
- Other source/config files start from the identical pinned fixture but are not
  synchronized. Linux `node_modules` is separate from the worker's WASM-compatible
  tree. The latter includes real Vite-generated, path-specific optimized caches.
  Its archive is checked against the runtime JS, fixture package, and `/workspace`
  path; it is not evidence of general native dependency portability.
- Shell, commands, Ctrl-C, and native tool execution are Linux-owned. Explicit
  accelerator start/status/stop are presently UI controls, not a guest `accel`
  executable. Adding that small command protocol is a next usability milestone.
- Actual **OpenCode TUI inside QEMU: unattempted** in this hybrid task. Login's
  version output is not a TUI/agent-loop pass. The parallel Vivari renderer/ABI
  work and its active :5204/:5205 demos were preserved.
- All implementation changes and checked-in evidence summaries are confined to
  `hybrid/` and this document. Existing QEMU implementation and Vivari runtime,
  patch, package, and main files were not modified.

## Reproduction, tests, evidence

Follow [`hybrid/README.md`](../hybrid/README.md) for complete setup, interactive
commands, dependency-pack recreation and runtime overlay rationale.

Passed:

- `bun test scripts/*.test.ts`: snapshot/corruption/atomic rename guard and two
  late-notification negative controls, 3 tests / 11 assertions.
- `bun run runtime:build` and `bun run build`.
- `bunx --package node-bin-darwin-arm64@24.18.0 node scripts/verify-runtime.mjs`:
  full pinned upstream suite **RESULT: PASS**. `--import` propagates the source
  overlay into worker threads as well as the parent kernel.
- Real browser npm ci; fresh dependency-pack integrity/mount/render; two five-edit
  HMR batches with restoration; real keyboard/PTY edit; corruption rejection;
  Ctrl-C, initial geometry, service stop/restart; host static-only boundary checks.

Ignored local raw evidence under `hybrid/evidence/`:

- `final-hybrid-proof.json`: final cold phases, five edit receipts, HMR envelopes,
  byte/Document checks, extra qualification, terminal and resource timings.
- `first-warm-pass.json`: earlier five-edit pass before packaging.
- `patched-runtime-failure.json`, `baseline-with-qemu-failure.json`.
- `upstream-verify.txt`.
- `typed-linux-hmr.png`, `restored-hybrid-preview.png` (visually inspected).

Archive SHA-256:
`699decd21a10eee28eb8f50cb3cab5d1f8069e1eff9d63cedaec2a1079761b98`.
The checked-in `deps-manifest.json` and `worker-package-lock.json` identify it;
the 26.3 MB binary is ignored and can be regenerated in the browser. The original
Linux image was reused, with its already-installed toolchain and fixture deps;
no new emulator/image build or host-native fixture transform was needed.
