# Toolchain guest execution — 2026-09-05

## Build diagnosis

1. Reproduced the reported hang with native QEMU `max,-popcnt`: the frozen Bun install printed only
   `============================================================` and stopped making visible progress. Canceled that run.
2. With `max`, Bun `1.4.2` and OpenCode `0.0.0-beta-19157` started and 71 fixture packages installed.
   TypeScript passed, but Vite triggered a Bun abort in JavaScriptCore's `FTL::LazySlowPath::generate`.
3. With `max` and `JSC_useFTLJIT=false`, the native guest checks all passed:
   - Bun `1.4.2`
   - OpenCode `0.0.0-beta-19157`
   - Frozen fixture install: 71 packages, 29.54 seconds
   - `tsc -b`: passed
   - Vite `7.1.4`: 1,670 modules transformed; built in 41.65 seconds
   - Kernel/initramfs: `6.12.107-0-virt`
4. Packaging exposed macOS Bash 3's empty-array behavior with `set -u`. Replaced the optional array with a string flag.

The installer now bounds version commands to 120 seconds, install/build commands to 600 seconds each, and the entire
native QEMU run to 30 minutes. Failed workload runs are rejected by the disk validation marker check.

## QEMU-Wasm correction

Pinned source: `0ef7b4e2814b231705d8371dd7997f5b72e70baf`.

`guest/qemu-popcnt.patch` fixes two errors in the Wasm code generator:

- Both ctpop handlers used `args[1], args[2]` rather than destination/source `args[0], args[1]`.
- The 32-bit handler stored an i32 result into an i64 register global without extending it.

`guest/popcnt-test.S` checks both widths and several operand patterns in a 100,000-iteration loop to exercise hot-block
compilation. Its standalone ELF passed under Docker's x86-64 execution before browser testing.

The runtime builder also corrects the historical zlib archive URL and enables Emscripten LZ4 for the guest disk package.

## Browser validation

Guest packaging completed successfully; `public/qemu/guest-build.txt` records `max`, the POPCNT patch requirement,
and `JSC_useFTLJIT=false`. Before replacing the baseline runtime, `public/qemu/` occupied 391 MiB.

Verified the UI's compatibility check: starting this guest with the baseline runtime displays the required
`bun run runtime:build` instruction and leaves Restart VM available.

The patched runtime compiled all 1,495 Ninja steps and copied its JS/Wasm/worker artifacts successfully. The active
shell script had been edited during compilation, which disrupted its final host-side marker command; the marker was
written separately after verifying the copied artifacts. The checked-in script includes the complete marker step.

Executed in Chromium at `http://localhost:5173/`:

- Kernel `6.12.107-0-virt` reached `demo login:` with CPU `max`, without the earlier kernel panic.
- Root login printed Bun `1.4.2`, OpenCode `0.0.0-beta-19157`, and `/workspace`.
- The standalone regression printed `POPCNT32/64: 100000 iterations passed` and `POPCNT_EXIT=0`.
- The first long browser-control wait for the fixture build lost the session-owned page; no build outcome was captured.
  See `browser-control-todo.md`. A fresh VM boot and root login also passed; build verification was retried with
  short browser-control calls and a guest-side timeout.

The second browser build confirmed `FTL=false` and printed `$ tsc -b && vite build`, but did not reach Vite or a build-exit
marker during observation. Ctrl-C did not return to the shell within a further 120-second wait. The page and iframe
remained inspectable. This is an unresolved guest/emulator stall, not a successful browser fixture build.

At handoff the stalled VM was stopped by navigating back to the workspace shell; the Start VM button is available.
The next diagnostic is a fresh VM with `export JSC_useJIT=false`, then separate TypeScript and Vite commands to isolate
the failure. That no-JIT experiment has **not** been executed. The HTTP/WebSocket/HMR bridge has not been implemented.

Final `public/qemu/` disk usage after the patched runtime copy: **390 MiB**. Host free space: **15 GiB**. No broad Docker
pruning was performed. A final `docker system df` failed with a missing-snapshot error, so fresh Docker usage totals are
unavailable.
