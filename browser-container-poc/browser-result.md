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

### Vite dev guest HTTP: PASS

All three direct guest-loopback requests completed successfully:

| Request | Exit | Response bytes |
| --- | --- | --- |
| `/` | `INDEX_HTTP_EXIT=0` | 518 |
| `/@vite/client` | `CLIENT_HTTP_EXIT=0` | 177,754 |
| `/src/main.tsx` | `SOURCE_HTTP_EXIT=0` | 1,390 |

Fresh serial inspection confirmed the HTML contains the React Refresh bootstrap, `/@vite/client`, and the fixture
`/src/main.tsx` entrypoint. The successful index request ran from `1788649640` to `1788649713` (**73 seconds**).
This is first-request latency during dev startup, not a warm-request or HMR measurement. Vite remains running in
session `amber-walrus-881`. The HTTP gate is cleared; the adjacent preview and actual HMR WebSocket are still unbridged.

Host `bun run build`, shell syntax checks, and `git diff --check` passed. Guest/runtime images have not been rebuilt
in this continuation. `docker system df` now succeeds; no cleanup was performed.

## Adjacent guest preview and actual HMR: PASS — 2026-09-05

Implemented a serial-backed HTTP/WebSocket bridge. QEMU still has `-nic none`; application execution and the real
Vite HTTP/WebSocket endpoints remain inside the guest at `127.0.0.1:5173`. There is no host HTTP proxy for guest assets.

- `guest/preview-bridge.ts`: concurrent loopback HTTP, gzip/base64 responses, real text WebSockets, and guest shell commands.
- `public/serial-bridge.js`: framed JSON over the existing QEMU PTY, correlated requests, socket channels, bounded waits,
  streaming UTF-8 decoding, and bounded HMR event diagnostics.
- `public/preview-sw.js`: scoped `/__guest/` navigation and controlled-document asset fetching through MessageChannels.
  Guest HTML receives `preview-websocket.js` ahead of the Vite bootstrap; successful and error responses carry COEP/CORP.
- `src/App.tsx`: Connect preview, adjacent iframe, Reload preview, and a guest command field. The React component is now
  separated from the `createRoot` entrypoint so editing the workspace component preserves the running VM.

### Startup and cold-load findings

The handed-off VM was lost during host UI development reloads. A later host-server outage also triggered Vite reconnect
navigation; the host server was restarted with user permission. Final verification used a fresh VM in the same
`amber-walrus-881` session. The slow login-time OpenCode version probe was interrupted; its version had already been proven.
These development interruptions are not guest workload failures. See `browser-control-todo.md` for exact errors.

Guest Vite must have stdin detached; otherwise it can be suspended with `Stopped (tty input)` after printing readiness:

```sh
cd /workspace
export BUN_JSC_useFTLJIT=false
bun node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort \
  </dev/null >/tmp/vite-dev.log 2>&1 &
```

The final run printed `ready in 63883 ms`. Connect preview transferred the helper at a shell prompt without rebooting.
Host and guest SHA-256 both matched:
`7115e84e557f34f5846092cae8b3b7933fbbade339697bec91a3ca7da4c05e4c`.

The first preview attempt preceded server readiness. A retry loaded the guest HTML and transformed modules, and the
guest HMR client reported `[vite] connected.` Cold dependency optimization then exceeded the helper's 240-second timeout
for the first `react-dom_client.js` request (HTTP 502). The optimized dependency directory eventually contained 6 MiB,
including React DOM and Lucide. Reloading **only the preview** against the warm cache rendered the full fixture, its
stylesheet, SVG mark, and Lucide icon. This is a successful warm-cache render, not an uninterrupted cold-load pass.

A temporary serial wakeup diagnostic was tried during cold optimization, then disabled before the successful warm
render and HMR check. It is not part of the bridge. The live serial connection received the same UTF-8 decoding fix
covered by the transport test. No guest or QEMU images were regenerated.

### Actual hot update

Baseline adjacent preview: `http://localhost:5173/__guest/`, heading **Ready for an agent edit**.
Through **Guest command → Run in guest**, executed:

```sh
sed -i 's/Ready for an agent edit/Guest HMR is live/' src/WelcomeCard.tsx
grep h1 src/WelcomeCard.tsx
```

The command exited 0 and printed `<h1>Guest HMR is live</h1>`. The host fixture source was not edited.

| Evidence | Observed value |
| --- | --- |
| Host start timestamp, before filling/running the command | `1788652739240` ms |
| Guest Vite WebSocket event | `js-update`, path and acceptedPath `/src/WelcomeCard.tsx`, timestamp `1788652740208` |
| WebSocket event received by serial bridge | `1788652745353` ms (6.113 s after start) |
| Updated module | `/src/WelcomeCard.tsx?t=1788652740208`, HTTP 200, `fromServiceWorker: true` |
| Vite console | `[vite] hot updated: /src/WelcomeCard.tsx` |
| DOM mutation observed | `1788652754354` ms — **15.114 seconds** after start |
| Visible heading afterward | **Guest HMR is live** |
| Document sentinel, before and after | `f37d2cb3-8e54-45ae-9f25-3431e745e80c` |
| `performance.timeOrigin`, before and after | `1788652645373.725` |

The unchanged sentinel and time origin prove the preview document was not reloaded. This measures a guest shell edit,
WebSocket notification, transformed-module fetch, and React Refresh render—not a model-driven OpenCode edit.
The bridge counted 27 HTTP requests across cold attempts, warm reload, and HMR; 3 inbound WebSocket messages;
and zero JSON framing errors. HTTP count includes the failed cold request.

Evidence JSON and a visually inspected screenshot are saved in the approved temporary directory:

- `/private/var/folders/t_/x48jtnps7n5_0g_pt9xpvbg00000gn/T/opencode/guest-hmr-proof.json`
- `/private/var/folders/t_/x48jtnps7n5_0g_pt9xpvbg00000gn/T/opencode/guest-hmr-preview.png`

Validation: host `bun run build`; `bun test scripts/preview-bridge.test.ts` (service-worker routing/decompression/HTML
injection and out-of-order, fragmented UTF-8 serial responses); native helper gzip/HTTP smoke check; `git diff --check`.

Handoff: the VM, guest Vite, bridge, and updated adjacent preview remain running in `amber-walrus-881`.
Use the guest command field while the bridge owns the serial tty. Host Vite runs on port 5173.
Next milestone: bounded model access and an actual OpenCode multi-file edit producing visible HMR.
