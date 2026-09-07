# Independent QEMU performance spike

Executed September 6–7, 2026 (UTC logs September 7).

**Bottom line:** the actual pinned OpenCode CLI/server runs, but this spike did
not reach a usable TUI first frame within a 15-minute offline-startup observation.
Warm Vite HMR works with exact source restoration; the final five-sample baseline
was **6.163 s median / 9.732 s worst**. Guest fetch/transform dominates compression.
A prepared Vite dependency cache is accepted and skips optimization, but no
aggregate speedup is established. Variable host contention and a mid-run guest
TSC→HPET clocksource transition prohibit a clean cold/warm speedup claim.

## Scope and reproduction

This spike uses a separate static origin, `http://127.0.0.1:5198/`, and Browser
Control session `gentle-otter-329`. Baseline QEMU source, generated assets, hybrid,
Vivari, shared dependencies and live origins 5204/5205 are not modified.

From the repository root:

```sh
bun browser-container-poc/qemu-perf/serve.ts
# Open the URL in a distinct Browser Control session; Start VM, root login.
bun browser-container-poc/qemu-perf/send.ts gentle-otter-329 'echo guest-command'
browser-control execute --session gentle-otter-329 --file browser-container-poc/qemu-perf/inspect.js
# After guest Vite and preview are ready:
browser-control execute --session gentle-otter-329 --file browser-container-poc/qemu-perf/observe.js
bun browser-container-poc/qemu-perf/profile.ts gentle-otter-329 edit 5 baseline
bun browser-container-poc/qemu-perf/profile.ts gentle-otter-329 http 5 baseline
```

The server serves the existing `qemu/dist` UI and `qemu/public/qemu` assets
read-only. It has no host guest-execution or guest-file API. The send helper only
injects a command into the browser VM serial terminal. Reports go under
`qemu-perf/evidence/`; the existing profiling observer is reused read-only and
restores the original fixture after every edit, including its failure path.
`observe.js` instruments direct guest requests and incoming serial responses in
this page without replacing guest execution. The baseline observer's keyboard-write hook
misses protocol requests now that serial-bridge uses a separately bound writer;
the first five-edit batch therefore has empty transport arrays. The spike's
observer repairs measurement coverage locally, without editing baseline files.
Incoming HTTP records retain actual response IDs, arrival timestamps and guest
timings. They deliberately do not invent path matches under concurrent requests.
In a single edit/restore cycle, the two source responses are temporally distinct.
An intermediate MessagePort observer did not cover preview HTTP and was replaced
by this serial-response observer; its reports contain only direct `exec` timings.

## Inputs and conditions

- Apple M4 Pro, 12 host CPUs, 24 GiB RAM; macOS; browser user agent Chrome
  `152.0.0.0` (Brave binary `152.1.94.117`), browser reports 6 logical cores.
- Browser page reported `visibilityState=visible`. No other tab/kernel or OPFS
  store was reset. Host background contention was substantial and variable:
  other browser renderers, Node processes, Spotlight/media analysis and filesystem
  activity. A host-process snapshot is retained in evidence. These are diagnostic
  timings, not clean-room comparative benchmarks.
- Existing QEMU fork `0ef7b4e2814b231705d8371dd7997f5b72e70baf`, POPCNT patch marker
  `ctpop-operand-indexes`, CPU `max`, 512 MiB guest, TCG `tb-size=500` and QEMU
  hot-block WASM JIT retained. Actual generated artifact SHA-256 values are in
  `qemu-perf/evidence/assets.sha256`; upstream baseline artifact hashes alone do
  not describe this custom toolchain image.
- Bun `1.4.2`; stock OpenCode V2 baseline-musl `0.0.0-beta-19157`. The latter is
  confirmed by the actual guest CLI/server startup logs, not a substitute host
  installation. Download archive pins are in `qemu/guest/versions.env`.
- Generated guest marker still contains ineffective `JSC_useFTLJIT=false`.
  Manually exported `BUN_JSC_useFTLJIT=false`; the guest Bun effective-option
  probe printed `useFTLJIT=false (default: true)` and completed. Baseline/DFG and
  QEMU WASM hot-block JIT are not intentionally disabled.
- Preinstalled fixture `node_modules` exists, but `ls node_modules/.vite` on this
  fresh overlay returned **No such file or directory**. The recipe runs frozen
  install and a production build, not Vite dev dependency optimization. Installed
  npm dependencies and a prepared Vite optimization cache are distinct assets.

## Actual OpenCode startup diagnostic

Boot-to-login was observed at **161.218 s** host time after Start VM (an upper
bound including observation dispatch). Asset delivery was local and fast: rootfs
request ~586 ms, WASM request ~120 ms. Login's automatic OpenCode version command
was interrupted; Bun version output had completed. The actual TUI command was:

```sh
export BUN_JSC_useFTLJIT=false
TERM=xterm-256color COLORTERM=truecolor opencode2 --standalone
```

First attempt started at host epoch `1788748357849` ms. It reached real CLI,
spawned `/usr/local/bin/opencode2 serve --stdio --port 0`, and bootstrapped 46
database migrations (guest log duration 15.244 s). Before a TUI frame appeared,
it failed with `ClientError: Transport`, caused by `TypeError: Was there a typo
in the url or port?`. The failure was observed by 716.321 s. Brief Ctrl-Z/fg
diagnostic pauses are included; this is not an uninterrupted startup benchmark.

Second attempt cleared the guest's inherited proxy environment and set loopback
`NO_PROXY`; command start was `1788749461462` ms. There was still **no first TUI
frame at 910.081 s**. A later diagnostic found the real server had booted location
services (guest log duration 105.767 s), then logged `Failed to fetch models.dev`
with `TimeoutError`. It was eventually stopped by explicit guest PID (911/921).
The later stop time must not be confused with the 910 s observation bound.
The terminal shell continued to work. No credentials were read or supplied.

This identifies an additional offline-startup dependency: QEMU has `-nic none`,
so clearing proxies alone cannot make public model-catalog/update HTTP succeed.
The exact pinned binary contains `OPENCODE_DISABLE_MODELS_FETCH` and
`OPENCODE_DISABLE_AUTOUPDATE`; an offline retry uses these flags. Their presence
was checked in the pinned archive without executing it on the host.

Evidence: `tui-first-attempt.json` and `tui-proxy-cleared-attempt.json` contain
timestamped terminal DOM observations. Startup, input, tools and HMR results
are reported separately; a responsive Linux shell is not a real OpenCode TUI pass.

### Offline attempt: startup gate still fails

```sh
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy
export NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost
export OPENCODE_DISABLE_MODELS_FETCH=true OPENCODE_DISABLE_AUTOUPDATE=true
TERM=xterm-256color COLORTERM=truecolor opencode2 --standalone
```

Started at `1788751080103` host ms; **no TUI first frame at 905.786 s**. The CLI
log confirms `update check skipped`, `reason=disabled`. At the following
diagnostic the real CLI used 108 MiB RSS / 4:54 guest CPU time, its real server
200 MiB / 9:11 CPU time. Both were stopped by their guest PIDs (1012/1022), and
the shell remained responsive. This run was uninterrupted until the observation
bound, then Ctrl-Z exposed diagnostics. No model request or credential access
was needed to reproduce the failed startup gate.

**Gate outcomes:** real pinned CLI/server execution PASS; rendered TUI first
frame FAIL within the bounded observation; OpenCode typing, scrolling, file
picker/local tool execution NOT REACHED. Linux shell input and process control
work, but do not satisfy these OpenCode gates. A full renderer-incompatibility
claim would be premature: much of this time is demonstrably pre-render server
initialization. See `tui-offline-attempt.json`.

An additional guest probe with `BUN_JSC_dumpOptions=2` explicitly confirmed all
three: **`useJIT=true`, `useDFGJIT=true`, `useFTLJIT=false`**.

## Vite cold path and warm-up

Only after stopping the OpenCode processes, started:

```sh
DEBUG=vite:transform,vite:hmr bun node_modules/vite/bin/vite.js \
  --host 127.0.0.1 --port 5173 --strictPort </dev/null >/tmp/perf-vite.log 2>&1 &
```

Vite reported **150015 ms** to ready (guest clock). The preview bridge was
connected before readiness, producing the expected initial HTTP 502. Later,
`node_modules/.vite/deps/_metadata.json` existed and the directory occupied
**6.4 MiB**. The optimizer's esbuild process had accrued **6:58 guest CPU time**;
that is process CPU including service startup, not a host cold-cache wall timing.

The next preview request still timed out on `/src/main.tsx`. Vite debug logs
reported **243606.59 ms** for this first transform and **29469.04 ms** for
`WelcomeCard.tsx`. This occurred after optimized dependency metadata existed:
preparing that cache does not eliminate first-source-transform/JSC warm-up.
The guest bridge's 240 s HTTP bound was exceeded. A subsequent preview-only
reload rendered the actual fixture by **71.591 s** host time (observation upper
bound), retaining the same VM and Vite process. Warm edits are measured after
this explicit warm-up, not counted as cold-load successes.

### First five warm edits and cached delivery

All five source edits and restorations completed with the preview document
preserved. Host-clock edit-to-visible samples, in order: **25.047 / 7.719 /
21.202 / 17.148 / 9.390 s**; median **17.148 s**, worst **25.047 s**. The source
write commands took 0.739–1.586 s; updated-module resource requests took
6.605–20.195 s. Each measured edit was followed by a real restoration transform.
These are much noisier/slower than the prior best 1.883 s, with no runtime
optimization or regression demonstrated by the difference.

Subsequent cached HTTP samples (each preceded by guest curl warm-up):

| Sample | Browser round trip | Guest fetch/body | Guest gzip | Guest curl |
| --- | ---: | ---: | ---: | ---: |
| 1 | 975 ms | 639 ms | 129 ms | 1.083 s |
| 2 | 1631 ms | 1118 ms | 226 ms | 0.581 s |
| 3 | 1287 ms | 622 ms | 327 ms | 1.122 s |
| 4 | 651 ms | 302 ms | 139 ms | 0.327 s |
| 5 | 528 ms | 243 ms | 99 ms | 0.145 s |

Each cached module was 4366 uncompressed bytes / 2408 base64 characters. Guest
timings are guest-clock spans, not exact subtractable components of host time.
Even under contention, already-transformed delivery is substantially cheaper
than the invalidated-module path. Gzip is measurable but does not explain the
multi-second warm-edit tail or the 243 s first-source transform.

The first verified incoming-serial timing probe measured an **11.034 s** visible
edit: resource HTTP **9.997 s host**, guest fetch/body **9.322 s**, guest gzip
**0.142 s**, response **2728 wire bytes**. Restoration then fetched in **6.555 s**
guest time and gzipped in **0.099 s**. The response IDs and timestamps are retained
in `1788754111700-serial-timing-check-edit.json`. This directly supports targeting
the guest transform/request path ahead of compression tuning.

### Five serial-instrumented baseline edits

After the earlier edit/restore batches and cached HTTP probes (same process,
same configuration), the final baseline batch was:

| Sample | Visible host | Module resource host | First HTTP guest fetch/body | Guest gzip |
| --- | ---: | ---: | ---: | ---: |
| 1 | 6.163 s | 4.955 s | 4.328 s | 0.150 s |
| 2 | 5.626 s | 4.146 s | 3.488 s | 0.099 s |
| 3 | 5.923 s | 5.046 s | 3.681 s | 0.591 s |
| 4 | 8.368 s | 7.311 s | 6.710 s | 0.195 s |
| 5 | 9.732 s | 8.449 s | 7.336 s | 0.114 s |

Median **6.163 s**, worst **9.732 s**. All five restored successfully with the
document preserved. Responses were 2726–2730 wire bytes. The report also retains
restoration responses; sample 3 includes an additional HTTP response, so arrival
order is evidence rather than an assumed one-to-one response/path mapping.

This batch follows five uninstrumented edits, five cached HTTP probes, five
direct-request-instrumented edits and two observer-check edits, each with
restoration. The improvement over the first batch is **run-order/warm-up evidence,
not a claimed optimization**. Debug logging was enabled throughout.

## Controlled prepared-cache workflow

The one configuration-preserving experiment exports the completed `.vite` cache
as a tar archive, stops this spike's owned Vite PID, retains the original cache
under `/tmp/qemu-perf-original-vite-cache`, installs the archive at the original
`/workspace/node_modules/.vite` path, and starts a new stock Vite process. It does
not change React/Fast Refresh configuration, source semantics, lockfile or HMR.

```sh
bun browser-container-poc/qemu-perf/put.ts gentle-otter-329 browser-container-poc/qemu-perf/prepared-cache.sh
bun browser-container-poc/qemu-perf/exec.ts gentle-otter-329 'sh /tmp/qemu-perf-prepared-cache.sh <owned-vite-pid>'
```

The initial stop attempt exposed Vite closing the WebSocket without exiting its
Bun process. The script now waits ten seconds, then kills only the explicitly
verified owned Vite PID if necessary. It does not use `pkill` or touch other VMs.
The retry passed; the archive restored metadata byte-for-byte with SHA-256
`c69fd8643ec933d7b55c7978223a01d1f772f7a1dfa96a1c42f2f6030402f004`.

This is a same-VM prepared-cache deployment test, not a newly baked disk-image
benchmark. Comparing its elapsed time with initial startup is confounded by
emulator warm-up, host contention, and request order. The decisive reuse evidence
is Vite's dependency-cache decision and stable metadata, not a cold/warm ratio.

**Cache reuse PASS:** the new Vite process logged:

```text
vite:deps (client) Hash is consistent. Skipping. Use --force to override.
VITE v7.1.4 ready in 467129 ms
```

This proves the installed prepared cache was accepted and dependency optimization
was skipped. It does **not** demonstrate faster startup: the reported ready time
was 467 s versus the original 150 s. Host load averages reached approximately
11.3 / 10.4 / 8.0, with ~1.6 GiB swap in use; background compute and emulator/JSC
state varied. Restart also discards Vite's process-local warm state. The browser
service-worker immutable-response cache survived. An apparent heading at 8.531 s
after clicking Reload preview was still the **old document while navigation was
pending**; this value is rejected as a reload timing. The new document subsequently
committed with time origin `1788755077231.045` and was blank while source requests
warmed up. This distinction prevents falsely counting a stale preview as a pass.

The isolated VM survived a Browser Control execution-context error during a long
readiness wait. A short follow-up recovered the same VM and bridge; details are in
`qemu-perf/browser-control-todo.md`. No other live runtime was reset.

The first post-restart edit attempt overlapped that pending preview navigation
and failed with context destruction, so it is excluded from comparisons. Its
guest write survived the interrupted page `finally` block. The fixture was
manually restored and its SHA-256 verified against the pre-experiment value:
`5ff542b3c7f646327c44ba6536f74f8b750b65602bdead19d5c9362f297e0a32`.
The spike harness now backs up the original file outside page evaluation and
performs a separate verified restoration on browser failure. Evidence is retained
in `prepared-failed-edit-restoration.json` and `prepared-manual-restoration.json`.

The new process eventually logged **322292.74 ms** for `/src/main.tsx`, versus
243606.59 ms on its first predecessor. Again this is first-source work, even
though dependency optimization was skipped. `/@react-refresh` took 16642.14 ms
and `/@vite/client` 4120.01 ms. Requests exceeded the 240 s bridge bound and
returned HTTP 502; the retry is a distinct warm-up phase.

## Clocksource transition: important controlled follow-up

The kernel began with TSC, then at guest uptime ~5669 s declared it unstable due
to watchdog read-back delay and switched to **HPET**. The terminal DOM observer
first captured the completed message at **host epoch 1788753807170 ms**
(`2026-09-07T04:03:27.170Z`). This is after the earlier TUI attempts and first warm
batches, but before the serial-instrumented baseline and prepared-cache restart.

Evidence: `clocksource-and-final-log.json`, `clocksource-host-observation.json`,
and the visually inspected workspace screenshot. The `/sys/.../clocksource`
files were unavailable in this guest's current mount layout, so the observation
is based on explicit kernel messages rather than a successful sysfs read.

HPET reads can add emulated MMIO overhead, making this a concrete hypothesis for
long-run timing/initialization degradation. It is **not yet a measured cause**:
warm HMR still worked after the switch and host contention changed concurrently.
Do not mix pre/post-switch guest durations or simply disable watchdog validation
and call the resulting numbers an optimization. A fresh isolated boot-argument
comparison should record clocksource, monotonicity/drift against host time,
identical warm-up and sample order before choosing a timekeeping configuration.

## Final comparison outcome and next actions

The post-restart reload also exceeded the profiler's 90 s visibility bound. A
later recovery probe hit another execution-context failure; the new independent
recovery path reported **`emergencyRestoration.verified=true`**. Therefore there
is **no completed five-edit post-restart batch and no before/after HMR speedup
claim**. Failed reports remain in evidence. The successful pre-restart batches
provide more than five warm edits plus restoration, with the last five fully
serial-instrumented.

Recommended next work, in order:

1. **Stabilize and observe timekeeping before another performance comparison.**
   Record host load/swap and clocksource throughout a fresh isolated VM. Compare
   a narrowly scoped TSC reliability/clocksource configuration only with
   monotonicity and host-drift checks; do not turn a watchdog bypass into a
   correctness assumption. This is an evidence-driven QEMU configuration probe,
   not a proposed emulator/JIT rewrite.
2. **Keep the guest Vite process alive and warm the actual source graph before
   declaring the workspace ready.** Include `/src/main.tsx`, its imports and the
   React Refresh/client path. Vite's process-local transformed-module cache is
   materially different from `.vite/deps`; the accepted prepared cache still
   left a 322 s first-source transform. Profile plugin/Babel/esbuild phases next
   while preserving real Fast Refresh; avoid full TypeScript checking in the
   HMR-critical path. The historical 514 s TypeScript run was traced, not an
   uninstrumented throughput benchmark.
3. **Prebake dependency optimization as a separate cold-path improvement.**
   Build the exact locked fixture at the final `/workspace` path with the same
   Vite/config/environment, prepare `.vite/deps`, and validate `Hash is consistent.
   Skipping.` in a fresh image. This spike proves archive deployment is accepted;
   it does not prove a clean end-to-end latency reduction. Installing npm deps
   again is not the opportunity: they were already in the image.
4. **Instrument OpenCode's pre-render startup rather than starting with FTL.**
   Keep public-model catalog/update fetch disabled for an explicitly offline
   startup probe and split CLI import/bootstrap, server startup, location-service
   initialization and renderer creation. Database migration was only ~15 s of
   the first attempt; it is not sufficient to explain many minutes before any
   frame. Persistent guest server reuse is worth testing after the first-frame
   gate passes. This spike has no real-model or OpenCode tool-operation pass.
5. **Deprioritize gzip and serial bandwidth for small HMR edits.** The measured
   source response is ~2.7 KB; guest fetch/body spans dominate gzip. Compression
   remains relevant for large reload dependencies, already addressed separately
   by the existing immutable-response cache. Disabling all JIT or undertaking an
   expensive FTL fix is not supported by this evidence.

### Retained state and checks

- Static diagnostic workspace remains at `http://127.0.0.1:5198/`, Browser Control
  `gentle-otter-329`. The guest VM, interactive shell, bridge, logs, original cache
  backup and prepared-cache archive remain inspectable. **Owned Vite PID 1437 was
  stopped after measurement to release guest workload CPU; this is not a live
  working-preview handoff.** Restart Vite explicitly through `exec.ts` to continue.
- Final fixture SHA-256 matches the original and the checked-in fixture:
  `5ff542b3c7f646327c44ba6536f74f8b750b65602bdead19d5c9362f297e0a32`.
  The prepared metadata SHA-256 also remains identical. See `final-cleanup.json`.
- Browser screenshot `qemu-perf/evidence/final-workspace.png` was visually
  inspected. It shows the real diagnostic shell, verified JSC options and
  clocksource transition, with a blank failed preview; it is not TUI-render proof.
- Own Bun scripts bundle successfully with `bun build ... --target bun`; guest
  cache script passes `sh -n`; static server emits COOP/COEP/CORP; scoped diff
  whitespace check passes. Live HMR/HTTP runs and verified recovery are the
  meaningful runtime checks. No QEMU/runtime/image build was performed.
- Other agents' files, origins and persistent stores are untouched.
