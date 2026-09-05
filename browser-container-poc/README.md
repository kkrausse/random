# Browser container POC

v0 boots an x86-64 Alpine Linux guest under QEMU-Wasm in a browser worker and connects an interactive serial terminal.
It establishes the first milestone in [`plan.md`](./plan.md); it does **not** yet include OpenCode, Bun, Vite, or the
preview/HMR network bridge.

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
attempted JIT-disable experiments used an ignored prefix. Vite dev mode now reports ready in the browser guest;
direct HTTP validation is in progress. The production build was canceled to focus on the dev/HMR goal.
See the result card for exact commands, timings, and handoff state.
After validating Vite dev HTTP, add an explicit guest HTTP/WebSocket bridge for Vite assets and HMR, followed by the bounded
model relay. The empty preview pane intentionally does not claim those milestones are complete.

## Pinned upstream

- QEMU-Wasm source reviewed at `0ef7b4e2814b231705d8371dd7997f5b72e70baf` (experimental, QEMU licensing applies).
- Browser artifacts from `qemu-wasm-demo-images@b7c549b5e6f4c376f76483a03e983214421434ad`.
- Execution arguments select QEMU TCG with its Wasm hot-block compilation backend (`tcg,tb-size=500`).
