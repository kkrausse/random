# Vivari implementation plan

Status: source-build baseline and initial SQLite API probes pass; SQLite
qualification is incomplete. Paused for user-requested handoff; see
[handoff](vivari-handoff.md) for the exact failing ownership regression and fix.
The first OpenCode installation attempt is blocked by a native dependency.
See [result card](vivari-result.md) for the original measurements and
[runtime audit](vivari-runtime-audit.md) for the follow-up evidence.
Implementation directory: `../vivari/`.

Goal: test whether browser-native JS execution delivers a responsive coding
workspace while preserving the real OpenCode host and useful tool semantics.

Vivari runs JS through the browser engine with Node bindings and Bun API shims;
it does not execute our stock Bun/OpenCode Linux binaries. Compatibility and
performance for our workload remain unproven.

## Implementation defaults

- Pin an upstream Vivari revision and record its license, setup commands, and
  local patches. Reuse its runtime, filesystem, terminal, and preview plumbing.
- Use Bun + TypeScript for our integration and keep the UI minimal: terminal,
  preview, and controls needed to exercise the real OpenCode host.
- Copy the existing fixture from `../qemu/guest/fixture/`, preserving package
  versions initially. Record any required substitutions so comparisons stay honest.
- Try the real OpenCode V2 SDK host with pinned dependencies. A network client
  connected to a host outside the browser would not satisfy this experiment.
- Let Vivari own the workspace and use its persistence mechanism.
- Keep compatibility fixes small and traceable; review the scope before taking
  on a major missing subsystem.

## Gate 1: fixture and performance

1. Establish reproducible runtime startup and load the fixture into the VFS.
2. Run the real Vite dev server and display the preview using Vivari's transport.
3. Verify source edits trigger genuine HMR without replacing the preview document.
4. Exercise dependency installation and a representative test command. Add a
   meaningful test fixture if the existing project has no test command.
5. Capture cold start, repeat preview reloads, and at least five warm edits.

Record the browser/device, pinned versions, cache state, sample order, individual
timings, median, and worst observed latency. Separate runtime startup, install,
server readiness, and first visible preview where possible. Measure edit-to-visible
using the host clock and restore the source after the benchmark; restoration edits
also contribute to warm-up. Keep raw reports in `logs/vivari/` and summarize results
in a committed result card.

Proposed experience targets (goals, not measured capabilities):

- Ordinary warm edits at roughly **500 ms or less**.
- Repeat preview reloads within **a couple of seconds**.
- No recurring multi-second stalls during routine warm interactions.

Compare against [QEMU profiling](profiling.md), preserving cold/warm distinctions.
If the fixture remains sluggish, investigate the dominant cost before substantial
OpenCode adaptation. Reassess the approach if bounded fixes do not improve it.

## Gate 2: real OpenCode compatibility

### Agreed direction: mainline OpenCode inside Vivari

Keep the pinned, official V2 SDK and normal `OpenCode.create()` entrypoint running
as a Vivari process. Extend Vivari's Bun/Node compatibility and native-dependency
substitution mechanisms. OpenCode-specific profiles and a separate browser host
are architecture alternatives requiring a new decision, not the default path.

First implementation slice:

- [x] Inspect the pinned Vivari source: builtin APIs, module conditions, native
  package aliases, SQLite, FFI, and process execution.
- [x] Run isolated browser probes for module selection, SQLite, FFI, filesystem
  operations, and child-process behavior. Preserve failures as executable cases.
- [x] Inventory SQLite, process-lock, file-finder, and PTY calls in the pinned
  OpenCode packages; wider import-graph qualification remains part of host import.
- [x] Qualify sql.js WASM queries, rollback, and VFS export/reopen in separate
  browser processes. See the runtime audit for untested persistence semantics.
- [x] Establish a reproducible Vivari source-patch/build path before runtime fixes.
- [ ] Implement the smallest demonstrated compatibility gap and rerun its probe.
- [ ] Retry normal SDK import, host creation, and session creation.

The initial shared SQLite implementation now uses official SQLite WASM
3.49.1-build1 (same SQLite engine 3.49.1) rather than sql.js's limited prebuilt
API. Node/Bun query tests and separate-process recovery pass. A termination
regression exposed a committed-prefix persistence bug; the source fix passes
a focused unit test but awaits a browser rerun. Page-reload recovery, actual
OPFS fault qualification, final patched HMR, and OpenCode migrations remain open.

Use Vivari's existing JS/WASM drop-in machinery where a genuine compatible backend
exists. A CPU-check bypass, empty search result, no-op lock, or successful stub
import is not a working replacement. Keep package substitutions/version provenance
explicit. Native code needs an actual JS/WASM implementation; generic native FFI
is outside this first slice. Host-side packaging is allowed; execution stays inside
Vivari. Pin source patches and retain upstream licensing; avoid ad-hoc edits to
installed worker bundles.

SQLite must execute real queries and transactions and recover persisted data.
Locks must demonstrate contention/release across processes. Commands must preserve
stdout/stderr, exit status, stdin, and cancellation. Qualify each independently
before claiming OpenCode compatibility. Estimate remaining effort after these
checkpoints rather than assuming all named shims are complete.

SQLite will use a browser-native WASM backend (sql.js is the first candidate),
including if Linux commands later use QEMU. Native SQLite in the VM is not the
intended database architecture. Verify the backend directly before adapting the
synchronous `node:sqlite` / `bun:sqlite` interfaces, including initialization,
64-bit values, transaction rollback, and persistence across processes/reloads.

Work through these checkpoints in order and record failures with reproductions:

1. Import and create the pinned OpenCode V2 SDK host inside Vivari.
2. Create a session and verify its storage works.
3. Exercise read, search, edit, and representative subprocess commands against
   the same workspace that Vite serves. Verify output and exit status.
4. Configure the chosen model/auth path and verify incremental response streaming.
   Browser egress/CORS and buffered HTTP adapters may require a model relay or
   transport adaptation; a successful preview does not prove this path works.
5. Run a real prompt that inspects files, executes a command, edits two files,
   and produces visible HMR while OpenCode and Vite run together.
6. Verify cancellation stops active work, and verify workspace recovery after
   reloading the page. Check session persistence separately from source persistence.

Read current V2 SDK documentation and inspect the pinned package's actual runtime
requirements during implementation. Do not infer compatibility from an import,
TypeScript source, or the presence of a similarly named Bun API shim.

Model/provider and authentication choice is needed before checkpoint 4; it does
not block Gate 1 or local host/tool compatibility work. Keep credentials out of
committed files and diagnostic reports.

## Decision after the probes

- **Fast fixture + working real host/tools:** continue with Vivari and broaden
  representative agent tasks.
- **Small compatibility gaps:** implement bounded fixes, rerun the affected
  workflow, and document the supported command surface.
- **Linux-only tools are the remaining blocker:** evaluate a small QEMU/BusyBox
  environment using the preserved QEMU work
  as an explicit command backend, starting with one useful command and synchronized
  source. Prove value before building transparent process routing or a shared mount.
- **Major host/runtime gaps or persistent poor latency:** write up the evidence
  and revisit architecture before expanding the compatibility layer.

A Linux hybrid must explicitly handle shared-file consistency, watch events,
process routing, cancellation, and cross-runtime networking. Linux Bash launching
Linux Node would put heavy JS back under emulation. The runtimes do not automatically
share a filesystem or localhost, so hybrid integration is a separate milestone.
Prefer one authoritative workspace exposed to both environments; evaluate a
shared-filesystem bridge before relying on bidirectional file copies. BusyBox
supplies a shell and common utilities, not arbitrary missing Linux binaries.
Keep OpenCode, SQLite WASM, and fast JS tooling in Vivari for this hybrid option.

## Completion evidence

- Reproducible setup and run instructions with pinned versions.
- Fixture timing report with individual samples and comparison limitations.
- OpenCode compatibility results and a concrete missing-API/tool log.
- An actual prompt-to-edit-to-HMR demonstration, or an explicit failed checkpoint.
- A recommendation to continue, fix specific gaps, try the Linux backend, or switch.

References: [Vivari architecture](https://github.com/maitrungduc1410/vivari/blob/master/ARCHITECTURE.md),
[OpenCode V2 SDK](https://opencode.ai/v2/docs/build/sdk),
[preserved QEMU results](browser-result.md).
