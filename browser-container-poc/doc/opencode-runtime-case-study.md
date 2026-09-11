# OpenCode case study: install upstream code, run it in Vivari

September 11, 2026. **Target workflow and investigation plan, not new acceptance.**

## End-state contract

An application installs or mounts upstream OpenCode and its dependencies, supplies
ordinary configuration, and launches its server command or supported entrypoint.
Vivari supplies compatibility when code executes: module loading, Node/Bun APIs,
filesystem, SQLite, networking, processes, and supported JS/WASM backends.
**There must be no prerequisite OpenCode- or dependency-specific package-hacking
script that rewrites the application into a form the runtime can execute.**

This is the desired default for supported JS/TS projects, not just OpenCode.
It is an end-state goal; today's qualified OpenCode delivery still uses such
scripts. Unmodified server source is progress, not completion of this contract.

## Expected application workflow

1. **Open the workspace and start a versioned runtime.** The embedding supplies
   the runtime distribution; application files have their own storage lifetime.
2. **Install or mount upstream files and dependencies.** Use pinned packages or
   upstream source with its lockfile and normal build, when one is required.
   Preserve package layout, exports, dynamic imports, assets and worker entries.
   A generic preinstalled dependency image/cache is acceptable; it must not hide
   package-specific source transformations. Guest installation and cache restoration
   are separate capabilities to qualify, not implied by successful execution.
3. **Configure the application.** Supply model access, workspace paths and upstream
   options. State disabled features explicitly. Provision any supported JS/WASM
   executable through ordinary installation/PATH or a runtime-owned compatibility
   mechanism, with its identity and limitations visible.
4. **Launch the upstream server path.** Prefer its normal command; otherwise use
   an exported server entry with a small invocation-only launcher. The launcher
   may supply options, but must not rewrite imports, replace tools or implement
   the server. Exact command and flags must be verified against the selected pin.
5. **Let the runtime load and execute the code.** Fix demonstrated compatibility
   failures in Vivari rather than adding a consumer-side source transform.
6. **Attach through Runtime/Endpoint.** Use the application's normal HTTP API and
   streaming behavior, then stop execution and flush/close storage explicitly.

No new installation API or copy-paste launch command is claimed here. The existing
packaged baseline remains the executable reference while this path is qualified.

## Import behavior: server execution must not require TUI execution

At OpenCode pin `d7a7256bb6b0952f486c95718cfbf460b1570a56`,
`packages/cli/src/index.ts` selects command handlers with dynamic imports, including
the default handler and `serve`. `server-process.ts` dynamically imports
`@opencode-ai/server/process`. This supports investigating ordinary lazy server
execution; it does not prove the complete eager startup graph is TUI-free.

- Static imports in a loaded module must resolve/link, even if their values are
  unused. Inspect shared eager imports when startup actually reaches a blocker.
- Dynamic imports should load/evaluate when their expression executes. An unused
  TUI branch must not force renderer/native compatibility merely because it exists.
- Whole-application dependency resolution is not a runtime startup requirement.
  An optional audit can report potential dependencies separately from observed
  execution; it cannot establish that unexecuted features work.
- Bundling, tree shaking and code splitting are optional delivery optimizations.
  Bundlers often inspect literal dynamic imports ahead of time; tree shaking does
  not guarantee elimination of build-time resolution failures. Correct lazy
  loading must work without a special bundle that removes unsupported branches.

## What is acceptable preparation?

| Preparation | Intended boundary |
| --- | --- |
| Build Vivari workers/WASM; publish a versioned runtime distribution | Runtime development/delivery |
| Fetch packages, restore a lockfile-based dependency image, copy assets with their normal layout | Generic installation/delivery |
| Run the application's ordinary upstream build | Normal application workflow; qualify its required tools separately |
| Runtime TS transpilation, module resolution and builtin shims | Reusable runtime compatibility |
| Runtime-owned JS/WASM backend selection | Explicit supported implementation, qualified independently; no arbitrary native-binary compatibility claim |
| Optional bundle/compression/integrity receipt | Delivery optimization; execution correctness must not depend on behavioral rewrites |
| Consumer script rewriting a dependency loader, lowering one package specially, or patching application imports | Transitional workaround to remove, not the supported end state |

Moving the same application-specific AST patch into a runtime hook is not by itself
a compatibility fix. Prefer standard API/loader semantics and reusable backends.
Any remaining narrow adapter must be visible, justified by a reproduction, and
tracked as an exception with a removal condition.

## Current baseline versus work to retire

The accepted P1 workflow uses clean Vivari `48d4ca1` and OpenCode `d7a7256`.
It verifies real model read/edit/grep/glob, HTTP streaming, clean shutdown and
session/edit retention across server-process restart within one runtime. It does
not qualify unbundled launch, page reload/full runtime reopen, or a newer OpenCode.

| Current mechanism | Direct-path investigation / removal condition |
| --- | --- |
| `package-opencode-server.ts`: custom ESM bundle, generated service launcher, constants, graph audit | Execute upstream source/dependencies or a suitable upstream JS artifact without this script; qualify source TS and package resolution. A normal native release launcher is not automatically a browser-runnable artifact. |
| Force `jsonc-parser` to its published ESM build | Run normal package resolution first. Determine whether the unresolved UMD requires were solely a bundler problem or expose a runtime defect. Remove consumer selection once the ordinary package works. |
| Manually enumerate WASM/package assets and pin a model snapshot | Preserve installed asset layout and use ordinary upstream configuration/fetching or reproducible generic asset delivery. Account for dependency restoration on reopen. |
| Disable FFF/filewatcher/snapshots | Retain explicit configuration for current qualification; separately qualify required features or record their unsupported capabilities. |
| Native-only optional modules left external | Verify they stay unloaded on the selected server path; a reached unsupported operation must fail usefully. |
| Ripgrep loader rewrite, host decompression, CJS lowering and `import.meta` substitution | Execute the original published JS/WASM package through the normal loader and compression APIs. Keep transformations only as documented baseline evidence until replacement passes. |
| Copy `rg` into OpenCode's binary cache | Fix executable permissions/discovery and qualify an ordinary installed `rg` command on PATH. |

### Ripgrep: run the published implementation

The pinned `ripgrep@0.3.1` loader first reads a temp-file WASM cache. On a miss it
dynamically imports its compressed payload, calls `node:zlib.brotliDecompressSync`,
writes the cache and compiles the bytes with WebAssembly. Its WASI implementation
is also dynamically loaded. These should use general filesystem, module,
compression and WASM facilities, rather than a rewritten package byte loader.

Qualify an empty cache and a warm cache, normal ESM/dynamic imports, argument and
exit-code fidelity, and the actual file-search operations OpenCode uses. The
existing published shim has stdin-as-EOF and unsupported `poll_oneoff`; do not
mistake a file-search pass for complete native ripgrep behavior.

OpenCode still needs an executable named `rg`. Installing a compatible JS/WASM
command or a small argv-preserving launcher is legitimate provisioning. Selecting
that implementation belongs in normal installation or reusable runtime support,
not a private OpenCode-cache hack. Node shims cannot execute a native Linux binary.

## Implementation and acceptance sequence

1. Inventory the original upstream launch/install path and assets at the pinned
   revision. Attempt direct unbundled server execution in a fresh workspace before
   assuming today's transforms are needed. Record real module-load failures.
2. Run the original ripgrep JS/WASM package with no loader edits or special
   CommonJS lowering, including cold-cache decompression and PATH discovery.
3. Reduce each blocker to a focused fork contract, compare native Node/Bun where
   applicable, fix general semantics, then retry in real browser workers. Record
   any remaining runtime adapter and disabled feature rather than hiding it.
4. Run the existing full OpenCode acceptance against the direct path: readiness,
   model SSE, read/edit/grep/glob, exact bytes, cancellation/streaming, clean exits,
   listener replacement and session/edit retention. Preserve its restart scope.
5. Reproduce from clean upstream files and the recorded lockfile/runtime revision,
   without running `package-opencode-server.ts` or `package-ripgrep.ts`. Check input
   integrity and explicitly report zero consumer behavioral transformations.
6. Qualify one newer OpenCode pin with the same workflow and record any necessary
   runtime changes. Only then claim evidence of easier upstream upgrades.
7. Retire the superseded compatibility transforms after direct-path acceptance;
   retain generic installation, delivery, receipts and useful regression tests.

Start this investigation alongside P2, ahead of P4's broader cleanup. Process
backpressure/cancellation work remains necessary regardless of packaging. A
required loader, compression or executable-discovery fix can move forward from
P3/P4 when it blocks the direct path.

## References

- [Main runtime cleanup plan](opencode2-server-runtime-cleanup.md)
- [Qualified server baseline and current exceptions](opencode2-server-baseline-handoff.md)
- [P1 streaming acceptance](runtime-http-stream-handoff.md)
- [Runtime development workflow](../vivari/DEVELOPMENT.md)
