# Terminal performance handoff — 2026-09-07

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
