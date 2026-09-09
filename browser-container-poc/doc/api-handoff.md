# Vivari API implementation handoff

Status: September 7, 2026. **Real backend v0 checkpoint implemented**; see
[`workspace-api/V0-HANDOFF.md`](../workspace-api/V0-HANDOFF.md) for code layout,
exact distribution commands/hashes, passing real-worker results, browser blockers
and ownership transfer to the fresh integration agent. Task cards below retain
their acceptance criteria. A1/A2/B1/C1/D1 have a working v0 backend slice in
`workspace-api` and the Vivari patch/build seam, with browser-only qualification
remaining. Runtime ownership is released to the parent's fresh integration agent.
Consumer commits are `196aec1` (now editable-app-demo) and `b02ac70` (OpenCode chat).

### Active public contract for parallel consumers

```ts
import { Workspace, Runtime, opfsStore, defineRipgrepTool, attachPreview }
  from "../workspace-api/src/index";
const manifest = await fetch('/runtime/distribution.json').then(r => r.json());
const distribution = { name: 'vivari', version: manifest.version, assetBaseUrl: '/runtime/' };
const workspace = await Workspace.open({ id: 'default', storage: opfsStore(distribution) });
const runtime = await Runtime.start({ workspace, distribution, tools: {
  ripgrep: defineRipgrepTool({ receiptUrl: '/tools/rg-receipt.json' }),
} });
await runtime.tools.ripgrep({ pattern: 'TODO', paths: ['/workspace'] });
// node({entry,args,cwd,env,signal}) / expose(port,{signal}) / attachPreview(frame,endpoint)
// Endpoint.fetch('/path', RequestInit) supplies real streaming Fetch responses.
// Stop runtime, then workspace.flush()/close(); same Workspace stays usable after stop.
```

Only workspace ID `default` is supported, with the existing one-origin OPFS lease.
Opening files needs the distribution for internal FS/supervisor workers, so it is
carried by `opfsStore(distribution)`. `Runtime.start` validates the same distribution.
Configured tools are **callable methods**, correcting A0's descriptor `.invoke`.
`Execution.exited` adds `{signal,forced}` to `exitCode`; separate single-reader byte
streams and `writeStdin`/`closeStdin` are supplied. `Endpoint.closed` resolves a reason.
No Bun method is advertised. Distribution delivery command (after patched build):
`bun workspace-api/scripts/distribution.ts <consumer-public-runtime-dir>`.
The command writes immutable assets and `distribution.json`; serve SW script with
`Service-Worker-Allowed: /`, COOP same-origin and COEP require-corp. Ripgrep delivery
uses the existing package-ripgrep receipt and all referenced assets. Browser gates
remain blocked by the disconnected Browser Control extension. Real-worker API and
complete upstream verification pass; this is not F1/F2 browser acceptance.
Read [api-plan.md](api-plan.md) first. It records the user's API direction and
separates existing implementation from proposed behavior.

## Start here

Start **A0**, then **A1**. The filesystem/runtime lifetime seam is the first real
design risk. Do not begin by rewriting the OpenCode demo or renaming `Vivari` to
`Workspace`; that would retain the ownership coupling the API is meant to remove.

Suggested initial implementation home (confirm in A0):

```text
browser-container-poc/workspace-api/
  src/                  public TS API and adapter interfaces
  src/browser/          preview/endpoint embedding integration
  src/tools/ripgrep/    first typed tool adapter
  examples/basic/       explicit launch + files + preview consumer
  tests/                focused real-runtime contracts
```

Use Bun + TypeScript and minimal functional UI. These paths are proposed and
not created by this documentation change. The library must consume an explicit
distribution/build output, not another demo's `node_modules` or private globals.

## Work graph and parallel ownership

```text
A0 contracts + source/distribution seam
 ├── A1 workspace/storage lifetime ── A2 durable flush/reopen
 ├── B1 execution streams + lifecycle (integrate with A1)
 ├── C1 endpoint/preview transport (integrate with B1)
 ├── D1 typed tool + bundle contract ── D2 cookbook/cache delivery
 └── E1 embedding/egress design

A1 + A2 + B1 + C1 + D1 ── F1 first public-API consumer acceptance
C1 + E1 ── C2 streaming Fetch + deployment isolation follow-through
F1 + C2 + D2 ── F2 OpenCode server/client recipe
```

Parallelize independent adapters/docs after A0 fixes shared types. **One owner at
a time** edits `vivari/patches/0001-sqlite.patch`, its `.runtime/patched` checkout,
worker protocol, and runtime build output. B1/C1/D1 may need that same owner:
prepare bounded protocol changes and integrate serially, or use isolated build
checkouts/worktrees with explicit patch integration. Distinct task names alone
do not make these files safe for parallel editing.

E1 design and D2 cookbook drafting can run independently. F1/F2 should start only
when their required contracts are implemented. No implementation agents were
launched by the planning session.

## Task cards

### A0 — Lock the smallest contracts and build seam

**Deliver:** public type skeleton and a short implementation mapping. Choose the
durable library source/distribution location; document how browser consumers
resolve worker/WASM/SW assets independently of the POC demos.

- Carry forward typed `runtime.node`, `runtime.tools.ripgrep`, filesystem-only
  Workspace, explicit program startup, and `expose(port)` without access classes.
- Settle launch/exit errors, stream ownership, endpoint closure, and attachment
  ownership. Keep open choices explicitly marked; do not silently enlarge scope.
- Record how existing startup logs/failure messages become structured state.
- Keep runtime distribution identity explicit; do not copy emitted workers into
  a new source tree and start editing them.

**Done:** a small consumer typechecks against intended public imports; a mapping
identifies real backend gaps rather than filling them with stubs that report
success. Compile-time check configured/missing tool inference. Update task status.

### A1 — Separate workspace lifetime from execution

**Depends:** A0. **Primary seam:** core FS API, bridge, FS/kernel workers.

**Deliver:** opening files without launching project programs; attaching one
runtime; stopping it while retaining usable filesystem access; explicit close.

- Trace current VFS/SAB clients and worker ownership before selecting topology.
- Internal storage/supervision workers may live with Workspace. Keep user program
  execution and storage lifetime independent; avoid duplicate authoritative VFSs.
- Establish workspace-root versus runtime-root mapping. Preserve watcher events
  for API writes, guest writes, rename and delete.
- Honor current one-origin persistence lease. Until store namespaces exist,
  reject unsupported simultaneous opens/IDs rather than silently sharing files.

**Done:** host API writes are visible in a guest module and vice versa; runtime
stop removes its executions but leaves the same Workspace readable/writable;
reattachment sees changes; closing an attached workspace has defined behavior.
Exercise binary files and actual watch/rename behavior against the real backend.

### A2 — Acknowledge durable writes and recovery

**Depends:** A1. **Primary seam:** OPFS persistence and FS-worker protocol.

**Deliver:** observable persistence state and a real `workspace.flush()` barrier.

- Propagate owner/init/write/quota failures to callers. Ephemeral operation must
  be explicit in state; runtime-ready must not imply persistence-ready.
- Define the accepted-write boundary the flush acknowledges. Preserve SQLite's
  existing separate durable-commit/quarantine contract.
- Flush is not an atomic multi-file checkpoint; record that distinction.

**Done:** browser reload/reopen preserves exact additions, edits, deletes and
binary bytes after acknowledged flush; injected write failure rejects; ownership
conflict is visible without deleting/staling another live workspace. Record
interruption recovery limits. Portable checkpoint/export remains a later task.

### B1 — Typed module execution and honest streams

**Depends:** A0; A1 for final integration. **Primary seam:** process API and worker
input/output protocol, kernel lifecycle, guest loader.

**Deliver:** `runtime.node({ entry, args, cwd, env })` and an Execution handle.
Add `bun()` only with its supported behavior documented and qualified.

- Bind the configured frontend directly; do not let project PATH shadow it.
- Extend the real bridge for byte-safe separate stdout/stderr. Wrapping merged
  strings as bytes cannot recover lost byte/channel information.
- Define stdin EOF, single readers, bounded queues/overflow, concurrent draining,
  launch acknowledgment, final output ordering, and idempotent stop.
- Preserve descendant cleanup and guest child-process compatibility. A public
  string `spawn()` wrapper can follow without blocking typed launch.

**Done:** real module reads/writes shared files; arguments/cwd/env are exact;
invalid entry rejects; exit 7 remains exit 7; split UTF-8 and arbitrary binary
stdio survive; large output stays bounded; stopping a parent removes descendants
and releases ports without killing sibling executions. Ordinary shell regressions
remain passing if the shared bridge changes.

### C1 — Endpoint handles and browser preview adapter

**Depends:** A0; integrate B1 lifecycle. **Primary seam:** bridge/listener events,
Service Worker routes, WS/SSE tunnels, browser adapter.

**Deliver:** `runtime.expose(port, { signal? })` and encapsulated preview attachment.

- Handle already-listening and future listeners without event races; add reliable
  listener close/identity wiring. Support cancellation and runtime-stop rejection.
- All supported listeners are eligible; no `access` enum or invented ACL.
- Associate routes/connections with runtime generation and listener instance.
  Prevent stale handles routing to a later process on the same numeric port.
- Keep private `vv-ws`/`vv-sse` forwarding out of consumer code. Validate message
  sender/connection ownership in the adapter. Coordinate origin design with E1.
- Handle fresh iframe Service Worker control; preserve same-document HMR. Endpoint
  readiness means listening, not Vite/OpenCode application-health completion.

**Done:** a plain module HTTP server works through its endpoint; two listeners
route independently; timeout, listener close and stop settle correctly; real Vite
edit/restore retains iframe Document identity. Detaching preview leaves Vite alive.
Run without host-side transforms or a host Vite process serving guest source.

### C2 — Streaming Fetch and client transport

**Depends:** C1; E1 for isolated embedding decisions.

**Deliver:** endpoint `fetch`/URL behavior suitable for a streaming HTTP client,
including cancellation, headers, status, request bodies and connection cleanup.

- Inspect the actual client protocol. EventSource polyfill success is not evidence
  for Fetch Response.body streaming: current preview HTTP buffers responses.
- Qualify repeated chunks before response completion and cancellation reaching
  the guest. Make payload limits and buffered-upload behavior explicit.
- Check prefix/base-path handling; do not hardcode OpenCode API paths into core.
- Integrate the chosen origin/message routing from E1 and verify it in browser.

**Done:** a generic server's binary response, error status, POST body and live
event stream work through the endpoint adapter; abort/stop closes the underlying
request; a fresh preview and a page-level client can coexist without cross-routing.

### D1 — First-class ripgrep and the minimal tool descriptor

**Depends:** A0; A1/B1 interfaces for execution/filesystem integration.

**Deliver:** configured `runtime.tools.ripgrep(options)` using the real packaged
ripgrep WASM. Its callable TypeScript API must not require public PATH lookup.

- Descriptor carries version/artifact requirements, typed binding, worker entry,
  and optional compatibility launcher files. Start with one tool, not a plugin
  framework. Keep runtime-build features separate from installable payloads.
- Support a bounded structured result, cancellation and explicit truncation.
- Reuse the existing ripgrep contract fixtures and underlying implementation.
- If offering `/bin/rg`, prove CLI and typed behavior agree. A missing launcher
  must not disable the configured typed API; a missing WASM artifact must fail.

**Done:** real positive/no-match/invalid-regex, ignore/glob, Unicode/binary and
modified-file checks; typed API works even with a shadowing `rg` on project PATH;
no expensive search on the browser main thread. Typecheck absent-tool rejection.

### D2 — Bundle delivery, upgrades, and copy-paste cookbook

**Depends:** D1 contract for installer implementation; drafting can start earlier.

**Deliver:** minimal verified bundle installation plus four recipes from
api-plan.md. Distinguish runtime distribution, tools, dependencies and user data.

- Extract hash/chunk delivery from existing packaging rather than inventing a
  second format without cause. Validate archive entries before live mutation.
- Record runtime/patch/toolchain and lock/config identities; account for path-
  sensitive prepared caches. Document source versus cache persistence.
- Stage install/update and define ownership/conflict behavior; do not overwrite
  unknown/user-edited files. Failed installs must not become the active release.
- Demonstrate one controlled tool version change. Keep assets for active builds.
- FFI recipe includes manifest, allocator exports, struct ABI, pointer/callback
  lifetime, bounded memory, and real worker checks for both offered facades.

**Done:** first install, matching reuse, corrupt/missing asset, incompatible
version, interrupted update and user-file conflict have explicit results. A new
agent can follow one recipe from source to a real guest invocation and receipt.
Broader dependency-cache replacement can be split into a follow-up with ownership.

### E1 — Embedding origins and network authority

**Depends:** A0 interfaces; independent design work.

**Deliver:** concrete origin/storage/SW/message topology and a small follow-through
task list. Preserve the simple `expose(port)` API.

- Identify trusted host UI, runtime bootstrap/workers and untrusted preview
  origins; show COOP/COEP and credential placement for each.
- Trace direct worker fetch, Node HTTP/HTTPS, preview subresources/navigation,
  WebSockets, host alias and provider proxy. One fetcher wrapper is insufficient.
- Specify endpoint/connection sender validation, workspace identity, and gateway
  caller authorization/budgets. Environment variables only configure addresses.
- State the disclosure allowed through model access; destination restriction is
  not a promise that workspace content stays local.

**Done:** proposed deployment can route an iframe and page-level HTTP client while
keeping preview code away from parent runtime handles/credentials; concrete tests
cover wrong sender, wrong runtime, unauthorized proxy calls and nonallowed egress.
Distinguish implemented enforcement from design. Implement via bounded follow-up
cards, coordinated with C2; do not label the existing demo secure.

### F1 — First standalone API consumer

**Depends:** A1, A2, B1, C1, D1.

**Deliver:** minimal file editor/readback, ripgrep invocation, explicit Start/Stop
Vite, preview, and save/reopen state. No shell is required.

**Done:** opening workspace/starting runtime launches no project applications;
only explicit action runs Vite; public API write produces real same-document HMR;
stop/restart works; files survive acknowledged flush/reload; binary file roundtrip
and tool query pass. Consumer imports no sibling `node_modules`, `.runtime`
checkout, raw bridge messages or `window.demo`. Record reproducible commands and
actual asset hashes. Existing OpenCode demo migration is a separate scoped change.

### F2 — OpenCode as an ordinary application recipe

**Depends:** F1, C2, D2; gateway setup from E1 where model access is used.

**Deliver:** pinned matched application bundle, explicit module/server launch,
provider config/environment, endpoint, and matching HTTP client example. Optional
application-state mount is explicit and separate from project source.

**Done:** generic endpoint health and real client events work; a session operates
on the attached project; server stop/restart preserves supported durable state;
a model edit reaches Vite HMR when provider availability permits. Record 429 or
other external failures separately from transport success. Terminal TUI is not
required for this client/server gate. Load the OpenCode skill and current V2
client/API docs; reconcile those with the pinned application's actual protocol.

## Copy-paste agent assignment

Fill in one task and its file ownership before launching a session:

```text
Implement TASK_ID from browser-container-poc/doc/api-handoff.md.
Read api-plan.md and applicable AGENTS.md first. Preserve the agreed JS-first
API: filesystem-only Workspace; explicit Runtime/module launch; configured typed
tools; expose(port) is connectivity, with no access-type enum. Do not start
unrelated tasks or redesign these boundaries implicitly.

Owned paths: EXACT_PATHS. Shared runtime patch/build owner: OWNER_OR_NONE.
Prerequisites/commits: VERIFIED_INPUTS. Worktree/build directory: DIRECTORY.
Implement the smallest real slice and its task-card acceptance criteria. Where
backend support is missing, report it rather than return fabricated success.
Record public API changes, source/build identities, exact commands/results,
remaining gaps and the next dependent task. Scope staging/commits to your files
and follow applicable commit instructions. Preserve existing user data and live
runtimes. Use Browser Control through the Bun-backed CLI for browser acceptance.
```

## Source map and verification conventions

Paths below are relative to `browser-container-poc/`:

| Topic | Start reading |
| --- | --- |
| Existing API | `vivari/.runtime/patched/packages/core/src/{types,vivari,process,fs,bridge}.ts` |
| Worker ownership | `vivari/.runtime/patched/packages/core/src/workers/`, upstream `ARCHITECTURE.md` |
| Command lookup | `vivari/.runtime/patched/packages/kernel-host/kernel.js` (`resolveProgram`, `installCoreutils`) |
| Persistence/cache | `packages/kernel-host/{opfs-persistence,dep-cache}.js` in that checkout; FS worker |
| Browser transports | `packages/core/src/bridge.ts`, `packages/studio/public/sw.js` in that checkout |
| Durable runtime changes | `vivari/patches/0001-sqlite.patch`, `vivari/scripts/build-runtime.ts` |
| Tool example | `vivari/scripts/package-ripgrep.ts`, `vivari/probes/runtime/ripgrep-contract.cjs` |
| FFI example | `vivari/scripts/build-ffi-probe.ts`, `vivari/probes/runtime/ffi-{library.c,contract.cjs}`, `doc/vivari-ffi-results.md` |
| Terminal adapter | `vivari/src/shell-sessions.ts`; process/shell/terminal probes in `vivari/scripts/` |
| Existing application glue | `terminal-agent-demo/{main.ts,build.ts,serve.ts}` |
| Provider gateway | `vivari/scripts/model-proxy.ts` |

- `.runtime/patched` is a generated, ignored working checkout. Preserve durable
  source changes through the established patch/build workflow until A0 explicitly
  replaces it. Do not edit emitted workers or installed dependency files as source.
- Read upstream `ARCHITECTURE.md` and relevant roadmap entries before changing
  runtime/protocol. Follow its required documentation and verification workflow.
- For runtime/protocol changes, run the complete upstream headless verification
  with real Node (check that `node` is not a Bun shim), plus focused real-worker
  contracts. Qualify browser-only OPFS/SW/iframe/HMR behavior in a real browser.
- Use explicit fresh test origins/storage identities for destructive failure
  probes. Do not clear or steal a live workspace lease to make a test pass.
- Preserve evidence of exact builds, errors and failed gates. A passing typecheck,
  import, mocked transport or startup log is not end-to-end application acceptance.
- Give the next agent a short task result: commit, owned files, API delta,
  commands/results, live resources if any, unresolved behavior, next task ID.

## Deferred follow-ups

- Portable versioned workspace export/import and coherent multi-file checkpoints.
- Multiple persistent workspace namespaces and carefully defined concurrent access.
- Full dependency-cache integrity/concurrency overhaul after D2 defines identities.
- React provider/hooks around existing ownership, not component-owned processes.
- Richer PTY/terminal semantics, sustained OpenTUI allocation/latency work.
- Hybrid/Linux backends behind proven filesystem/execution seams, after their
  ownership, persistence and semantic differences are explicit.
