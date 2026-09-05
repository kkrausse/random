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

Guest sessions set `JSC_useFTLJIT=false` via `/etc/profile.d/browser-toolchain.sh`: a subsequent native-QEMU Vite build
aborted in JavaScriptCore's `FTL::LazySlowPath::generate`. This disables the highest optimization tier while retaining
the lower JIT tiers, and leaves the pinned Bun/OpenCode binaries unmodified. The builder uses the same setting.

The baseline browser runtime still uses `max,-popcnt` to avoid the known kernel panic. The patched runtime enables `max`:
`guest/qemu-popcnt.patch` corrects both ctpop operand indexes and zero-extends the 32-bit Wasm result before storing it in
the 64-bit register global. `public/qemu/runtime-build.txt` selects the patched CPU configuration; the toolchain image
requires that marker. `bun run artifacts` removes both custom build markers when restoring the baseline.
The runtime build also emits `public/qemu/popcnt-test`, a standalone x86-64 regression executable from
`guest/popcnt-test.S` that checks 32/64-bit, zero, patterned, and in-place operands over 100,000 iterations.

## Known boundary

The custom image now boots in the browser, prints the pinned toolchain versions, and passes the POPCNT regression.
The browser fixture build is still blocked: it stalls during the TypeScript step, even with FTL disabled. The next
diagnostic is `JSC_useJIT=false` in a fresh guest; this experiment is not yet executed. See the result card for details.
After resolving that stall, add an explicit guest HTTP/WebSocket bridge for Vite assets and HMR, followed by the bounded
model relay. The empty preview pane intentionally does not claim those milestones are complete.

## Pinned upstream

- QEMU-Wasm source reviewed at `0ef7b4e2814b231705d8371dd7997f5b72e70baf` (experimental, QEMU licensing applies).
- Browser artifacts from `qemu-wasm-demo-images@b7c549b5e6f4c376f76483a03e983214421434ad`.
- Execution arguments select QEMU TCG with its Wasm hot-block compilation backend (`tcg,tb-size=500`).
