# Browser container POC

This POC boots an x86-64 Alpine Linux guest under QEMU-Wasm in a browser worker, connects a serial terminal,
and bridges guest Vite HTTP and HMR into an adjacent preview. The custom guest includes Bun and OpenCode;
the real model-driven editing loop remains a later milestone. See [`browser-result.md`](./browser-result.md) for evidence.

## Run

Chrome/Chromium is recommended. The runtime allocates a fixed 2.3 GB Wasm memory and a 512 MB guest, and downloads about
145 MB on first setup.

```sh
bun install
bun run artifacts
bun run dev
```

Open the printed local URL, choose **Start VM**, wait for `demo login:`, and log in as `root` with no password. The root
filesystem uses an in-memory overlay, so guest changes disappear when the iframe is restarted.

`bun run artifacts` downloads from the immutable `qemu-wasm-demo-images` revision in `artifacts.lock.json`. Every file is
validated against its expected Git blob hash and size. Generated artifacts live in `public/qemu/` and are not committed.

## What v0 proves

- QEMU system emulation starts in a browser without a host compute process.
- The x86-64 guest boots from pinned kernel, initramfs, ROM, and root filesystem artifacts.
- Browser input/output is connected to the guest serial console.
- Development and preview servers emit the COOP/COEP headers required by Wasm threads.

## Build the toolchain guest

The downloaded image is only the Alpine boot baseline. A custom image recipe in `guest/` adds Bun 1.4.2's stock
x64-musl baseline build, OpenCode V2 `0.0.0-beta-19157`'s stock x64 baseline-musl binary, and a preinstalled Vite
fixture. The Alpine ISO, Bun archive, and OpenCode npm artifact are pinned and verified before use. Building requires a
running Docker daemon and is intentionally separate because it boots an x86-64 Alpine installer under native QEMU and
then builds the Emscripten preload packages:

```sh
# Fetch the base QEMU/ROM artifacts first, then replace its guest packages.
bun run artifacts
bun run guest:build
bun run runtime:build
```

The build is slow and writes generated files to `public/qemu/`. On the next VM boot, logging in as `root` prints the
pinned Bun and OpenCode versions and starts in `/workspace`. Re-running `bun run artifacts` restores the upstream boot
baseline; run `bun run guest:build` afterward to restore the toolchain guest.
Also run `bun run runtime:build` to restore the patched QEMU runtime. The runtime builder uses the pinned QEMU source
plus `guest/qemu-popcnt.patch`; it retains its source checkout in `.cache/qemu-runtime` and its Docker builder image
for subsequent builds. Compilation uses two jobs to limit peak resource usage.

The builder removes its temporary QEMU checkout and raw 768 MB disk output when it exits. It retains verified downloads
in `.cache/downloads/`, browser-ready files in `public/qemu/`, and normal reusable Docker layers.

### Toolchain build status

The native-QEMU validation has passed through all guest workload checks: Bun reports `1.4.2`, OpenCode reports
`0.0.0-beta-19157`, the frozen fixture install completes, TypeScript compiles, and Vite builds the fixture. Custom guest
artifact packaging has also completed. See [`browser-result.md`](./browser-result.md) for the executed checks and browser
validation status.

The native guest builder uses `-cpu max`. Disabling POPCNT reproduced a Bun startup hang, printing only its crash-report
separator during the frozen install. Version checks now run before installation, with bounded timeouts for each workload
and a 30-minute outer installer limit.

The guest recipe sets `BUN_JSC_useFTLJIT=false` via `/etc/profile.d/browser-toolchain.sh` to disable Bun's highest
optimization tier while retaining the lower tiers. FTL crashes have been observed under QEMU. The builder uses the same
setting and checks Bun's effective option dump before installing dependencies. The pinned binaries remain unmodified.
**Existing generated artifacts still contain the old, ineffective `JSC_useFTLJIT=false` setting.** Bun 1.4.2 only reads
`BUN_JSC_*`; export `BUN_JSC_useFTLJIT=false` manually when testing those artifacts. The corrected recipe has not yet been
rebuilt. See the result card for the distinction between observed native passes and the earlier incorrect JIT diagnosis.

The baseline browser runtime still uses `max,-popcnt` to avoid the known kernel panic. The patched runtime enables `max`:
`guest/qemu-popcnt.patch` corrects both ctpop operand indexes and zero-extends the 32-bit Wasm result before storing it in
the 64-bit register global. `public/qemu/runtime-build.txt` selects the patched CPU configuration; the toolchain image
requires that marker. `bun run artifacts` removes both custom build markers when restoring the baseline.
The runtime build also emits `public/qemu/popcnt-test`, a standalone x86-64 regression executable from
`guest/popcnt-test.S` that checks 32/64-bit, zero, patterned, and in-place operands over 100,000 iterations.

## Known boundary

For repeatable workload validation, the guest recipe installs `validate-workload` from
[`guest/validate-workload.sh`](./guest/validate-workload.sh). Run it in the guest with
`validate-workload >/tmp/workload.log 2>&1 &` and inspect `tail -n 30 /tmp/workload.log`.
It verifies Bun's effective FTL option, starts Vite in dev mode, requests the index/client/transformed source over
guest loopback HTTP, and checks server shutdown. The optional `validate-workload build` mode first removes fixture
TypeScript build metadata and runs a bounded clean production build; this is not required for the HMR POC.
Only `WORKLOAD_PASS` means all these checks passed. This does not validate the browser preview or WebSocket bridge.
Existing generated images need the script copied into `/tmp` and run with `sh /tmp/validate-workload.sh` until rebuilt.

The custom image now boots in the browser, prints the pinned toolchain versions, and passes the POPCNT regression.
Browser TypeScript now **passes** with `BUN_JSC_useFTLJIT=false`, retaining baseline and DFG JIT. The traced run took
514 seconds including startup and diagnostic dumps. `BUN_JSC_dumpOptions=1` confirmed the effective setting; earlier
attempted JIT-disable experiments used an ignored prefix. Vite dev mode now starts and serves the HTML, HMR client,
and transformed TSX successfully over guest loopback HTTP. The production build was canceled to focus on the dev/HMR goal.
See the result card for exact commands, timings, and handoff state.
The serial-backed preview bridge is described below. The bounded model relay and real OpenCode editing loop remain next.

## Guest preview and HMR

At the guest shell prompt, start Vite in the background:

```sh
export BUN_JSC_useFTLJIT=false
bun node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort </dev/null >/tmp/vite-dev.log 2>&1 &
```

Wait for Vite readiness (`cat /tmp/vite-dev.log`), then click **Connect preview**. The workspace transfers
`guest/preview-bridge.ts` into the running guest and starts it with the serial tty in raw mode. A scoped service worker
forwards preview HTTP requests through MessageChannels and the serial transport to guest-loopback Vite. Responses are
gzip/base64 encoded over serial; HTML receives a WebSocket adapter before Vite's bootstrap. The adapter forwards text
messages to a real guest WebSocket, including Vite's HMR token and subprotocol. No host Vite proxy serves guest assets.

While connected, use **Guest command → Run in guest** to edit files or inspect logs; the serial tty is occupied by the
bridge. Commands run in `/workspace`. Restart VM discards the guest overlay and bridge. The POC supports asset GET/HEAD
requests and text WebSockets for Vite; request bodies, binary WebSockets, external networking, and multiple workspaces
on the same origin are outside this bridge's current scope. Preview and workspace share an origin and are trusted POC code.

Cold Vite dependency optimization can exceed the four-minute guest HTTP timeout. After optimization completes,
use **Reload preview** to retry with the warm cache; this preserves the VM. The measured warm-cache guest edit changed
the visible heading in **15.114 seconds**, with a real Vite `js-update` message and no preview-document replacement.
See the result card for the cold-load timeout and exact HMR evidence.

## Pinned upstream

- QEMU-Wasm source reviewed at `0ef7b4e2814b231705d8371dd7997f5b72e70baf` (experimental, QEMU licensing applies).
- Browser artifacts from `qemu-wasm-demo-images@b7c549b5e6f4c376f76483a03e983214421434ad`.
- Execution arguments select QEMU TCG with its Wasm hot-block compilation backend (`tcg,tb-size=500`).
