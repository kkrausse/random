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

At the first handoff the stalled VM was stopped by navigating back to the workspace shell.
The HTTP/WebSocket/HMR bridge has not been implemented.

## Follow-up: JSC option prefix diagnosis

**Correction to the earlier interpretation:** Bun 1.4.2 ignores `JSC_*` environment options. It explicitly disables
JSC environment-option loading and applies `BUN_JSC_*` options instead. The native build pass above remains an observed
pass, but attributing it to `JSC_useFTLJIT=false` was incorrect. Source:
[`JSCInitialize` in the pinned Bun release](https://github.com/oven-sh/bun/blob/bun-v1.4.2/src/jsc/bindings/ZigGlobalObject.cpp#L283-L379).

Fresh browser VM, same artifacts and unchanged fixture:

| Requested configuration (ineffective prefix) | Workload | Observed outcome |
| --- | --- | --- |
| `JSC_useJIT=false` | `tsc -b --verbose`, 180-second timeout | Project check started; timeout killed it, exit 137, prompt restored (182 seconds). |
| `JSC_useJIT=false` | Vite production build, 300-second timeout | Printed Vite 7.1.4 banner; timeout killed it, exit 137, prompt restored (303 seconds). |
| `JSC_useJIT=true JSC_useDFGJIT=false` | TypeScript, 300-second timeout | Project check started; timeout killed it, exit 137, prompt restored (303 seconds). |
| `JSC_useJIT=false` | TypeScript with `--generateTrace`, 900-second limit | Aborted after 115 seconds, exit 134, while parsing `csstype/index.d.ts`. |

The last run printed `Unexpected code block in DFG->FTL tier-up: parseTypeLiteral` followed by a Bun panic. That
contradiction exposed the ineffective configuration; these runs do **not** establish no-JIT or baseline-only performance.
Running the traced workload in the background allowed shell commands to inspect its log, trace, and `/proc` memory usage.

The corrected experiment uses `BUN_JSC_useJIT=false BUN_JSC_useFTLJIT=false`. In the browser guest,
`BUN_JSC_dumpOptions=1 bun -e 'console.log(123)'` confirmed both `useJIT=false` and `useFTLJIT=false`, then printed `123`.
Always verify effective options rather than merely echoing environment variables.

That corrected no-JIT workload was interrupted by the browser session becoming `about:blank` before an exit marker
was captured. Its trace had reached `csstype/index.d.ts`; no build outcome or performance conclusion is available.
See `browser-control-todo.md`. A fresh VM was then started with **only** `BUN_JSC_useFTLJIT=false`, retaining baseline
and DFG JIT, and with `BUN_JSC_dumpOptions=1` on the actual TypeScript command to confirm the effective option.

### Correct-prefix browser TypeScript: PASS

Executed in the fresh VM:

```sh
export BUN_JSC_useFTLJIT=false
(date +%s
 BUN_JSC_dumpOptions=1 timeout -s KILL 900 bun node_modules/typescript/bin/tsc \
   -b --verbose --extendedDiagnostics --generateTrace /tmp/ts-ftloff
 echo FTL_OFF_TSC_EXIT=$?
 date +%s) >/tmp/ts-ftloff.log 2>&1 &
```

- Effective options printed `useFTLJIT=false`; baseline and DFG JIT remained enabled.
- **`FTL_OFF_TSC_EXIT=0`**, with the shell still responsive.
- Wall timestamps: `1788648141` to `1788648655` (**514 seconds**, including startup and tracing).
- 82 files; 50,712 library lines; 59,621 definition lines; 20 fixture TypeScript lines.
- TypeScript-reported memory: 105,445 KiB; parse 193.66 s; bind 107.55 s; check 56.95 s.
- TypeScript total: 376.29 s; diagnostic type dump: another 113.49 s; build: 499.38 s.
- This is a traced run, not an uninstrumented build benchmark. The fixture was unchanged.
- Full log exported and gzip integrity verified at
  `/private/var/folders/t_/x48jtnps7n5_0g_pt9xpvbg00000gn/T/opencode/browser-ts-ftloff.log.gz`.

The checked-in guest recipe now uses the correct prefix and rejects an option probe that does not report
`useFTLJIT=false`. Generated guest artifacts have **not** been rebuilt with this correction; the current VM receives
the setting manually. Host `bun run build`, shell syntax checks, and `git diff --check` pass.

### Handoff / next gate

Stopped at the successful TypeScript result at the user's request. The VM is **idle at its shell**, with the FTL setting
exported, `/tmp/ts-ftloff.log` and `/tmp/ts-ftloff/` available until restart, and `/workspace` selected. Host dev server
remains at `http://localhost:5173/`. Browser Control session: `amber-walrus-881`; use the now-installed Bun-backed
`browser-control` CLI. The page was foregrounded for the successful run.

1. Run Vite separately with `BUN_JSC_useFTLJIT=false`, e.g.
   `timeout -s KILL 900 bun node_modules/vite/bin/vite.js build; echo VITE_EXIT=$?`.
   **Vite with the corrected prefix has not been run.**
2. Verify uninstrumented `bun run build`, cancellation, and Vite dev-server startup. Keep timeouts and capture exit markers.
3. Rebuild the guest with the corrected recipe and validate native checks plus a fresh browser boot/workload run.
4. Only after the browser workload gate, implement HTTP/WebSocket/HMR transport, then model access and the real
   OpenCode multi-file edit to visible HMR demonstration. OpenCode version output alone does not satisfy that contract.

The TypeScript blocker is cleared for this configuration; full browser build, Vite preview/HMR, and the real agent loop
remain unproven. No guest or QEMU artifacts were regenerated in this follow-up.

Final `public/qemu/` disk usage after the patched runtime copy: **390 MiB**. Host free space: **15 GiB**. No broad Docker
pruning was performed. A final `docker system df` failed with a missing-snapshot error, so fresh Docker usage totals are
unavailable.

## Continuation: standalone Vite and repeatable workload gate

Resumed `amber-walrus-881` without rebooting. The installed `browser-control` wrapper is on PATH and working;
`bunx --bun @opencode-ai/browser-control` also works. The exported `BUN_JSC_useFTLJIT=false` remained set.

Started the standalone Vite build at guest timestamp `1788648999`:

```sh
(date +%s
 timeout -s KILL 900 bun node_modules/vite/bin/vite.js build
 echo VITE_EXIT=$?
 date +%s) >/tmp/vite-ftloff.log 2>&1 &
```

It reached the Vite 7.1.4 banner and `transforming...`; the serial shell remained responsive.
At the user's direction, switched focus to dev serving/HMR instead of production optimization.
Sent SIGTERM to Bun and verified `VITE_EXIT=143` at `1788649494` (495 seconds after launch), no remaining Bun/timeout
processes, and a responsive shell. This is a successful cancellation check, not a production-build pass or timeout.
The background host observer completed after capturing the exit marker.

Added `guest/validate-workload.sh`, installed as `validate-workload` by future guest builds. It checks effective
JSC settings, deletes fixture build metadata for a clean full build, requests the Vite index/client/transformed source
over guest loopback, and checks server termination. The script was transferred into the existing guest at
`/tmp/validate-workload.sh` in 160-character base64 chunks; both host and guest report SHA-256
`3ff76928a59d09308256be18aff47206b088f4277cd6830aa90d343677a94570`.
The queued full-workload check correctly skipped execution because standalone Vite was canceled.
The checked-in script now defaults to **dev only**; `validate-workload build` opts into the slower clean production build.
The transferred script/hash above describes the earlier version, not this updated default.

Started Vite dev mode directly in the same guest with the corrected FTL setting:

```sh
(date +%s
 bun node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort
 echo DEV_EXIT=$?) >/tmp/vite-dev.log 2>&1 &
```

Dev HTTP and preview/HMR results are pending. Production bundling is no longer a gate for the dev/HMR POC.

Vite dev mode printed **`VITE v7.1.4 ready in 64001 ms`** and `http://127.0.0.1:5173/`.
The first curl attempts exposed inherited proxy variables routing loopback requests to `192.168.127.253:80`.
The validator now passes `--noproxy '*'` on all guest HTTP checks; the live shell also exports loopback `NO_PROXY`.
A direct request connected but exceeded its initial 10-second response limit. Retrying in the background with a
180-second bound, writing the response to `/tmp/dev-index.html` and an `INDEX_HTTP_EXIT` marker to `/tmp/dev-http.log`.

Host `bun run build`, shell syntax checks, and `git diff --check` passed. Guest/runtime images have not been rebuilt
in this continuation. `docker system df` now succeeds; no cleanup was performed.
