# Terminal performance continuation — 2026-09-07

## Result

**Retained allocation reduction is established. Reliable low-latency sustained
typing is not.** A valid fresh 8-key run reached 122 ms median, but a later fresh
run of the same final implementation measured 571 ms. Do not present the best
run as a reproducible 4× speedup. The later sustained run crossed the 3-second
per-key harness deadline after 78 completed letter frames.

All raw receipts remain under ignored `evidence/`; labels below name
`perf-<label>.json` and its `-summary.json` sibling. No model request ran during
typing measurements. Key-to-next-rAF is a paint-opportunity proxy, not physical
display latency. Host load, browser scheduling and instrumentation variability
were not controlled well enough to explain the cross-run timing difference.

## Shipped changes

- Text read scratch grows geometrically using **actual UTF-8 byte size**, capped
  by the requested maximum, rather than immediately allocating the 1 MiB cap.
  It still returns an independent slice or null, preserving truncation behavior.
- Yoga computed-layout reads reuse six floats, returning a fresh scalar object.
  The published 0.4.5 implementation allocated a new pinned buffer on every read:
  one measured key called this method **450 times**.
- Exact-method drift guards apply both adapters to the node and Bun chunks;
  package output must contain both scratch markers. The receipt hashes the adapter.
- Real guest/native regression checks empty/UTF-8/truncated/growing text, separate
  edit handles and returned-copy independence; 128 repeated reads add no pins or
  bytes. Layout regression checks actual 120×40 then 80×20 Yoga layout, retained
  return-object independence and 128 reads without pin/byte growth.
- Harness rejects unexpected trusted input, missing/unfocused input, stale worker
  selection without a foreground CLI FFI instance, and disabled TUI profiling.
  Unpaced batch completion is explicitly separate from per-key latency. It also
  captures an erased stage before the final idle window.
- Acceptance works on :5216 and :5217 and reads the visible viewport.

The runtime FFI implementation, retained-pointer semantics and 64 MiB budget are
unchanged from de45400. Two per-pin WASM-view caching experiments passed semantic
tests but did not establish sustained improvement; both were removed. `cached-*`
and `exclusive-inline-sustained` are experimental, not shipped-result evidence.

## Measurements

| Receipt | Letters | Median / p95 next-rAF | Result |
|---|---:|---:|---|
| `baseline-final-tui` (prior continuation) | 8 | 479.8 / 670.5 ms | Original consumer, complete |
| `sized-layout-short-tui` | 8 | 122.0 / 129.8 ms | Final consumer, complete |
| `sized-layout-sustained-tui` | 96 | 312.1 / 1167.1 ms | Complete, aging remains |
| `final-short-tui` | 8 | 571.5 / 611.0 ms | Final consumer repeat, complete |
| `final-sustained-tui` | 78 completed frames | — | Incomplete; 3s key deadline |
| `final-shell-exclusive-shell` | 96 | 12.19 / 14.38 ms | Complete |

The unchanged text-only scratch build at session start also reproduced seconds
of synchronization per key (`scratch-single-copy.json`: 1309 calls, 3609 ms
sync versus 24.6 ms native). It motivated the layout allocation audit.

For the 8-letter typing stage:

| Counter | Original consumer | Final consumer, first run | Final consumer, repeat |
|---|---:|---:|---:|
| FFI calls | 10,472 | 10,488 | 10,504 |
| New owned pin allocations | 3,880 | 276 | 276 |
| Newly pinned bytes | 8,480,968 | 5,975 | 5,975 |
| Bytes visited **each** sync direction | 50,657,168,338 | 365,033,366 | 348,545,278 |
| Sync-in + sync-out | 3957 ms | 1063 ms | 4440 ms |
| Native time | 18.6 ms | 13.6 ms | 62.6 ms |

The allocation delta drops **99.93%**, and bytes visited drop about **99.3%**.
Remaining cost is per-pin traversal/synchronization across thousands of pins,
not just the size of the large text buffer. Even native and xterm parse timings
changed across runs; the exact cause of timing variability is unresolved.
No main-thread long tasks occurred in these short runs. Xterm parse max was
0.105 ms in the first final-consumer run and 0.265 ms in the repeat.

`final-burst-tui` delivered and erased 96 letters in three unpaced 32-letter
batches. Typing-to-batch-visible completion took **1619 / 1819 / 2866 ms**,
including driver overhead. Renders coalesced: these are not 96 per-key latency
samples. All 192 expected key events were captured. The old summary field `keys`
counted only the three letter keys associated with a frame; the harness now
reports letter-event count and `renderedKeys` separately.

After burst work fully settled, a separate 15-second idle check was stable at
**4420 pins / 70,664 pinned bytes / 32,440,320 WASM bytes**. This is not a claim
of bounded lifetime memory: the complete earlier 96-letter paced run ended at
6996 pins / 135,640 bytes, up from 2266 / 40,168. Library close releases pins.
Whole-tab `measureUserAgentSpecificMemory()` did not finish within its 20-second
inspection deadline; total worker/FS/JS memory qualification remains open.

Worker arrival/delivery arrays include terminal negotiation traffic, not just
keys. In `final-short`, 16 messages arrived during the initial idle window.
Do not index those arrays directly by key number or publish negative latencies:
subtract stage offsets and correlate messages before attributing bridge delay.
Guest 50ms timer drift is saved in each receipt; it is scheduling delay, not
native execution time. Unexpected-key runs were rejected and retained as failures.

## Visible acceptance and Enter

- `accept.js` passed two reloads, real TUI launch with Muse Spark selected, Ctrl+C
  back to shell, shell stop/restart, fixture preview and diagnostic process flags.
- Trusted shell `echo SHELL_ENTER_OK` ran on its first Enter. An initial `printf`
  attempt correctly reported command-not-found (this shell has no printf).
- A settled TUI prompt was submitted with **one Enter**. It eventually appeared
  as a session user message and reached the provider, which returned HTTP 429.
  Escape was sent during retries. The host then proved unavailable; final TUI
  displayed `HTTP transport failed`. No successful model-response acceptance is
  claimed for this continuation. The historical early-Enter/focus race is not
  reproduced or conclusively fixed by this single settled-input check.
- Restarted only the :5217 host without reloading or clearing the live workspace.
  Fresh TUI launch, guest service and fixture preview subsequently remained healthy.
- Actual Download diagnostics button payload was captured and checked: visible
  viewport, 75 hash entries, service/shell/Vite true and expected preview content.
  `final-download.json` holds the payload.
- `final-enter.png` and `final-ready.png` were **opened and visually inspected**.
  Real TUI is readable; the outer status still says “Launching OpenCode…” after
  launch, so that label is not a readiness signal.

## Checks and remaining work

PASS: adapter build, real Node 24.13.0 `ffi-headless.mjs --text-scratch` (full
FFI/loopback/streams/VM/warnings/inherited-input suite), V2 packaging with both
markers, runtime rebuild and demo snapshot build. Full upstream verify-node also
passed for both discarded caching experiments; the final runtime source/patch is
byte-identical to the already verified de45400 runtime.

Next: audit the remaining per-key small allocations (styled-text packs, cursor
and color/struct paths) against native ownership, qualify fresh/aged runs under
matched scheduling conditions, correlate terminal protocol traffic for bridge
stages, establish total memory, reproduce the early-Enter readiness race, and
repeat successful model-response acceptance when provider availability permits.
