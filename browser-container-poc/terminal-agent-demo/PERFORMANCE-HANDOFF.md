# Terminal performance handoff — 2026-09-07

## Latest continuation — consumer layout/sized-text scratch (read first)

See **[PERFORMANCE-RESULTS.md](PERFORMANCE-RESULTS.md)** for the measured results,
failed experiments, acceptance evidence, and unresolved qualification. This push
established a large allocation reduction, **not reliable sustained responsiveness**.

- Final adapter now sizes text scratch to actual UTF-8 byte size and reuses the
  six-float Yoga layout output. Package output guards require both markers.
  Real guest regression passes text semantics, changed native layout, independent
  returned copies/objects and 128 repeated reads without pin/byte growth.
- 8-key owned pin allocation bytes fell 8,480,968 → 5,975; bytes visited per sync
  direction fell ~50.7 GB → ~0.35 GB. First valid short run: 122/130 ms median/p95.
  Later fresh repeat: **571/611 ms**, so do not advertise a stable 4× speedup.
  Complete 96-key paced sample: 312/1167 ms; later repeat exceeded the 3s key
  deadline after 78 completed frames. Small pins still accumulate.
- Generic runtime view-cache experiments were tested and removed for lack of
  reliable improvement. `patches/0001-sqlite.patch` and upstream checkout match
  de45400 again. Runtime and demo snapshots rebuilt after removing experiments.
- Final unpaced test delivered/erased 96 letters, 32-letter batches visible in
  1619/1819/2866 ms including driver overhead. Coalesced frames are NOT per-key
  latency. Separate settled 15s idle: pins 4420, bytes 70,664, WASM 32,440,320,
  unchanged. Whole-tab memory inspection hit its 20s deadline; not qualified.
- Harness now rejects unexpected trusted keys (including those before typing),
  missing/unfocused input, missing foreground TUI FFI and profiling-off selection.
  It distinguishes key count from coalesced rendered keys and captures erased
  stage before idle. Raw worker stdin arrays also include terminal replies:
  offset/correlate them before computing key→worker timing.
- Acceptance PASS two reloads, actual launcher, Ctrl+C recovery, shell restart,
  first shell Enter, live Vite fixture, actual diagnostics-download Blob payload,
  viewport and 75 hash entries. Both final-ready and final-enter screenshots read.
- One settled TUI Enter submitted and reached provider; provider returned HTTP
  429. Escape sent during retries. Host :5217 subsequently stopped (cause unknown),
  producing HTTP transport failure. Restarted only host; no workspace clearing.
  Early-Enter focus/readiness race and successful model reply still need checking.
- Live host: `PORT=5217 bun serve.ts`, background shell
  **sh_07ca96d8b001q4zsZkWsfjdLps**, URL http://127.0.0.1:5217/.
  Browser session **rapid-raven-074**, fresh real TUI at empty prompt, Muse Spark.
  Current guest PIDs: 44 service wrapper, 45 service CLI, 46 bun dev, 48 Vite sh,
  49 Vite, **53 interactive shell → 61 launcher → 62 wrapper → 63 TUI**.
  Last TUI pins 1867 / bytes 31,407 / WASM 32,243,712, profiling off.
  Reinspect identities before every resumed measurement.
- User granted an exclusive measurement interval during this push. Coordinate a
  new interval on resumption rather than assuming that permission stays exclusive.
- Browser Control `summary` snapshot ref mislabels it as button; ref click hangs.
  Use inspected `page.locator('summary')`. Recorded in browser-control-todo.md.
- Full verification and experiment logs are in `../vivari/.runtime/perf-*.log`;
  detailed receipts/screens under ignored `evidence/`. No subagents were used.

Next push: remaining small consumer allocations + matched-scheduling latency
qualification, total memory, message correlation, early-Enter readiness and
successful model-response acceptance. The outer “Launching…” label is stale after
TUI renders and must not be treated as a readiness signal.

---

## NEW continuation checkpoint — 2026-09-07 afternoon (read first)

User requested handoff soon due to context size. Task is NOT complete. Changes
below are committed with this checkpoint; original historical handoff follows.

### Current state

- Host restarted as `PORT=5217 bun serve.ts`, background shell ID
  `sh_07c4fa3d0001ZHglFtAFIEr4sF`. URL http://127.0.0.1:5217/.
- Browser Control CLI v0.7.0 is connected; session `rapid-raven-074` currently
  shows actual OpenCode TUI at empty prompt, Muse Spark 1.3 Free.
- During interruption host stopped and session became about:blank. Original
  :5217 tab remained responsive and retained OPFS lock. Replacement failed boot.
  Adopt/reload recovery restored original persisted 635-entry workspace. See
  browser-control-todo.md for odd page-replacement warning. No storage cleared.
- Current process identities after LAST reload: 45 wrapper serve, 46 CLI serve,
  47 bun run dev, **48 interactive sh**, 49 Vite sh wrapper, 50 /bin/opencode2,
  51 Vite, 52 /opencode-v2/run.cjs, **53 actual CLI TUI**. Reinspect individually
  with bounded reads; do not assume PIDs survive reload/relaunch.
- Current TUI FFI (profiling OFF): pins 8992, pinnedBytes 1,250,042,
  wasmBytes 34,734,080. Prompt empty. User may interact with visible tab: coordinate
  an exclusive typing interval before collecting trusted-key latency.

### Valid new measured evidence (ignored evidence/*.json)

- `perf-qualified-shell`: 96 letters; median/p95 key-to-next-rAF **10.86/15.35 ms**.
  output arrival 0.380/0.880 ms; xterm render 4.775/7.325 ms. All complete.
- `perf-short-tui`: fresh original consumer, 8 paced letters then erase.
  key-to-next-rAF median/p95 **517/690 ms**. First 8 letters: 10,472 FFI calls,
  syncIn+syncOut **4056 ms**, native **18.975 ms**, ~50.72 GB visited EACH direction.
  pin bytes 78,880 → 8,560,130 → 16,962,092 after erase. WASM 32.37 → 66.26 MB.
  No idle FFI activity/growth. No main-thread long tasks; 10 proc-out messages,
  1013 chars; xterm parse max .095 ms. Dominant CPU cost is synchronization.
- `perf-aged-tui`: same process next 8 letters; next-rAF **1364/1601 ms**.
  pins 16.96 → 33.85 MB through typing+erase; idle stable. Copies dominate again.
- `perf-baseline-final-tui`: fresh original TUI, updated BEFORE-dispatch input
  probe, 8 keys, next-rAF **479.765/670.515 ms**. pin bytes 72,900 → 8,554,150 →
  16,956,112. Typing sync 3957 ms vs native 18.635 ms. Best fresh baseline for
  comparison with the final harness. Worker stage breakdown not yet summarized.
- Do NOT compare worker arrival timestamps from `short`/`aged`: listener was
  registered AFTER runtime onmessage, so it could include synchronous work.
  `baseline-final` wraps onmessage BEFORE dispatch and corrects that attribution.
- `after-short` is an incomplete run with OLD package (adapter initially missed
  node chunk). `fixed-short` has adapter but wrong PID selection and unexpected
  extra trusted events (7 measured letters for 8 requested). Not qualified for
  comparison. It reports ~2.4s keys, so speed improvement is NOT established.
  Need investigate current CPU/copy cost with correct TUI PID and controlled input.
- No model request in any performance sample. Historical 3.3s model response is
  separate. No valid sustained/unpaced baseline yet; original budget approaches
  64MiB quickly, so use short bounded samples rather than crash deliberately.

### Implemented changes

1. `profile.js`: bounded 2.5s per-worker evaluation, incremental receipt before
   each operation/key and each completed main/worker stage, try/finally cleanup,
   180s auto-dispose backstop, bounded arrays; explicit `state.profilePids` selects
   foreground chain for instrumentation. Config profileBatches, profileKeys,
   profileIdleMs, profilePaced. Unique labels avoid overwriting evidence. It wraps
   worker onmessage before dispatch and samples guest 50ms timer drift.
   Failure now snapshots main counters; this latest small change not rerun yet.
   Still needs: assert expected foreground roles/FFI presence, reject unexpected
   trusted input, stronger per-key receipts, unpaced throughput interpretation.
   Unpaced render samples coalesce and must NOT be called per-key latency.
2. `../vivari/scripts/opentui-text-scratch.ts`: exact audited OpenTUI 0.4.5
   editBufferGetText method transform. Reuses high-water scratch (geometric growth),
   returns original owned slice/null. Native wasm-lib.zig editBufferGetText only
   synchronously copies into outPtr; no retention or callbacks. No generic FFI
   lifetime/budget change; other small transient ptr allocations still grow.
3. `package-opencode-tui.ts` applies adapter BEFORE Solid onLoad plugin, to BOTH
   chunk-node and chunk-bun (target node imports chunk-node!). Realpath guard and
   exact-method drift validation; final CLI build MUST contain vivariTextScratch.
   Receipt records adapterSha256. Original first build silently missed adapter;
   now output guard rejects that failure. Latest package and snapshot DO include it.
4. Real regression: build-text-scratch-probe.ts emits exact original/transformed
   methods; probes/runtime/text-scratch.cjs executes both against actual renderer
   in guest worker. UTF-8/zero/truncation/growth/multiple handles/copy independence,
   **128 repeated 1MiB reads add zero pins/bytes**. ffi-headless --text-scratch runs it.
5. Runtime optional BootOptions.onLog subscribes before boot; used by main.ts.
   Preserves logs and exposes concrete startup OPFS failure. This is stored in
   regenerated patches/0001-sqlite.patch plus upstream docs. No FFI runtime change
   beyond previously committed counters. Download screen uses viewportY and preview
   text bounded to 1M chars. Diagnostics still expandable, no DOM batching change.

### Verification completed this continuation

- `bun scripts/build-text-scratch-probe.ts` then real Node 24.13.0
  `scripts/ffi-headless.mjs --text-scratch`: PASS full FFI/loopback/streams/VM/
  warnings/inherited-input + TEXT_SCRATCH_PASS, pins 30 / bytes 1,094,794 after
  regression setup, no growth for repeated reads.
- `bun scripts/build-runtime.ts patched`: PASS `.runtime/perf-repair-build.log`.
- Full upstream `scripts/verify-node.mjs`: PASS after resumption, exit 0;
  `.runtime/perf-repair-verify.log` (first attempted call interrupted before start).
- `bun scripts/package-opencode-tui.ts --v2`: PASS latest; log
  `.runtime/perf-repair-package.log`. Earlier rejected builds logged same path.
- `bun build.ts`: PASS latest snapshot with enforced adapter. Reload + actual TUI
  launch successful; early log capture also visibly confirmed failure and restore.
- Final acceptance still pending: corrected short before/after, sustained/idle,
  shell/CLI input, first Enter focus/readiness, Ctrl+C and service/preview health,
  screenshot viewed (not just saved), diagnostics download payload, hashes.
- `accept.js` still hardcodes :5216; parameterize for :5217 and use viewportY.
- README still warns old FFI limitation; update only after performance qualification.

### Next actions

1. Inspect browser/session/host; preserve attached tabs/workspace. No subagents.
2. Select CURRENT shell→launcher→wrapper→TUI PIDs (last 48,50,52,53) and run short
   new label with idle prompt and exclusive typing. Confirm FFI profiling truly on
   in TUI. Save screenshot/read it. Investigate slow fixed-short result honestly.
3. If remaining copies dominate, audit consumer's other scratch allocations or
   avoid synchronizing the 1MiB high-water buffer by sizing read output to actual
   byte size via existing native editBufferGetTextBuffer/textBufferGetByteSize,
   with real regression. Do not alter retained-pointer semantics or raise budget.
4. Establish unpaced throughput, idle pin/WASM stability and total-memory limits;
   separate inspector deadlines, timer drift, bridge latency, native CPU and xterm.
5. Complete acceptance, summarize measured evidence/limitations in tracked results,
   commit only task files. Earlier full handoff below is historical.

---

## Resume goal

Complete the user's measurement-driven diagnosis/fix of the Vivari OpenCode
terminal. Work in this directory and relevant `../vivari` code. Read root/ancestor
AGENTS.md and load browser-control + OpenCode skills. No subagents authorized.
Use Browser Control only through the Bun-backed CLI. Preserve workspace files,
scope commits to your own paths, and commit changes.

**This is a checkpoint, not a completed performance fix.** The user requested a
handoff/compaction before further work. No budget increase or lifetime change was
made. No TUI latency/memory baseline or dominant-cost conclusion is available yet.

Original requirements still pending: compare shell/OpenCode; key → guest stdin →
FFI/layout/render → xterm paint; sustained typing and idle memory; worker scheduling,
bridge volume, synchronous FFI, throughput, diagnostics DOM cost; separate model
duration from keyboard latency; evidence-supported fixes and visible before/after
verification including reload, shell/CLI input, Ctrl+C, service + preview health.

## Current hosts and browser blocker

- Original host :5216 was already running (`bun serve.ts`, PID 6711 when checked).
- User **explicitly approved using an isolated origin** after a filesystem lock
  conflict prevented :5216 startup. Started `PORT=5217 bun serve.ts` here; PID 23185
  was listening at checkpoint. URL: **http://127.0.0.1:5217/**.
- :5217 successfully self-installed, opened the shell, served the fixture preview,
  and launched the actual Muse Spark OpenCode TUI before the automation stall.
- Browser Control session remains `rapid-raven-074`, but its owned page was reset
  during driver recovery. It must be reopened. Do not assume a currently visible
  healthy demo. `bunx browser-control execute --session rapid-raven-074 ...`.
- TUI `profile.js` execution stalled; outer shell timeout was 240s. Subsequent
  simple execute stalled too. Resetting **only this session** succeeded, but new
  executions failed `connectOverCDP: Timeout 15000ms exceeded` after WS connect.
- User **explicitly authorized a Browser Control relay restart**, after being told
  the other connected session was `tidy-walrus-391` (:5220). Restart succeeded.
  The next two executes failed `Browser Control extension is not connected`.
  Need extension reconnection (possibly user toolbar/reload extension action).
  Do not start an MCP server or restart unrelated tabs/agents.
- CLI/relay version 0.7.0, build `2026-09-05T19:03:42.828Z`; extension 0.0.24,
  protocol 2. Doctor before restart confirmed compatible versions. Eight other
  preexisting crashed user targets were observed and left alone.
- Incidents are recorded in `browser-control-todo.md`.

## Proven startup issue, separate from keyboard latency

The initial :5216 page was already failed at “Starting OpenCode service”. A fresh
reload reproduced it. Actual guest log
`/home/user/vivari-v2/data/opencode/log/opencode-local.log` reported:

```
background service boot failed
SQLITE_CANTOPEN: durable persistence unavailable
```

Early kernel logs (captured with a temporary page-init Worker message listener)
showed **`OPFS already owned by another Vivari kernel`**. `navigator.locks.query()`
showed the exclusive `vivari-vfs-owner` lock remaining across reloads. A duplicate
attached :5216 tab was crashed; evaluating/navigating it failed. Closing only that
crashed duplicate succeeded but did not release the lock. No OPFS/files/database
were reset, stolen, deleted, or overwritten to recover. User chose fresh :5217.

**Concrete diagnostics gap:** `main.ts` subscribes to `vm.bridge.on('log', ...)`
only *after* `await Vivari.boot()`. It misses the startup persistence failure.
The downloaded original report therefore contained only the later generic service
timeout. Consider an optional `BootOptions.onLog` hook subscribed before boot,
then use it in this demo. Nothing implementing that has been changed yet.
Keep expandable kernel/startup/service/Vite logs and bounded downloadable reports.

## Valid measured baseline: plain shell

Saved ignored files:

- `evidence/perf-baseline-shell.json` — full timestamp/count stages.
- `evidence/perf-baseline-shell-summary.json` — quantiles.
- `evidence/perf-initial.json` — failed :5216 diagnostics before first reload.

Baseline URL :5217, existing runtime snapshot, visible foreground Chromium page.
Three batches of 32 synthetic letters, each paced until expected text appeared;
32 Backspaces between batches. Five seconds idle before/after; 1.5s after each
Backspace batch. No model request. 96 measured letter keys, 192 total input events.
Main-thread timestamps use performance.timeOrigin + performance.now.

| Keydown to stage | Median ms | p95 ms | Max ms |
|---|---:|---:|---:|
| xterm onData | 0.090 | 0.185 | 1.030 |
| terminal output arrival | 0.415 | 0.850 | 2.465 |
| xterm onRender, expected text present | 4.675 | 7.115 | 9.375 |
| following animation frame | 12.265 | 14.580 | 15.430 |

The final frame timestamp is a **paint-opportunity proxy**, not a physical-display
measurement. No CPU trace or screenshot-based paint analysis was completed.

- 192 `proc-out` bridge messages, 3,888 output characters (shell Backspace redraws
  account for most), 119 xterm render callbacks.
- No main-thread long tasks in the sample.
- Output write → xterm parse callback: median 0.080 ms, p95 0.195 ms, max 7.820 ms.
- Shell worker PID 52: 192 stdin arrivals/deliveries; message-handler → Readable
  data-event p95 0.170 ms. Other service/Vite workers saw no input.
- Main JS heap 17,608,515 → 19,387,661 bytes without forced GC; this is not worker
  memory and is not evidence of a leak. Idle initial window had no terminal output.
- No diagnostic log traffic in this typing run; it cannot justify batching DOM
  logs as the dominant keyboard fix.

The later TUI run produced **no receipt**. Do not cite its automation timeout as
keyboard latency, nor assume all 96 TUI keys were delivered. The exact blocked
stage wasn't saved. Harden/checkpoint the harness before retrying it wholesale.

## Changes at this checkpoint

### Runtime: measurement only

Tracked source of truth is `../vivari/patches/0001-sqlite.patch`, regenerated from
the pinned `.runtime/patched` checkout. Its new changes affect:

- `packages/runtime/builtins/ffi.js`:
  - `require('bun:ffi').vivariProfile(true)` enables and resets aggregate counters.
  - `vivariStats()` returns current pins/pinnedBytes/WASM capacity, synchronization
    bytes/time, allocations and per-symbol calls/total/native milliseconds.
  - `vivariProfile(false)` disables and resets counters, without releasing pins.
  - Profiling defaults off. No argument/buffer/prompt contents are recorded.
  - Timings are inclusive across callbacks/reentrant calls; sync byte counts mean
    bytes visited, not hardware bandwidth. Allocation counters count new owned
    pins, not borrowed-mirror creation. No GC or deallocation policy was changed.
- Matching upstream checkout AGENTS/ARCHITECTURE/roadmap documentation in patch.
- `../vivari/probes/runtime/ffi-contract.cjs` now exercises the existing
  alias/growth/retained-pointer/callback contract with profiling enabled, verifies
  counters/reset preserve pointers, then continues uninstrumented Node FFI checks.

Rebuild commands already succeeded:

```
# from ../vivari
bun scripts/build-runtime.ts patched
# from this directory
bun build.ts
```

The ignored `.snapshot` now contains the **instrumented runtime**, with the same
unmodified matched OpenCode package. The old uninstrumented shell baseline was
captured before this snapshot change. Source build retains older hashed assets
for live kernels; do not delete dist or snapshots belonging to other projects.

### Browser profile harness

New `profile.js` is a Browser Control execute file. Uses `state.profileLabel`
(default `baseline`) and `state.profileMode` (`shell`/`tui`), accepts :5216/:5217.
Instruments trusted keydown, xterm onData/write/onRender, following rAF, main long
tasks, bridge event counts and worker stdin message/data delivery; samples FFI via
`process.getBuiltinModule('bun:ffi')`. No model requests are sent.

It completed for shell, but is **not TUI-qualified**. Before resuming:

1. Add bounded per-worker evaluate deadlines / incremental evidence writes and
   a try/finally cleanup. Currently all worker evaluations are serial and can
   block without a local timeout, and evidence writes only happen at the end.
2. First test each worker identity/counter read individually and keep samples
   short. Could be worker inspection or driver/session routing, not TUI load.
3. Avoid attaching probe stdin listeners to unrelated guest jobs if possible;
   current code instruments every process worker, although no data is stored.
4. `page.workers().evaluate` worked in earlier short calls. Raw CDP
   Target.attachToTarget + Target.sendMessageToTarget failed `No session with
   given id` through the CLI. Main-page `context.newCDPSession(page)` did work.

## Relevant source findings to investigate after measurement

In the FFI facade, **every symbol boundary copies every retained pin** in/out.
Thus transient retention can increase both memory and per-call CPU even before
the 64 MiB budget is reached. This is source analysis, not a measured ranking yet.

The pinned OpenTUI 0.4.5 method is in:

```
../vivari/.runtime/opencode-v2-source/node_modules/.bun/
  @opentui+core@0.4.5+2240c214a0f33214/node_modules/@opentui/core/
  chunk-bun-t2myhmwd.js
```

Around line 14775:

```js
editBufferGetText(buffer, maxLength) {
  const outBuffer = new Uint8Array(maxLength);
  const actualLen = this.opentui.symbols.editBufferGetText(buffer, ptrOrNull(outBuffer), maxLength);
  if (actualLen === 0) return null;
  return outBuffer.slice(0, actualLen);
}
```

It returns a copy, so audited reusable scratch storage at the **consumer adapter**
may be a low-risk targeted remedy if counters support it. Do not edit node_modules
or bundle output as the durable fix. `../vivari/scripts/package-opencode-tui.ts`
builds pinned source via Bun plugins and lowering; add a narrowly validated
build-time adapter there (or appropriate existing patch) and record package hashes.
Other ptr allocations (encoded characters, ranges, colors) may also accumulate;
qualify actual growth rather than declaring the whole lifetime problem solved.
The substrate must remain consumer-agnostic and preserve retained raw pointers.
Do not raise the budget or free buffers merely because a JS owner looks dead.

## Checks completed

- Runtime source build passed; `.runtime/perf-build.log`.
- Full upstream `verify-node.mjs` **PASS**, `.runtime/perf-verify-node.log`.
- FFI worker suite **PASS**, including new profiling-on contract plus loopback
  fetch, stream consumers, VM imports, warnings and inherited stdin;
  `.runtime/perf-ffi-node-test.log`.
- `bun build.ts` passed in demo; `git diff --check` passed at checkpoint.
- No browser acceptance after instrumented rebuild yet.

**Environment gotcha:** `node` in this agent shell resolves to a Bun shim under
`/private/tmp/bun-node-.../node`. That produced an irrelevant host Bun.hash mismatch
in the first headless attempt (`.runtime/perf-ffi-test.log`). Downloaded real
Node 24.13.0 and reran successfully with:

```
/private/var/folders/t_/x48jtnps7n5_0g_pt9xpvbg00000gn/T/opencode/node-v24.13.0-darwin-arm64/bin/node
```

## Prior evidence and final acceptance cautions

Read README.md, main.ts, build.ts, serve.ts, accept.js, ignored shell-v2/model-v2
evidence, and `../doc/vivari-v2-results.md`. Existing `accept.js` hardcodes :5216;
parameterize for the user-approved :5217 origin before using it.

Original commit 9572d2f self-installs matched CLI/deps/service 4106/Vite 5173 after
boot; plain `/workspace` shell, `opencode2` launches Muse Spark 1.3 Free. Preserve
that behavior and workspace files. Service/preview health must be reverified.

Earlier real response was `SHELL_DEMO_MODEL_OK`, 3.3s reported by TUI. The prior
90s exact-whole-row assertion was wrong because sidebar text shared the response
row; never cite it as UI latency. First Enter not submitting may be readiness or
focus; not isolated. Match content/columns and record focus/readiness timestamps.
Downloadable screen currently reads buffer lines from index zero rather than
viewportY; inspect/fix if testing scrolled normal-buffer reports.
