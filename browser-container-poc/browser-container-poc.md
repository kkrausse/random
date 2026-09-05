# Browser Coding Workspace POC

Research sketch, 2026-09-05. This explores a generic coding workspace whose harness, source tree, and development
server execute inside the browser. The editor shell and application preview are views in the same browser application.
No candidate has been built or benchmarked against the fixture yet. Capabilities below are upstream documentation
claims unless explicitly described as our proposal. Pin revisions and record actual results when running the POCs.

## What We Want To Learn

Can a user open an editing workspace, prompt a code change, see a frontend update through HMR, and retain the source
changes, with the coding harness and workspace executing on their own computer inside the browser?

The runtime should be inspectable, modifiable, buildable, and self-hostable. A free trial, public SDK wrapper, or hosted
demo is insufficient. Prefer standard open-source licenses; distinguish permissive licenses, copyleft, and custom
restrictions. Open source does not necessarily mean permissive, and a wrapper's license does not cover its runtime.

The wider idea is a reusable browser compute environment: small isolated workspaces that can host applications and
agents operating on them. Frontend editing is the first useful workload, not necessarily the eventual boundary.
Evaluate both how quickly a candidate solves this use case and how much freedom it leaves for substantially different
programs later. A slightly heavier runtime may be worthwhile if it avoids rebuilding the environment for every new app.

There are two separate questions:

1. **Can we preserve stock OpenCode and normal Linux tooling?** Try full machine emulation first.
2. **Can we deliver the editing experience with less machinery?** Try a browser Node-compatible runtime or explicit
   file tools plus a browser compiler. This may require adapting or replacing the harness.

Do not decide that a VM is necessary just because the original implementation uses a container. Also do not equate
WebAssembly execution with running arbitrary Linux binaries: that requires CPU/OS emulation or porting the programs.

## First POC Decisions

These choices are enough to begin; avoid designing a general browser-compute platform first.

- **Outer application:** Bun for package management and scripts, TypeScript, React, and Vite.
- **Fixture:** a small, self-contained Vite + React + TypeScript application with two source files, one local asset,
  one dependency, and no secrets, backend, authentication, private Git access, or application-specific integration.
- **Harness:** stock OpenCode in headless/server mode inside a full Linux environment. Do not begin with an adapted or
  reduced harness.
- **Preview:** load the guest dev server as the top-level browser page during the POC, not in an iframe. Preview assets,
  errors, and HMR WebSocket traffic must cross an explicit port/transport bridge. Embedding and isolation come later.
- **Model access:** defer model calls until runtime, filesystem, dev server, and HMR work. Then use a narrow model relay;
  do not put provider credentials in the editable workspace.
- **Persistence:** memory is sufficient for the first vertical slice. Add OPFS and patch export only after HMR works.
- **Package installation:** prebundle the fixture and dependencies. Arbitrary installs are a later capability.
- **Security:** use public fixture code on localhost. Origin hardening and untrusted projects are follow-up work.

The fixture must prove:

- TypeScript and TSX compilation, imports, a local asset, and dependency resolution.
- A harness reading/searching files and applying a multi-file edit.
- A visible HMR update after a harness edit, without manually refreshing the preview.
- Useful build diagnostics after a deliberate import or type error, followed by recovery.
- Dev-server process output, exit status, and cancellation.

TypeScript is an implementation choice for the shell and adapters, not a runtime strategy. This POC prioritizes
unmodified OpenCode and normal Linux tooling, so machine emulation is the primary path.

## Candidate Map

Priority is our proposed experiment order, not a maturity or performance rating. Links lead to primary sources.

| Candidate                                  | Execution model and licensing evidence                                                                                                                                                                                                                                                                  | Fit / first question                                                                                                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **container2wasm**                         | Converts container images into browser/WASI artifacts using emulators. Converter is Apache-2.0; guest and emulator components retain their own licenses. [Project](https://github.com/container2wasm/container2wasm), [license](https://github.com/container2wasm/container2wasm/blob/main/LICENSE).    | **Primary stock-harness track.** Package pinned OpenCode, Bun, Git, and frontend dependencies. Can the actual edit loop run comfortably?                                                                     |
| **QEMU WASM directly**                     | System emulation; the browser fork documents x86-64, AArch64, and RISC-V examples. Its status distinguishes interpreter support from ongoing WASM JIT upstreaming. [Project](https://github.com/ktock/qemu-wasm).                                                                                       | Use when container2wasm hides a needed option or backend. Record exact fork/backend; do not assume a stock QEMU release includes the same browser acceleration.                                              |
| **Bochs / TinyEMU through container2wasm** | Existing conversion backends: x86-64 via Bochs and RISC-V via TinyEMU. [Backend overview](https://github.com/container2wasm/container2wasm).                                                                                                                                                            | Cheap comparison if the conversion path is already working. Bochs is relevant to x64 binaries; RISC-V needs matching tools and is not a stock Bun target.                                                    |
| **Vivari**                                 | MIT repository; browser workers, Node's JS library code, virtual processes/files/networking. Advertises React Router, Tailwind, Vite/HMR, and Bun API emulation. [Project](https://github.com/maitrungduc1410/vivari).                                                                                  | **Lightweight fallback.** Promising overlap with the fixture, but does not meet the initial stock-harness requirement.                                                                                        |
| **almostnode**                             | JS Node API emulation with VFS, browser compilation, and preview support; [MIT license](https://raw.githubusercontent.com/macaly/almostnode/main/LICENSE). [Project](https://github.com/macaly/almostnode).                                                                                             | **Lightweight fallback.** Compare with Vivari only after deciding that an adapted harness is acceptable.                                                                                                      |
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

Status checked 2026-09-05. Several alternatives show more recent or broader maintenance than container2wasm, but none
combines that advantage with self-hostable open-source x86-64 Linux compatibility for stock Bun and OpenCode:

| Option | Current maintenance signal | Why it does not replace container2wasm for this POC |
| ------ | -------------------------- | -------------------------------------------------- |
| **v86** | Active through September 2026, about 23k stars, and several substantial contributors. | Its emulated CPU remains 32-bit x86. It cannot run x86-64 Linux, Bun, or OpenCode's selected native binary. |
| **Wasmer SDK** | Organization-backed and active through September 2026. | Executes WASI/WASIX programs rather than arbitrary Linux binaries; stock Bun and OpenCode do not become WASIX programs automatically. Its modified MIT license also needs separate review. |
| **WebVM / CheerpX** | Company-developed and active through August 2026. | The Apache-2.0 WebVM shell depends on the proprietary CheerpX core, whose business use and self-hosting have separate terms. |
| **NanoVM / userland.run** | Active in 2026 but new and small. | Runs RISC-V statically linked Linux binaries, not the stock Bun target; the emulator is AGPL-3.0 or commercially licensed. |
| **Vivari** | Active but created only in July 2026 and still small. | Emulates selected Node/Bun APIs rather than providing normal Linux binary compatibility. |
| **QEMU WASM** | Browser fork is maintained in the same ecosystem as container2wasm. | It shares the same key maintainer, so using it directly does not reduce the bus-factor concern. |

If licensing and runtime modifiability become negotiable, WebVM/CheerpX is the most credible actively supported
full-Linux comparison. Otherwise, container2wasm remains the closest match and should be treated as a technology probe,
not a production dependency commitment.

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

## Three Shapes Worth Trying

### A. Stock Harness Inside An Emulated Machine

```text
Trusted editor shell
  -> isolated runtime origin / worker
       QEMU or Bochs -> Linux -> OpenCode + source + frontend build/dev server
  -> top-level preview page <- bridge for guest assets and updates
  -> authenticated, bounded model relay
```

Use container2wasm as packaging first. Build an image with tools and dependencies preinstalled; x64 is the initial
candidate, with AArch64 as an alternative if that backend offers better compatibility/performance. First prove
`bun`, OpenCode startup, and the real frontend build without any model call. Then add a prompt.

Expected advantage: fewer harness changes and more faithful shell/tool behavior. Main unknowns: image download size,
memory, guest CPU features, process startup, filesystem performance, and HMR forwarding. Do not build a desktop GUI;
serial/headless control is sufficient. A normal container on the developer machine is a useful timing baseline.

### B. Browser Runtime With A Compatible Or Adapted Harness

```text
Trusted editor shell
  -> isolated runtime host
       browser Node/Bun compatibility layer + virtual source tree + frontend tooling
       compatible harness, or adapted file/process tools
  -> separate preview frame
  -> authenticated, bounded model relay
```

Try Vivari first, almostnode second. Test frontend compatibility before spending time porting OpenCode. A runtime can
win the preview comparison while failing the harness comparison. If a small adapter fixes the latter, document it; if
it becomes a fork of numerous Bun/Node internals, stop and compare with A or C.

Wasmer/WASIX is a possible variation using ported executables. Its examples include outbound networking through WISP;
record any external relay instead of describing the result as independent of servers.
[SDK examples](https://github.com/wasmerio/wasmer-sdk)

### C. Purpose-Built Browser Editing Loop

Give the model explicit `listFiles`, `readFile`, `search`, `applyPatch`, and `buildPreview` operations over one virtual
workspace. Compile through esbuild-wasm, supply pinned dependency artifacts, and render in a separate frame. Start with
rebuild-and-reload, without requiring React state-preserving HMR. This is an intentional POC relaxation of the original
plan, not proof that the full V1 HMR requirement is met.

If shell syntax helps the agent, consider [just-bash](https://github.com/vercel-labs/just-bash): its browser-supported core
provides a simulated shell and filesystem. It cannot execute arbitrary native binaries; several optional commands are
Node-only. It is [Apache-2.0](https://raw.githubusercontent.com/vercel-labs/just-bash/main/packages/just-bash/LICENSE).

This gives maximum control and might be enough for UI edits, but transfers responsibility to us for tool behavior,
conversation/cancellation, build diagnostics, package resolution, and the supported editing surface. It also does not
prove that a real Vite development server or its HMR protocol can run. Keep it as a baseline, not a substitute that
quietly changes the goal.

## Small POC Sequence

Suggested exploration order; timeboxes are effort caps, not delivery estimates. Stop a failing candidate with a concrete
blocker rather than building a general runtime compatibility layer.

| Trial                | Initial effort cap                 | Evidence to collect                                                                                                                    |
| -------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Shared fixture       | Half day                           | A secrets-free source snapshot and frontend-only entry that works in a normal local runtime. Use the same input for all candidates.    |
| container2wasm/QEMU  | One day                            | Boot a prebuilt image; run Bun, stock OpenCode, file tools, and frontend build. Prove browser asset delivery before polishing HMR.     |
| Bochs backend        | A few hours, if already accessible | Repeat the same guest workload and compare timing/compatibility. Avoid a separate image-building project.                              |
| Vivari               | Optional fallback                  | Only try if full machine emulation fails a measured performance or compatibility threshold and adapting the harness becomes acceptable. |
| almostnode           | Optional fallback                  | Compare with Vivari only after deciding that a reduced browser runtime is acceptable.                                                   |
| Custom compiler loop | Half day                           | Apply a scripted multi-file patch, rebuild, display diagnostics, fix the error, export the patch. Add the model only after that works. |
| WASIX / NanoVM       | Optional second round              | Only if initial results reveal a specific gap they could solve. First prove relevant toolchain binaries and license fit.               |

Do not require every trial before choosing. The interesting first comparison is **stock-harness fidelity versus browser
editing latency and integration effort**. Evaluate demos on public fixtures; load private source only into a reviewed,
self-hosted build. Keep all POC code optional and outside the normal application startup path.

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

## Broader Direction: Applications And Agents In Browser Boxes

Treat a box conceptually as **a runtime, a filesystem, running processes, and explicitly granted connections**. An agent
could live inside the same box as an application, or a trusted agent controller could operate one or more boxes through
file/process tools. Neither arrangement needs to be implemented as a general platform during this POC.

Examples worth keeping in view:

- A Python data-processing workspace with scripts, packages, input files, and an agent that iterates on results.
- A small API plus SQLite, with an agent exercising endpoints and changing the application.
- A document/media conversion toolchain using native CLI programs and generated output files.
- A compiler/test environment for another language, with an agent reading diagnostics and repairing code.
- Multiple disposable experiments created from one base image, with selected results exported back to the user.

These are proposed workloads, not claims that any candidate supports them. Running an agent locally also does not mean
running model inference locally; keep inference placement independent from tool execution.

### What Each Runtime Family Leaves Open

| Family                                 | Potential breadth                                                                                          | Limitation to probe                                                                                                                                         |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full Linux machine emulation           | Broadest compatibility hypothesis for existing applications, language runtimes, package tools, and agents. | Matching CPU architecture/features, memory and disk size, throughput, and hardware/device requirements. A Linux image does not guarantee a usable workload. |
| User-mode CPU/syscall emulation        | Existing binaries without booting a full guest kernel; potentially useful between a full VM and a port.    | Exact syscall coverage, linking/loader constraints, process semantics, and architecture-specific binary availability.                                       |
| WASI/WASIX programs                    | A collection of purpose-built WASM executables sharing files and process/network facilities.               | Each required program and native dependency needs an available compatible build or a port.                                                                  |
| Browser Node/Bun compatibility runtime | JS applications, development tools, and agents whose dependencies fit the implemented API surface.         | Native binaries, FFI, unsupported runtime APIs, and tools outside the JS ecosystem. Additional language runtimes may be separate integrations.              |
| Custom compiler/file tools             | Very controllable editing and execution of a deliberately supported application shape.                     | Least general option; broader application support becomes our responsibility. Keep as a focused baseline, not the default platform direction.               |

The broader ambition raises the value of the emulation track and makes WASIX/user-mode emulation more than fallback
curiosities. Keep two scores: **usefulness for today's editor** and **breadth of future applications**. Do not collapse
them into one benchmark or choose solely by fastest React refresh.

### Cheap Breadth Probes

After a candidate passes a basic workspace exercise, try a few of these before investing in product integration:

| Probe                                                                    | What it tells us                                                            |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Run a Python script over a local CSV and save a result                   | A second language, filesystem interoperability, and artifact export.        |
| Start a small HTTP API backed by SQLite and call it from another process | Long-lived services, local networking, shared files, and database support.  |
| Run a non-JS CLI already present in the image/package collection         | Whether arbitrary supported executables work or commands are special-cased. |
| Run two processes with pipes, interrupt one, and inspect exit status     | Whether an agent can reliably supervise applications.                       |
| Create two workspaces from one base; change a file in one                | Isolation and potential reuse of immutable downloads without mixing edits.  |
| Resume saved files after termination and export a generated binary file  | Durability beyond text patches and independence from process snapshots.     |

Use tiny fixtures and available tools; record unsupported probes without porting entire ecosystems. For conversion or
compiler workloads, separately measure sustained CPU time. Do not infer general compute performance from interactive
shell responsiveness.

### Boundaries A Future Platform Would Need

Browser-hosted services initially serve the local user's session. Public inbound access, collaboration, or work that
continues after the tab closes needs additional infrastructure or a different execution host. Likewise, filesystem
access to user-selected files, network relays, and hardware/GPU access are explicit integrations, not automatic guest
Linux capabilities. Keep those distinctions visible when describing what a box can host.

For the experiments, keep a small adapter around workspace creation, file read/write/export, process start/stop/output,
preview ports, and disposal. Record capabilities such as supported executable formats and persistence behavior. Do not
build a universal orchestration API yet. The durable asset should be portable source/input files and a reproducible
environment recipe; opaque VM snapshots can remain an engine-specific optimization.

Working hypothesis: try **container2wasm/QEMU first** with stock OpenCode, Bun, and Vite. Use Bochs as a nearby backend
comparison if practical. Keep Vivari, almostnode, and a custom compiler loop as fallbacks only if full machine emulation
fails a measured performance or compatibility threshold. Give WASIX and NanoVM a short breadth probe only if they
address a specific observed blocker. A Linux boot demo is not success; the complete harness-to-HMR loop must work.
