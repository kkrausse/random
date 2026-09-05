# Browser workspace: assessment and decision matrix

2026-09-05. Decision support, not a benchmark report. Reviewed `plan.md` and the primary sources below; this directory
contains a research plan, not an implementation. No candidate has passed our fixture or received measured timings.

## Recommendation

**Keep QEMU-Wasm as the lead feasibility experiment, not the selected product architecture.** Its strongest argument is
preserving a real Linux execution environment, not demonstrated browser usability. Spend a small, bounded experiment
budget resolving compatibility, local editing latency, and the preview transport before investing in a custom VM shell.

I would change the proposed experiment order in two ways:

1. **Use container2wasm's QEMU/Emscripten output if it gets us to the workload faster.** `--to-js` already uses
   QEMU-Wasm with JIT. Direct QEMU and container2wasm/QEMU are integration choices within one runtime strategy, not
   independent bets. We can own a thin browser adapter without immediately owning the image builder and boot plumbing.
   Move to direct integration when a measured limitation justifies it, not as a prerequisite for learning.
2. **Measure a deterministic edit/build loop before waiting for the full model loop.** Booting Linux and printing a
   version are weak evidence. Start the actual harness, exercise tools, and measure Vite watching and transformation
   inside the guest; then prove the HTTP/WebSocket bridge and real-prompt-to-HMR loop. Intermediate scripted probes
   are diagnostics only, never a substitute for the final contract.

Give Vivari a short real-OpenCode SDK compatibility probe. Do not build a second editor or embark on a broad shim fork.
Do not expand the vendor survey without a concrete blocker. The highest-value additional research is executable
evidence, not more repository names.

## What problem are we choosing to solve?

The existing plan combines three desires that strongly constrain the answer:

- **Execution location:** harness, workspace, and dev server all execute inside the browser.
- **Behavioral fidelity:** real OpenCode and useful file/search/process tools; ideally normal Linux programs.
- **Ownership:** runtime source is inspectable, modifiable, reproducibly buildable, and self-hostable.

These are reasonable, but they are not consequences of “a good browser coding workspace.” They are product choices.
If all remain fixed, machine emulation is a rational lead. If responsiveness on modest devices matters more than stock
Linux compatibility, a browser-native runtime becomes more attractive. If browser-local compute is negotiable, a remote
Linux sandbox is an important control and potentially the simpler product. None of these relaxations is assumed here.

There is also an ambiguity in the existing contract: it requires a stock CLI/server, but allows an embedded SDK host for
Vivari. Treat these as explicit subtracks: **stock distribution** versus **real embedded host with unchanged tool
semantics**. Both must still demonstrate the whole loop; report which passed instead of calling SDK compatibility
stock-binary compatibility.

## Descriptive decision matrix

The [decision matrix](decision-matrix.md) has criteria down the left and approaches across the top. Its cells describe
how each approach handles each criterion, without scores, rankings, colors, or value judgments. Unknowns are explicit.
The recommendations in this assessment are separate from that factual comparison; evaluation/coloring is a later step.

## QEMU: what could invalidate the lead?

1. **CPU cost is intrinsic, not just an optimization backlog.** Guest Bun/Node executes through an emulated ISA. Guest
   JS JIT compilation can generate more guest machine code that QEMU must translate. Upstream describes interpreting
   cold translation blocks and compiling hot ones to WASM modules. Warm loops and short-lived command startups may
   behave very differently. Measure both; do not infer native QEMU performance or assume “WASM = near native.”
2. **Memory could be disqualifying on ordinary devices.** The QEMU README's example build uses
   `-sTOTAL_MEMORY=2300MB`. This is a build setting, not a measured minimum or physical-memory footprint, but it is a
   reason to investigate early. Account for guest RAM, emulator memory, files/images, network workers, UI, and preview.
   An x64 guest does not imply unlimited memory in the browser host.
3. **Linux networking does not give the browser guest localhost access.** A browser-only HTTP path and bidirectional
   WebSocket path need explicit adapters. Service workers do not intercept WebSocket upgrades. A preview-side
   WebSocket shim/message tunnel is one possible design; it must connect to real guest Vite HMR, not synthesize reloads.
   A host-side port-forwarding daemon would violate the strict browser-only infrastructure demonstration proposed here.
4. **Upstream QEMU maturity is not browser-backend maturity.** The fork calls itself experimental. Its README reports
   JIT and multithread support, but describes upstreaming separately. Pin the fork/backend and test the deployed headers,
   workers, CSP, browser, and architecture. Do not count inherited QEMU history as browser-port maintenance capacity.
5. **Stock binary support is still a hypothesis.** Pin the exact OpenCode and Bun artifacts, libc and guest CPU model.
   Verify actual startup, file search, subprocesses, streaming, cancellation, and writes under concurrent Vite activity.
   If an instruction-set blocker appears, check supported baseline artifacts before changing the entire runtime.

QEMU's reward is substantial if these pass: a portable Linux environment recipe and fewer application-specific runtime
exceptions. It is worth testing precisely because that could simplify the application layer, even though the lower stack
is complex. It is not worth months of emulator development just to make a two-file UI editor feel responsive.

## Bounded research plan: buy information before architecture

Suggested budget: **3–5 engineer-days**, not a delivery promise. Stop and report blockers when the budget expires. Run
the probes sequentially if one person is doing them; this is not a request to start parallel implementation now.

| Probe | Budget | Deliverable / question answered | Stop or switch rule |
| --- | --- | --- | --- |
| Pin fixture and harness; native control | Half day | Versions, image recipe, tool smoke test and native Vite edit timings | A broken fixture is not evidence against a browser runtime |
| QEMU workload, using existing packaging first | 1 day | Reproducible browser boot; real harness/tool smoke tests; Vite starts; guest write→transform timings; cold/warm time and memory | No real workload startup: isolate one concrete blocker; do not build editor UI |
| Preview transport and final loop | 1–2 days | HTTP assets, WS connect/messages/reconnect, JS and CSS HMR, real prompt causing multi-file edit | If only a host networking daemon makes it work, mark browser-only transport unresolved; do not call it a pass |
| Vivari real-host compatibility probe | Half–1 day | Pin `@opencode-ai/sdk`; create real host/session; prompt; read/search/edit/process tests; missing-API log | Stop if a native dependency or tool-semantic gap requires a broad compatibility fork |
| Decision write-up | Within budget | Two result cards, explicit failed gates, measured latencies and updated matrix facts | If neither qualifies, choose which product constraint to revisit before more implementations |

The V2 SDK documentation confirms that `@opencode-ai/sdk` hosts the actual server in-process; it is not merely the
network client. It is beta and **does not document browser compatibility**. That makes the Vivari probe legitimate,
but not likely-to-work evidence. Audit the pinned dependency graph and runtime APIs instead of assuming TypeScript
source or successful imports imply host/tool compatibility.

Use the plan's proposed warm-open ≤10 s, cold-open ≤60 s, and small-edit ≤2 s as **provisional decision thresholds**,
to be agreed before the trial. Name the target laptop/browser and network/cache state. Record five edits individually
and report median and worst; do not imply statistically meaningful tail percentiles from five samples. Separate model
latency, tool latency, guest transform time, transport time, and visible browser update. Add a project-defined memory
budget before judging product suitability; do not silently use the fastest developer machine as the target audience.

If QEMU misses a target, allow one bounded, hypothesis-driven improvement (for example image trimming for download
time, not as a supposed fix for CPU latency). A result still multiple times outside the agreed budget is a reason to
reconsider scope, not an automatic invitation to write an emulator backend. Persistence can wait until the first HMR
slice, but source recovery must pass before claiming a usable workspace.

## What would change the decision?

- **QEMU passes fidelity, browser-only transport, and usability:** keep it; choose direct versus generated integration
  based on measured control/debugging needs. Broaden the fixture before calling it a general-purpose platform.
- **QEMU is usable but generated integration is restrictive:** move to direct QEMU. This is a packaging decision, not a
  new performance strategy.
- **QEMU is too slow and Vivari preserves the real host/tools:** prefer Vivari for the supported JS project surface;
  document that normal Linux binaries are no longer a guarantee.
- **QEMU is too slow and Vivari needs extensive harness/tool replacement:** the current conjunction of requirements may
  be impractical within our budget. Prefer an explicit choice between remote Linux and a narrower custom browser agent,
  rather than quietly shipping a different POC.
- **Runtime modifiability becomes negotiable:** benchmark WebContainers for Node workflow UX and investigate commercial
  emulation options separately. Neither licensing flexibility nor a Linux demo proves the chosen OpenCode binary runs.
- **Mobile/low-memory use becomes central:** raise cold-start and RAM importance; expect machine emulation to face a
  much harder acceptance bar. No candidate here has earned a cross-browser/mobile claim.

**Bottom line:** the lead is defensible under the present constraints. The premature choice is insisting on direct QEMU
integration before proving the workload. Run a small falsification spike, keep a narrow browser-native challenger, and
let measured usability—not an attractive boot demo or an invented aggregate score—decide the next investment.

## Evidence and limitations

Primary sources re-read for this assessment on 2026-09-05 (moving pages, not pinned test inputs):

- [QEMU-Wasm README](https://github.com/ktock/qemu-wasm): experimental status, guest architectures, build-memory setting,
  hot-block WASM JIT/interpreter mechanism, multithreading, and separately reported upstreaming status.
- [container2wasm README](https://github.com/container2wasm/container2wasm): `--to-js` selects QEMU/Emscripten;
  browser Fetch versus external WebSocket networking; component licenses; WASI-only preboot optimization as documented.
- [Vivari architecture](https://github.com/maitrungduc1410/vivari/blob/master/ARCHITECTURE.md): worker/runtime topology,
  shared-memory/header requirements, virtual process/filesystem model, service-worker HTTP and preview WS shim.
- [OpenCode V2 SDK](https://opencode.ai/v2/docs/build/sdk): real in-process host, distinction from network client,
  beta status; no established browser support claim.
- [Existing candidate research](plan.md): other candidates' architecture/license findings and source links. These were
  used as prior research, not independently verified across every repository in this assessment.

No runtime was installed, built, or benchmarked for this document. Workload compatibility remains untested; save exact revisions,
licenses, build commands, logs, and result cards when trials begin. No production architecture decision is recorded here.
