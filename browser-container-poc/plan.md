# Browser Coding Workspace POC Plan

See the [descriptive decision matrix](decision-matrix.md) for criteria-by-approach facts, without ratings or coloring.
The separate [assessment](assessment.md) provides critique and a timeboxed validation proposal. It recommends testing existing
container2wasm/QEMU packaging before committing to direct integration; the original proposal below is retained for context.

Research sketch, 2026-09-05. This explores a generic coding workspace whose harness, source tree, and development
server execute inside the browser. The editor shell and application preview are views in the same browser application.
No candidate has been built or benchmarked against the fixture yet. Capabilities below are upstream documentation
claims unless explicitly described as our proposal. Pin revisions and record actual results when running the POCs.

## POC Contract

The POC has one black-and-white goal:

> Run OpenCode inside a browser-hosted runtime, let OpenCode edit a workspace in that runtime, run the workspace's HMR
> development server in the same runtime, and show the adjacent browser preview update from the edit without a manual
> refresh.

A candidate passes only when one continuous demonstration proves all of the following:

1. The browser starts the candidate runtime without a host-side compute process.
2. A pinned stock OpenCode V2 CLI/server starts inside that runtime. Use the current `opencode2` command if that is the
   pinned distribution's executable name.
3. OpenCode receives a real prompt and reads, searches, and edits files in a fixture workspace stored inside the runtime.
4. Vite starts inside the same runtime and serves that workspace.
5. The outer browser application displays the running fixture beside the workspace controls.
6. OpenCode makes a visible multi-file change and Vite HMR updates the preview automatically, without restarting the
   dev server or refreshing the preview.

Model inference may use an external provider through a narrow relay. The harness, editable filesystem, and development
server must execute in the browser runtime. A scripted patch, a separately hosted dev server, merely starting OpenCode,
or rebuild-and-refresh does not pass.

The runtime should be inspectable, modifiable, buildable, and self-hostable. A free trial, public SDK wrapper, or hosted
demo is insufficient. Prefer standard open-source licenses; distinguish permissive licenses, copyleft, and custom
restrictions. Open source does not necessarily mean permissive, and a wrapper's license does not cover its runtime.

The target is a reusable browser coding environment: an agentic harness, its source workspace, and the workspace's HMR
development server all run in the browser. Evaluate both how quickly a candidate completes that loop and whether its
runtime is a sound, extensible base rather than a collection of demo-specific special cases.

There are two implementation tracks, but they are judged by the same contract:

1. **Can we preserve stock OpenCode and normal Linux tooling?** Try full machine emulation first.
2. **Can OpenCode run on a lighter browser-native runtime?** Try Vivari as a side investigation. It only passes if real
   OpenCode runs; a custom replacement harness is useful research but is not this POC.

Do not assume that a VM is necessary. Also do not equate WebAssembly execution with running arbitrary Linux binaries:
that requires CPU/OS emulation or porting the programs.

## First POC Decisions

These choices are enough to begin; avoid designing a general browser-compute platform first.

- **Outer application:** Bun for package management and scripts, TypeScript, React, and Vite.
- **Fixture:** a small, self-contained Vite + React + TypeScript application with two source files, one local asset,
  one dependency, and no secrets, backend, authentication, private Git access, or external integration.
- **Harness:** a pinned stock OpenCode V2 CLI/server. An SDK entrypoint is acceptable for the Vivari investigation only
  if it runs the real OpenCode host and preserves its file/process tool behavior.
- **Preview:** show the guest dev server beside the workspace controls. Preview assets, errors, and HMR WebSocket traffic
  must cross an explicit port/transport bridge.
- **Model access:** use a narrow model relay and do not put provider credentials in the editable workspace. Infrastructure
  can be proven incrementally, but the final pass requires a real OpenCode prompt causing the edit.
- **Persistence:** memory is sufficient for the first vertical slice. Add OPFS and patch export only after HMR works.
- **Package installation:** prebundle the fixture and dependencies. Arbitrary installs are a later capability.
- **Security:** use public fixture code on localhost. Origin hardening and untrusted projects are follow-up work.

In addition to the core pass, collect these diagnostics when practical:

- TypeScript and TSX compilation, imports, a local asset, and dependency resolution.
- Useful build diagnostics after a deliberate import or type error, followed by recovery.
- Dev-server process output, exit status, and cancellation.

TypeScript is an implementation choice for the shell and adapters, not a runtime strategy. This POC prioritizes
unmodified OpenCode and normal Linux tooling, so machine emulation is the primary path.

## Candidate Map

Priority is our proposed experiment order, not a maturity or performance rating. Links lead to primary sources.

| Candidate                                  | Execution model and licensing evidence                                                                                                                                                                                                                                                                  | Fit / first question                                                                                                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **QEMU WASM directly**                     | System emulation; the browser fork documents x86-64, AArch64, and RISC-V examples. Its status distinguishes interpreter support from ongoing WASM JIT upstreaming. [Project](https://github.com/ktock/qemu-wasm).                                                                                       | **Lead approach.** Own the browser integration and guest image explicitly. First run pinned stock OpenCode, Bun, and Vite; then implement the asset/HMR bridge. Record the exact fork and backend.            |
| **container2wasm**                         | Converts container images into browser/WASI artifacts using emulators. Converter is Apache-2.0; guest and emulator components retain their own licenses. [Project](https://github.com/container2wasm/container2wasm), [license](https://github.com/container2wasm/container2wasm/blob/main/LICENSE).    | **Reference and build helper.** Reuse its image-conversion recipes, patches, filesystem, networking, or packaging where useful without making its generated runtime our primary abstraction.                 |
| **Bochs / TinyEMU through container2wasm** | Existing conversion backends: x86-64 via Bochs and RISC-V via TinyEMU. [Backend overview](https://github.com/container2wasm/container2wasm).                                                                                                                                                            | Cheap comparison if the conversion path is already working. Bochs is relevant to x64 binaries; RISC-V needs matching tools and is not a stock Bun target.                                                    |
| **Vivari**                                 | MIT repository; browser workers, Node's JS library code, virtual processes/files/networking. Advertises React Router, Tailwind, Vite/HMR, and Bun API emulation. [Project](https://github.com/maitrungduc1410/vivari).                                                                                  | **Side quest.** It already targets the development-server half of the contract. Determine whether the real OpenCode V2 host can run on its Node/Bun compatibility surface.                                  |
| **almostnode**                             | JS Node API emulation with VFS, browser compilation, and preview support; [MIT license](https://raw.githubusercontent.com/macaly/almostnode/main/LICENSE). [Project](https://github.com/macaly/almostnode).                                                                                             | **Deferred alternative.** Consider only if the Vivari investigation reveals a specific advantage almostnode could provide.                                                                                   |
| **Wasmer SDK / WASIX**                     | Runs WASM-targeted programs with filesystem/process/port APIs; current SDK calls itself alpha. Includes browser shell and networking examples. [Project](https://github.com/wasmerio/wasmer-sdk).                                                                                                       | **Conditional second round.** Useful middle ground between JS emulation and a whole machine. Native Bun/OpenCode binaries do not become WASIX programs automatically.                                        |
| **NanoVM / userland.run**                  | RISC-V user-mode Linux emulation, plus additional execution runners. Emulator offers AGPL-3.0 or commercial terms; SDK is described separately as MPL-2.0. [Project](https://github.com/userland-run/nano), [license explanation](https://raw.githubusercontent.com/userland-run/nano/main/LICENSE.md). | **Exploratory second round.** Interesting syscall-emulation/hybrid approach. Check static-binary requirements, runner selection, and actual Node performance. RISC-V is a poor starting point for stock Bun. |
| **v86**                                    | BSD-2-Clause x86-to-WASM emulator; lacks 64-bit extensions and multicore. [Project](https://github.com/copy/v86).                                                                                                                                                                                       | Useful Linux/shell reference, low priority for this workload. Current [Bun platforms](https://github.com/oven-sh/bun) are x64/ARM64, so this is not a direct stock-harness route.                            |
| **Sandpack client bundler**                | Apache-2.0 browser bundler with documented custom `bundlerURL` setup. [Bundler repository](https://github.com/codesandbox/sandpack-bundler).                                                                                                                                                            | **Preview-only alternative.** Could accompany a custom agent loop. Prove current React/CSS behavior and self-host dependency delivery. Do not confuse it with Nodebox.                                       |
| **Custom file tools + esbuild-wasm**       | Assemble browser file/search/edit tools and a compiler instead of simulating an OS. esbuild documents a browser API. [API](https://esbuild.github.io/api/#browser).                                                                                                                                     | **Small baseline POC.** Tests whether we need a general shell/runtime at all. We own route/CSS/build integration and the harness.                                                                            |

### container2wasm Project Health

Status checked 2026-09-05. The project is active and suitable for a timeboxed POC, but upstream explicitly calls it
"experimental software" and a "PoC converter," and it carries meaningful single-maintainer risk:

- Latest release: **v0.8.4**, 2026-03-16. It added a browser LLM-container example and reduced a browser runtime
  dependency. Earlier 2025 releases included browser compatibility fixes for Firefox and Safari.
- The repository reports activity through 2026-08-24 and is not archived. It has about 2.8k stars, 150 forks, and an
  Apache-2.0 license.
- `MAINTAINERS` lists only Kohei Tokunaga. GitHub attributes 721 commits to him and 165 to Dependabot, with very few
  outside contributions. Treat the bus factor as one despite the repository living in an organization.
- It remains pre-1.0 and has open issues and pull requests. Pin the tested release and its QEMU dependency; do not rely
  on `main` or assume browser/Bun/OpenCode compatibility beyond what we measure.

Sources: [repository](https://github.com/container2wasm/container2wasm),
[v0.8.4 release](https://github.com/container2wasm/container2wasm/releases/tag/v0.8.4),
[maintainers](https://github.com/container2wasm/container2wasm/blob/main/MAINTAINERS), and
[contributors](https://github.com/container2wasm/container2wasm/graphs/contributors).

### Maintenance And Compatibility Comparison

Status checked 2026-09-05. Several alternatives have stronger maintenance signals than the QEMU-Wasm/container2wasm
ecosystem, but none combines that advantage with self-hostable open-source x86-64 Linux compatibility for stock Bun and
OpenCode:

| Option | Current maintenance signal | Implication for the lead QEMU-Wasm approach |
| ------ | -------------------------- | -------------------------------------------------- |
| **v86** | Active through September 2026, about 23k stars, and several substantial contributors. | Its emulated CPU remains 32-bit x86. It cannot run x86-64 Linux, Bun, or OpenCode's selected native binary. |
| **Wasmer SDK** | Organization-backed and active through September 2026. | Executes WASI/WASIX programs rather than arbitrary Linux binaries; stock Bun and OpenCode do not become WASIX programs automatically. Its modified MIT license also needs separate review. |
| **WebVM / CheerpX** | Company-developed and active through August 2026. | The Apache-2.0 WebVM shell depends on the proprietary CheerpX core, whose business use and self-hosting have separate terms. |
| **NanoVM / userland.run** | Active in 2026 but new and small. | Runs RISC-V statically linked Linux binaries, not the stock Bun target; the emulator is AGPL-3.0 or commercially licensed. |
| **Vivari** | Active but created only in July 2026 and still small. | Emulates selected Node/Bun APIs rather than providing normal Linux binary compatibility. |
| **QEMU WASM** | Browser fork is maintained in the same ecosystem as container2wasm. | It shares the same key maintainer, so using it directly does not reduce the bus-factor concern. |

If licensing and runtime modifiability become negotiable, WebVM/CheerpX is the most credible actively supported
full-Linux comparison. Otherwise, direct QEMU-Wasm remains the lead experiment. Treat container2wasm as implementation
evidence and a source of reusable build/runtime pieces, not a required production abstraction.

### v86 x86-64 Status And Box64

v86 does not have experimental x86-64 support. Its only official branches are `master` and `wip`; `wip` is a staging
branch and contains no long-mode implementation. The canonical x86-64 request has remained open and unassigned since
2017 with no milestone or linked implementation. PAE support merged in 2022, but PAE extends 32-bit memory addressing;
it does not add x86-64 instructions or long mode.

Recent discussion has not turned into development:

- A March 2025 x64 request was closed as a duplicate.
- In February 2025, a commenter suggested Box64 as reference material.
- A November 2025 request motivated by modern Node versions was closed without an implementation.
- Work on an NX bit in late 2025/early 2026 was closed unmerged and was not long-mode support.
- The latest canonical-issue comment, from March 2026, only expressed interest. No active x86-64 pull request, branch,
  roadmap assignment, or relevant recent commit was found.

[Box64](https://github.com/ptitSeb/box64) is a Linux userspace emulator and dynamic recompiler that runs x86-64 Linux
programs on an existing 64-bit Arm, RISC-V, or LoongArch Linux host. It maps calls to the host's native Linux libraries
instead of emulating a complete computer. It cannot be dropped into v86: v86 provides a 32-bit x86 machine, Box64 needs
a 64-bit non-x86 Linux host, and Box64 is not a browser/WASM runtime. The suggestion was to study its translation
techniques, not to use it as an available v86 plugin. A hypothetical browser RISC-V layer plus Box64 would require a
port and two translation layers; no usable implementation was found.

Sources: [v86 README](https://github.com/copy/v86/blob/master/Readme.md),
[canonical x86-64 issue](https://github.com/copy/v86/issues/133),
[implementation tips](https://github.com/copy/v86/issues/648),
[2025 duplicate request](https://github.com/copy/v86/issues/1293),
[Node-motivated request](https://github.com/copy/v86/issues/1458), and
[Box64 README](https://github.com/ptitSeb/box64/blob/main/README.md).

### Important Caveats In The Shortlist

**Vivari's Bun support is a shim, not the native Bun executable.** Its architecture explicitly identifies unsupported
APIs, including FFI and some process behavior. A working `bun --version` or `Bun.serve` is insufficient evidence for
OpenCode. Test headless harness operation separately from the frontend; list every shim or harness patch required.
[Architecture](https://raw.githubusercontent.com/maitrungduc1410/vivari/master/ARCHITECTURE.md)

**Wasmer's current SDK license is modified MIT.** It adds visible Wasmer attribution for commercial products above
one million monthly active users or one million US dollars in monthly revenue. Keep it conditional under the preference
for standard licenses; do not label it plain MIT. Inspect selected runtime/package licenses separately.
[Actual license](https://raw.githubusercontent.com/wasmerio/wasmer-sdk/main/LICENSE)

**A WASM JIT matters for the emulation track.** QEMU's browser fork describes compiling frequently executed translation
blocks to WASM, while also retaining an interpreter. Capture which mode ran. Browser machine emulation has no KVM-style
hardware virtualization available through the normal web platform; assess CPU-heavy installs, compilation, and guest JS
execution directly. [Browser backend notes](https://github.com/ktock/qemu-wasm)

### Discovered, But Outside The Initial Open-Source Shortlist

| Option          | Reason to defer                                                                                                                                                                                                                                                                         |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WebContainers   | Proprietary runtime conflicts with the desired ability to modify the implementation. Keep only as a UX reference. Its docs also distinguish commercial production use from free POCs. [Terms overview](https://webcontainers.io/enterprise).                                            |
| WebVM / CheerpX | WebVM's Apache-2.0 wrapper does not grant equivalent rights to CheerpX. Its README documents separate usage and hosting restrictions. [License section](https://github.com/leaningtech/webvm#license).                                                                                  |
| BrowserPod      | Commercial licensing and metering; self-hosting is an enterprise arrangement. Does not establish the desired freely modifiable runtime. [Licensing](https://browserpod.io/docs/more/licensing).                                                                                         |
| Nodepod         | Current repository says MIT **with Commons Clause**, despite older search snippets saying open source. [Repository](https://github.com/R1ck404/Nodepod).                                                                                                                                |
| Nodebox         | Runtime uses a Sustainable Use License with use/distribution restrictions. Sandpack's Apache license should not be generalized to Nodebox. [Runtime license](https://raw.githubusercontent.com/Sandpack/nodebox-runtime/main/LICENSE).                                                  |
| OpenContainers  | Relevant Node-style runtime, package manager, and preview bridge, but no license was established from the repository page inspected. Treat as a discovery lead pending an explicit license, not an approved OSS dependency. [Repository](https://github.com/Welfordian/OpenContainers). |

License findings describe the inspected upstream versions. Before a trial, save the exact revision and license files;
also verify that the necessary runtime source and build inputs are present. This matters more than repository popularity.

## Implementation Tracks

### A. Stock Harness Inside An Emulated Machine

```text
Trusted editor shell
  -> isolated runtime origin / worker
       QEMU-Wasm -> Linux -> OpenCode + source + frontend build/dev server
  -> adjacent preview <- bridge for guest assets and HMR
  -> authenticated, bounded model relay
```

Integrate [QEMU-Wasm](https://github.com/ktock/qemu-wasm) directly so the POC controls machine startup, filesystem image,
serial/process control, networking, port forwarding, and instrumentation. Build a minimal Linux image with pinned
OpenCode, Bun, the fixture, and its dependencies preinstalled. x64 is the initial candidate; test AArch64 only if its
backend provides a concrete compatibility or performance advantage.

Use container2wasm as a reference and optional build helper. Borrow its kernel/image recipes, patches, filesystem setup,
network stack, or generated artifacts when that saves time, but keep our browser-facing runtime integration against
QEMU-Wasm rather than the converter's output contract.

Prove in this order: guest boot and control, `bun`, stock OpenCode startup, Vite serving bridged assets, HMR transport,
then a real OpenCode prompt that performs the visible edit. These are incremental milestones; only the final step passes
the POC contract.

Expected advantage: fewer harness changes and more faithful shell/tool behavior. Main unknowns: image download size,
memory, guest CPU features, process startup, filesystem performance, and HMR forwarding. Do not build a desktop GUI;
serial/headless control is sufficient. A normal container on the developer machine is a useful timing baseline.

### B. Vivari Side Quest

```text
Trusted editor shell
  -> isolated runtime host
       browser Node/Bun compatibility layer + virtual source tree + frontend tooling
        real OpenCode host using the available Node/Bun surface
  -> separate preview frame
  -> authenticated, bounded model relay
```

Vivari already claims the Vite/HMR, virtual filesystem, package-manager, and process pieces. Start by attempting to run
the real OpenCode V2 host—preferably through its SDK or JavaScript entrypoint—before integrating Vivari's preview UI. A
thin launch adapter is acceptable; replacing OpenCode's agent or file/process tools is not a pass. Record every missing
Node/Bun API. Stop if success requires a broad compatibility fork.

Wasmer/WASIX is a possible variation using ported executables. Its examples include outbound networking through WISP;
record any external relay instead of describing the result as independent of servers.
[SDK examples](https://github.com/wasmerio/wasmer-sdk)

### C. Purpose-Built Comparison Only

Give the model explicit `listFiles`, `readFile`, `search`, `applyPatch`, and `buildPreview` operations over one virtual
workspace. Compile through esbuild-wasm, supply pinned dependency artifacts, and render in a separate frame. This can
help isolate integration problems, but it does not pass this POC because it replaces OpenCode and the in-runtime HMR
server.

If shell syntax helps the agent, consider [just-bash](https://github.com/vercel-labs/just-bash): its browser-supported core
provides a simulated shell and filesystem. It cannot execute arbitrary native binaries; several optional commands are
Node-only. It is [Apache-2.0](https://raw.githubusercontent.com/vercel-labs/just-bash/main/packages/just-bash/LICENSE).

This gives maximum control and might be enough for UI edits, but transfers responsibility to us for tool behavior,
conversation/cancellation, build diagnostics, package resolution, and the supported editing surface. It also does not
prove that a real Vite development server or its HMR protocol can run. Keep it as a baseline, not a substitute that
quietly changes the goal.

## Small POC Sequence

Suggested exploration order. Stop a failing candidate with a concrete blocker rather than building a general runtime
compatibility layer.

| Trial                       | Priority           | Evidence to collect                                                                                                                |
| --------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Shared fixture              | Prerequisite       | A secrets-free source snapshot that runs under pinned Bun/Vite locally. Use exactly the same fixture for each runtime.              |
| Direct QEMU-Wasm boot       | First              | Boot and control the pinned x64 Linux image in-browser; capture download size, startup time, memory, and selected execution backend. |
| OpenCode inside QEMU-Wasm   | First              | Start pinned stock OpenCode, make a real model call, and prove its read/search/edit/process tools operate on the guest workspace.   |
| Vite/HMR inside QEMU-Wasm   | First              | Bridge HTTP and WebSocket traffic, show the adjacent preview, and pass the complete prompt-to-HMR contract.                         |
| container2wasm comparison   | Supporting         | Identify build recipes, patches, networking pieces, or generated artifacts worth reusing in the direct integration.                |
| Vivari                      | Side quest         | Run the real OpenCode host, then pass the same prompt-to-HMR contract; list every compatibility patch.                              |
| Bochs / other emulators     | Only after blocker | Compare only when a measured QEMU-Wasm blocker gives another backend a specific reason to win.                                     |
| Custom compiler loop        | Diagnostic only    | Isolate filesystem/compiler/preview issues. Do not count it as a successful POC.                                                   |

Do not require every trial before choosing. The interesting first comparison is **stock-harness fidelity versus browser
editing latency and integration effort**. Evaluate demos on public fixtures; load private source only into a reviewed,
self-hosted build.

### Common Editing Exercise

1. Load a fixed fixture revision and open its preview.
2. Ask for a two-file UI change involving an imported component and CSS.
3. Check the diff and visible result. Introduce a deliberate import/type error and verify useful diagnostics/recovery.
4. Load a local asset and verify both JavaScript and CSS HMR updates.
5. Save, refresh, close/reopen, and recover the exact source changes. Export a patch with its base commit.
6. Cancel a running operation and simulate worker failure. Recover files without silently resetting the workspace.

For a runtime claiming typecheck support, test an actual semantic TypeScript error; successful TSX transpilation alone
is not typechecking. For a harness claiming compatibility, verify search, patching, subprocess output/exit codes,
streaming responses, and cancellation—not just process startup.

### Result Card

Use this for each trial; all measurements are currently **not run**:

- Runtime revision, license, guest architecture/backend, browser version, machine/RAM, and fixture base commit.
- Cold downloaded bytes and time to usable workspace; warm restart time; peak memory where measurable.
- Build/start time; file-write-to-visible-update latency over five edits; fresh install time separately, if supported.
- Supported frontend features, harness version/mode, required patches, and unimplemented operations.
- Every external service contacted: artifact/package host, model endpoint, network relay, telemetry, workspace storage.
- Persistence result, patch export/import result, cancellation/crash result, and next blocker.

Proposed usability targets: warm open within 10 seconds, cold open within 60 seconds, small edits visible within
2 seconds, and exact saved-source recovery. These are discussion targets, not vendor promises or hard requirements.
Report model response time separately from local tool/build time.

## Browser Integration Questions Shared By All Options

**Networking:** container2wasm documents Fetch-based networking subject to CORS and an external WebSocket relay option.
Guest localhost is not the browser's localhost. Determine how guest HTTP responses, assets, streams, and WebSockets reach
the preview. Preinstalled dependencies reduce the initial networking problem; arbitrary package installation is a later
capability. [Networking modes](https://github.com/container2wasm/container2wasm)

**Model access:** local tool execution does not mean local inference. Prefer a narrow authenticated model relay with
fixed provider destinations, spending limits, and cancellation. Keep provider keys out of the editable environment.
The relay must not become an arbitrary URL proxy.

**Persistence:** keep a versioned base snapshot plus saved edits. OPFS is a possible implementation, but remains
origin-scoped, quota-limited browser storage; clearing site data removes it. Request persistence where supported and
provide explicit export/checkpoint recovery. Record base revision, file additions/deletions, and binary assets. Saving
source is separate from preserving VM RAM or conversations. [OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)

**Runtime lifetime:** assume tab suspension, browser crashes, and device sleep interrupt execution. Save incrementally;
do not rely on unload handlers. The default is a per-browser workspace unless synchronization is added. A small backend
checkpoint store could restore cross-device continuity without hosting compute.

**Origin and header requirements:** test workers, WASM, service workers, and cross-origin isolation in the intended
embedding topology. Worker isolation alone does not strip access to same-origin services. Give runtime/preview code
separate origins from privileged application credentials. Scope any service worker to a dedicated origin.
For comparison, [WebContainers documents embedding/header constraints](https://webcontainers.io/guides/troubleshooting);
each shortlisted implementation needs its own measured answer. A standalone editor page is an acceptable early POC,
but does not demonstrate the final embedded experience.

**External data:** fixtures only for these trials. Editable code may transmit any data it can read through allowed
network paths. A VM alone does not establish confidentiality from its own code or the model provider.

## POC Boundary

Treat the browser workspace as **a runtime, a filesystem, an agentic harness, running development processes, and an
explicit preview connection**. Keep a small adapter around workspace creation, file read/write/export, process
start/stop/output, preview ports, and disposal. Do not build a general orchestration platform during this POC.

The durable assets should be portable source files and a reproducible environment recipe; opaque VM snapshots can
remain an engine-specific optimization. Running the harness locally does not imply local model inference, and public
hosting, collaboration, and execution after the tab closes are outside this experiment.

Working hypothesis: integrate **QEMU-Wasm directly** with an x64 Linux image containing pinned stock OpenCode, Bun, Vite,
and the fixture. Use container2wasm as a reference or build helper where useful, without centering the architecture on
it. Pursue Vivari as a side quest against the exact same pass contract. A Linux boot, an OpenCode startup screen, a
scripted file edit, or a preview that requires refresh is not success; the complete real-prompt-to-HMR loop must work.
