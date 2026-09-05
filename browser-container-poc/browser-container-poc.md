# Browser Coding Workspace POC

Research sketch, 2026-09-05. Addendum to [Admin OpenCode UI Editing Plan](./admin-opencode-edit-plan.md).
This explores replacing the Raspberry Pi with browser execution; it does not supersede that plan or select a runtime.
No candidate has been built or benchmarked against this repository yet. Capabilities below are upstream documentation
claims unless explicitly described as our proposal. Pin revisions and record actual results when running the POCs.

## What We Want To Learn

Can an administrator open an editing workspace, prompt a code change, see the existing frontend update, and retain the
source changes, with the coding harness and workspace executing on their own computer inside the browser?

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

## Repository Workload

The current [package scripts](../package.json) start both React Router and a Bun API with SOPS configuration.
[Vite](../vite.config.ts) uses React Router, Tailwind 4, and path-alias plugins, with Bun SSR conditions and an API proxy.
[React Router](../react-router.config.ts) enables SSR and prerendering. `bun dev` is therefore not the browser POC entry.

Reuse the original plan's frontend-only entry/provider boundary. Start with synthetic fixtures and actual application
components. Keep AWS/Clerk/IRS credentials, decrypted config, runtime databases, and deployment access out of the workspace.
Supply a reviewed source snapshot at a known commit; avoid private Git authentication in the first experiment.

The meaningful compatibility workload includes:

- React 19 TSX, `@/*` imports, local assets, and the existing component dependencies.
- React Router integration and its generated files, not only an isolated React hello-world.
- Tailwind compilation, including a newly introduced utility class after an edit.
- Module resolution, native dependency fallbacks, file watching, and preview asset delivery.
- A harness reading/searching files, applying a multi-file edit, observing a build error, and repairing it.

## Candidate Map

Priority is our proposed experiment order, not a maturity or performance rating. Links lead to primary sources.

| Candidate                                  | Execution model and licensing evidence                                                                                                                                                                                                                                                                  | Fit / first question                                                                                                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **container2wasm**                         | Converts container images into browser/WASI artifacts using emulators. Converter is Apache-2.0; guest and emulator components retain their own licenses. [Project](https://github.com/container2wasm/container2wasm), [license](https://github.com/container2wasm/container2wasm/blob/main/LICENSE).    | **Primary stock-harness track.** Package pinned OpenCode, Bun, Git, and frontend dependencies. Can the actual edit loop run comfortably?                                                                     |
| **QEMU WASM directly**                     | System emulation; the browser fork documents x86-64, AArch64, and RISC-V examples. Its status distinguishes interpreter support from ongoing WASM JIT upstreaming. [Project](https://github.com/ktock/qemu-wasm).                                                                                       | Use when container2wasm hides a needed option or backend. Record exact fork/backend; do not assume a stock QEMU release includes the same browser acceleration.                                              |
| **Bochs / TinyEMU through container2wasm** | Existing conversion backends: x86-64 via Bochs and RISC-V via TinyEMU. [Backend overview](https://github.com/container2wasm/container2wasm).                                                                                                                                                            | Cheap comparison if the conversion path is already working. Bochs is relevant to x64 binaries; RISC-V needs matching tools and is not a stock Bun target.                                                    |
| **Vivari**                                 | MIT repository; browser workers, Node's JS library code, virtual processes/files/networking. Advertises React Router, Tailwind, Vite/HMR, and Bun API emulation. [Project](https://github.com/maitrungduc1410/vivari).                                                                                  | **Primary lightweight-runtime track.** Promising overlap with our dependencies; prove the actual stack rather than accepting the compatibility table.                                                        |
| **almostnode**                             | JS Node API emulation with VFS, browser compilation, and preview support; [MIT license](https://raw.githubusercontent.com/macaly/almostnode/main/LICENSE). [Project](https://github.com/macaly/almostnode).                                                                                             | **Quick comparison.** Try the same component/route fixture as Vivari; inspect whether its dev-server behavior matches our needed plugins.                                                                    |
| **Wasmer SDK / WASIX**                     | Runs WASM-targeted programs with filesystem/process/port APIs; current SDK calls itself alpha. Includes browser shell and networking examples. [Project](https://github.com/wasmerio/wasmer-sdk).                                                                                                       | **Conditional second round.** Useful middle ground between JS emulation and a whole machine. Native Bun/OpenCode binaries do not become WASIX programs automatically.                                        |
| **NanoVM / userland.run**                  | RISC-V user-mode Linux emulation, plus additional execution runners. Emulator offers AGPL-3.0 or commercial terms; SDK is described separately as MPL-2.0. [Project](https://github.com/userland-run/nano), [license explanation](https://raw.githubusercontent.com/userland-run/nano/main/LICENSE.md). | **Exploratory second round.** Interesting syscall-emulation/hybrid approach. Check static-binary requirements, runner selection, and actual Node performance. RISC-V is a poor starting point for stock Bun. |
| **v86**                                    | BSD-2-Clause x86-to-WASM emulator; lacks 64-bit extensions and multicore. [Project](https://github.com/copy/v86).                                                                                                                                                                                       | Useful Linux/shell reference, low priority for this workload. Current [Bun platforms](https://github.com/oven-sh/bun) are x64/ARM64, so this is not a direct stock-harness route.                            |
| **Sandpack client bundler**                | Apache-2.0 browser bundler with documented custom `bundlerURL` setup. [Bundler repository](https://github.com/codesandbox/sandpack-bundler).                                                                                                                                                            | **Preview-only alternative.** Could accompany a custom agent loop. Prove current React/CSS behavior and self-host dependency delivery. Do not confuse it with Nodebox.                                       |
| **Custom file tools + esbuild-wasm**       | Assemble browser file/search/edit tools and a compiler instead of simulating an OS. esbuild documents a browser API. [API](https://esbuild.github.io/api/#browser).                                                                                                                                     | **Small baseline POC.** Tests whether we need a general shell/runtime at all. We own route/CSS/build integration and the harness.                                                                            |

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
  -> separate preview frame <- bridge for guest assets and updates
  -> existing AWS app: authenticated, bounded model relay
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
  -> existing AWS app: authenticated, bounded model relay
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
conversation/cancellation, build diagnostics, package resolution, and the supported editing surface. esbuild does not
automatically reproduce our React Router and Tailwind Vite plugins. Start with one real screen, then explicitly measure
the work needed for route changes and new CSS utilities. Do not quietly turn the preview into a separate application.

## Small POC Sequence

Suggested exploration order; timeboxes are effort caps, not delivery estimates. Stop a failing candidate with a concrete
blocker rather than building a general runtime compatibility layer.

| Trial                | Initial effort cap                 | Evidence to collect                                                                                                                    |
| -------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Shared fixture       | Half day                           | A secrets-free source snapshot and frontend-only entry that works in a normal local runtime. Use the same input for all candidates.    |
| Vivari               | Half day                           | Build/serve a real component and route, change a Tailwind class, observe update, reload saved files. Then probe headless OpenCode.     |
| almostnode           | A few hours                        | Run the same fixture; compare actual plugin behavior and required adaptations with Vivari.                                             |
| container2wasm/QEMU  | One day                            | Boot a prebuilt image; run Bun, stock OpenCode, file tools, and frontend build. Prove browser asset delivery before polishing HMR.     |
| Bochs backend        | A few hours, if already accessible | Repeat the same guest workload and compare timing/compatibility. Avoid a separate image-building project.                              |
| Custom compiler loop | Half day                           | Apply a scripted multi-file patch, rebuild, display diagnostics, fix the error, export the patch. Add the model only after that works. |
| WASIX / NanoVM       | Optional second round              | Only if initial results reveal a specific gap they could solve. First prove relevant toolchain binaries and license fit.               |

Do not require every trial before choosing. The interesting first comparison is **stock-harness fidelity versus browser
editing latency and integration effort**. Evaluate demos on public fixtures; load private source only into a reviewed,
self-hosted build. Keep all POC code optional and outside the normal application startup path.

### Common Editing Exercise

1. Load a fixed base revision and open a representative existing screen with fixture data.
2. Ask for a two-file UI change involving an imported component and a new Tailwind utility.
3. Check the diff and visible result. Introduce a deliberate import/type error and verify useful diagnostics/recovery.
4. Add or change a route, load a local asset, and reload a nested preview URL.
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

**Model access:** removing the Pi does not remove remote inference. Prefer a narrow authenticated model relay in the
existing AWS application, with fixed provider destinations, spending limits, and cancellation. Keep provider keys out
of the editable environment. This would add backend work beyond the original token-only endpoint; it is a proposed
tradeoff. The relay must not become an arbitrary URL proxy.

**Persistence:** keep a versioned base snapshot plus saved edits. OPFS is a possible implementation, but remains
origin-scoped, quota-limited browser storage; clearing site data removes it. Request persistence where supported and
provide explicit export/checkpoint recovery. Record base revision, file additions/deletions, and binary assets. Saving
source is separate from preserving VM RAM or conversations. [OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)

**Runtime lifetime:** assume tab suspension, browser crashes, and device sleep interrupt execution. Save incrementally;
do not rely on unload handlers. This replaces the Pi's persistent shared workspace with a per-browser workspace unless
we add synchronization. A small backend checkpoint store could restore cross-device continuity without hosting compute.

**Origin and header requirements:** test workers, WASM, service workers, and cross-origin isolation in the intended
embedding topology. Worker isolation alone does not strip access to same-origin services. Give runtime/preview code
separate origins from production credentials. Scope any service worker to a dedicated origin. If the original plan's
service-worker prohibition must change, change it only for the reviewed runtime transport, never production scope.
For comparison, [WebContainers documents embedding/header constraints](https://webcontainers.io/guides/troubleshooting);
each shortlisted implementation needs its own measured answer. A standalone editor page is an acceptable early POC,
but does not demonstrate the final embedded experience.

**Production reads:** fixtures only for these trials. Later, preserve the original plan's parent-owned authentication,
audited read allowlist, explicit activation, expiry, and exit behavior. Local execution removes the Pi as a data recipient,
but editable code still sees supplied data and may transmit it through allowed network paths. A VM alone does not
establish confidentiality from its own code or the model provider.

## Relationship To The Original Plan

| Original element                                 | Browser alternative to investigate                                                                                                       |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Pi + Compose + tunnel + Nginx                    | Static runtime/image artifacts, local browser execution, and explicit preview/network bridges.                                           |
| Remote gateway capability token                  | May become unnecessary for local control; server-side authorization still applies to model relay, source delivery, and production reads. |
| Persistent shared volume                         | Browser workspace plus export or backend checkpoints; shared ownership is a separate decision.                                           |
| Stock OpenCode                                   | Preserve in machine-emulation track; test compatibility or adapt/replace in lighter tracks.                                              |
| Direct dev-server HMR                            | Runtime-supported forwarding, or rebuild/reload for the initial custom-compiler experiment.                                              |
| Auth/provider cleanup and production-data broker | Still useful independent seams; retain before any real-data preview.                                                                     |
| Manual review/export, no automatic deployment    | Same promotion boundary.                                                                                                                 |

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

Working hypothesis: try **container2wasm/QEMU and Vivari first**, with **almostnode and a small custom compiler loop**
as inexpensive comparisons. Give **WASIX and NanoVM** a short breadth probe if their licensing and available packages
fit. Choose after exercising real workloads, rather than treating a Linux boot demo or a claimed Bun API surface as
the finished environment. The winning frontend POC and the most promising general-purpose box may be different.
