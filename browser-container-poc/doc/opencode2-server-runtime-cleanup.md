# OpenCode2 server: runtime cleanup plan

Date: September 10, 2026  
Status: P0a fork migration, P0 baseline and P1 HTTP bridge accepted; P2–P5 backlog

## Goal and scope

Run the OpenCode2 server in Vivari with as little application modification as
possible, using that workload to make the general runtime's filesystem,
execution, HTTP, module-loading, and storage interfaces dependable.

The target tool profile is dedicated read, edit, grep, and glob; JavaScript
execution; and structured program execution with explicit argv. Do not advertise
an incomplete shell to the model. Audit internal shell dependencies before
removing runtime support that upstream code may still invoke.

The todo app, IRS tools app, and terminal UI are outside this milestone. Broad
FFI development is driven only by demonstrated server requirements.

Prefer, in order:

1. Run the original package.
2. Correct the missing runtime API or semantics.
3. Automatically select and deliver a compatible upstream JS/WASM implementation.
4. Use a narrowly scoped, version-checked package adapter with recorded limitations.

Configuration and asset packaging are acceptable. Track source patches,
consumer dependency overrides, and behavioral build transformations explicitly,
and reduce them as platform fixes land.

## Current architecture and cleanup assessment

These findings were checked against source during the planning conversation.
They are not a new browser acceptance run. Paths below are relative to
`browser-container-poc/`; runtime source references use
`vivari/.runtime/patched/packages/`. That generated checkout is a source reference,
not an instruction to make durable changes only there.

### Filesystem: retain the architecture, improve contracts

```text
OpenCode → node:fs / node:fs/promises
         → vendored Node JS filesystem implementation
         → Vivari internalBinding('fs')
         → shared-memory syscall bridge
         → filesystem worker → Rust/WASM VFS
                             → OPFS persistence

Browser embedding → workspace.fs
                  → host-to-worker RPC
                  → the same filesystem service / VFS
```

The guest and embedding APIs are different entrances into the same filesystem.
This is a sound boundary and does not depend on the public FFI facade.

Some asynchronous filesystem operations still execute synchronous,
worker-blocking syscalls and defer only their callbacks. Heavy filesystem work
can therefore stall the guest event loop. Host RPC also reconstructs generic
errors, losing structure; `workspace.fs.stat()` synthesizes an ENOENT message.

Sources:

- `workspace-api/src/workspace.ts`
- `workspace-api/src/host.ts`
- `vivari/.runtime/patched/packages/runtime/node/bindings/fs.js`

### HTTP: replace the process-per-request adapter

**Historical assessment; replaced by P1 on September 11.** The following diagram
describes the old adapter. See [P1's handoff](runtime-http-stream-handoff.md) for the
qualified runtime-owned bridge and its streaming/shutdown contracts.

```text
Browser OpenCode client
  → Endpoint.fetch()
  → write a temporary guest HTTP-client script
  → launch a Node process for this request
  → node:http.request() → OpenCode's guest HTTP listener
  → response metadata and bytes written to stdout
  → browser reconstructs Response
```

This uses real guest HTTP and streams response bytes, but has POC compromises:

- Every request launches a process, including short API calls.
- Uploads are buffered and base64-encoded into argv.
- The 8 MiB upload check occurs after reading the complete body into memory.
- Response metadata is framed into stdout.
- The relay writes response chunks without handling stdout `write()` returning
  `false`.
- Slow readers eventually hit execution output limits instead of applying
  complete end-to-end backpressure.
- `runtime.expose()` registers the preview Service Worker even for programmatic
  HTTP use.

Sources:

- `workspace-api/src/browser/endpoint.ts`
- `workspace-api/src/runtime.ts`

### Execution: retain the API shape, complete stream semantics

```text
runtime.node({ entry, args, cwd, env, signal })
  → process worker
  → stdout / stderr byte streams
  → stdin writes / EOF
  → exit result / stop
```

The current interface tracks executions, preserves binary output, and stops
owned processes during runtime shutdown. Output credits implement bounded
retention with failure on overflow, rather than complete producer backpressure.
Host `writeStdin()` is fire-and-forget.

Source: `workspace-api/src/execution.ts`.

### SQLite: replace the request mailbox, preserve durability safeguards

```text
OpenCode → node:sqlite facade
         → JSON request in a temporary VFS file
         → OP_SQLITE(file path)
         → SQLite WASM in filesystem worker
         → JSON result file
```

The mailbox adds filesystem operations and serialization to every exchange.
The facade represents statements using SQL text rather than retained backend
prepared-statement handles. Whole-database snapshot persistence is a separate
scaling concern.

Retain the existing ownership, process-exit rollback/release, acknowledged
persistence, and failure quarantine while improving the transport and execution
costs. A best-effort VFS write must not become a claimed durable database commit.

Sources:

- `vivari/.runtime/patched/packages/runtime/builtins/sqlite.js`
- `vivari/.runtime/patched/packages/kernel-host/sqlite-server.js`

### FFI: a separate, bounded facility

```text
Guest imports bun:ffi / node:ffi
  → reads explicit .ffi.json manifest and WASM through node:fs
  → instantiates library inside the process worker
  → calls WASM directly
```

FFI uses the filesystem to load artifacts. The filesystem does not use this FFI
facade, and SQLite has its own service. The VFS being implemented in Rust/WASM
does not make it a consumer of the public FFI API.

The current OpenCode V2 packager initializes OpenTUI for its CLI delivery and
includes renderer-related transforms. Isolate the server graph before treating
those requirements as server requirements.

Sources:

- `vivari/.runtime/patched/packages/runtime/builtins/ffi.js`
- `vivari/scripts/package-opencode-tui.ts`
- `opencode-chat/src/prepare.ts`

## Prioritized implementation backlog

### P0a — Make the runtime a directly editable fork

**Completed September 10, 2026:** the cumulative runtime patch has been removed;
the fork is published, active source/build/test paths are migrated, and native,
headless, and browser contract checks pass. See the
[migration receipt](runtime-fork-migration.md) and
[development workflow](../vivari/DEVELOPMENT.md). P0 acceptance is recorded below;
P1 is now accepted; P2–P5 remain future work.

Do this before substantial runtime changes. Maintain Vivari changes as ordinary
source commits rather than regenerating a cumulative patch.

Before migration, the workflow had three tracked patches under `vivari/patches/`:

- `0001-sqlite.patch`: cumulative runtime changes across several subsystems.
- `opencode-v2/0001-optional-process-metrics.patch`: changes only the TUI
  devtools component; investigate eliminating it from server-only packaging.
- `opentui/0001-wasm.patch`: renderer port, outside the server milestone.

The separate `qemu/guest/qemu-popcnt.patch` belongs to another experiment.

`vivari/scripts/build-runtime.ts` clones a pinned upstream revision into ignored
`.runtime/baseline` or `.runtime/patched`, applies the runtime patch, and rejects
working-tree edits unless they exactly match that patch. Several probes import
directly from `.runtime/patched`. This is reproducible packaging, but an awkward
source-development loop: ordinary source edits cannot simply be rebuilt.

Recommended destination: a dedicated Vivari Git fork with a normal working
checkout, preserving upstream history and an `upstream` remote. Configure the
embedding project to consume that local checkout for development and a pinned
fork revision/distribution for reproducible qualification. Repository ownership,
remote URL, and checkout location must be selected before executing migration.

- [x] Inventory tracked, untracked, and ignored changes in existing runtime
  checkouts; preserve work that is not represented by the saved patch.
- [x] Create the fork from the recorded upstream base and import the current
  runtime delta as an ordinary commit. Record provenance and retain licensing.
- [x] Establish one canonical source path, configurable for local development;
  remove direct `.runtime/patched` imports from active probes and build scripts.
- [x] Make development builds accept normal working-tree edits. Reproducible
  release/qualification builds identify the exact committed source revision.
- [x] Replace patch hashes in build receipts with fork revision, upstream base,
  toolchain/lockfile identifiers, asset hashes, and development dirty-state
  provenance where applicable.
- [x] Split fast JS/worker rebuilds from Rust/WASM rebuilds; reuse unchanged WASM
  artifacts while reliably rebuilding them after Rust or toolchain changes.
- [x] Keep build outputs, download caches, and retained hashed assets separate
  from editable source. Preserve assets needed by running kernels.
- [x] Provide documented commands for setup, development, build, focused runtime
  contracts, and browser/server qualification.
- [x] Put generic runtime regression tests beside the fork's implementation;
  keep OpenCode delivery and end-to-end qualification in this integration repo.
- [x] Update agent instructions and architecture docs to make the fork the source
  of truth, replacing the patch-regeneration workflow.
- [x] Reproduce the baseline from the fork, then remove the cumulative runtime
  patch and active patch-application path. Historical Git commits retain it.

**Acceptance:** edit a runtime source file, rebuild, run its focused contract,
and exercise OpenCode without generating or applying a patch. A fresh checkout
can reproduce the qualified distribution from its recorded fork revision.

Treat upstream merges as deliberate upgrades followed by qualification, rather
than automatically rebasing the fork during builds. Preserve useful history;
there is no need to discard upstream ancestry to own the runtime development.

Tool development should remain simpler than runtime development: use OpenCode's
supported tool extension surface for guest tools, and the existing workspace
tool descriptor mechanism for host-bound helpers where appropriate. A tool that
uses supported files, execution, or JS/WASM packages should not require a kernel
change. Keep the server packager and one small tool example discoverable.

### P0 — Establish a server-only baseline

**Accepted September 10, 2026:** the complete fresh-origin browser workflow passed:
server readiness/session creation, real model SSE, read/edit/grep/glob, exact edited
bytes, two clean graceful exits, new service/listener identities, old-endpoint
rejection, and session/edit retention across server restart. Clean runtime source
`bd5a60c` is now the qualified pin. See [the implementation handoff](opencode2-server-baseline-handoff.md).

- [x] Create an OpenCode2 server-only packaging and launch path using the pinned
  upstream server entry or closest supported entry. The inspected V2 packaging
  pin is `d7a7256bb6b0952f486c95718cfbf460b1570a56`.
- [x] Remove packaging dependencies on renderer initialization, Solid transforms,
  and OpenTUI scratch adapters where the server graph permits.
- [x] Record remaining source patches, native dependencies, behavioral transforms,
  asset requirements, and special launch flags.
- [x] Deliver all required assets into a fresh workspace, including the search
  runner; do not rely on previous standalone tool provisioning.
- [x] Verify actual server readiness, session creation, one model response, and
  one filesystem tool call.

**Acceptance:** the server's actual runtime requirements are known and a fresh
workspace demonstrates a useful server workflow. An import or zero exit code is
not acceptance.

### P1 — Replace the HTTP process relay

**Accepted September 11, 2026:** clean runtime `48d4ca1` passes the browser HTTP
streaming suite and complete OpenCode regression (including both graceful stops
and server restart retention). See [the P1 handoff](runtime-http-stream-handoff.md).

Introduce a runtime-owned streaming HTTP bridge bound to a specific listener
identity. Investigate its attachment point in the existing guest networking
machinery before selecting the implementation.

```text
Endpoint.fetch()
  → request channel
  → runtime networking bridge
  → existing guest HTTP listener

Separate messages:
  request metadata / body chunks / EOF
  response metadata / body chunks / EOF
  cancellation / error / flow-control acknowledgments
```

- [x] Remove temporary scripts, argv payloads, and stdout framing from Endpoint.fetch.
- [x] Remove per-request program launches.
- [x] Provide bounded request and response streaming.
- [x] Propagate slow-reader pressure toward the producer.
- [x] Make abort close the actual guest request/connection.
- [x] Invalidate old endpoints and active requests predictably on server restart.
- [x] Allow programmatic HTTP without preview Service Worker registration.
- [x] Exercise JSON responses, SSE, binary bodies, early disconnects, mid-body
   failures, and concurrent requests.

Node server.close() retires the endpoint but drains accepted responses; bridge
requests keep the process loop alive until completion. Process exit and listener
replacement fail remaining channels. Legacy preview HTTP and cross-process pipe/
execution transports retain their separate semantics; P2 is still needed.

**Acceptance:** a long-lived event stream and concurrent API calls work with
bounded queues and correct cleanup. Preserve OpenCode's normal HTTP handling;
do not replace it with a bespoke in-memory invocation of its router.

### P2 — Tighten process and stream semantics

- [ ] Define asynchronous stdin writes and EOF acknowledgment.
- [ ] Implement and qualify producer backpressure across worker boundaries.
- [ ] Keep explicit output quotas separate from flow control.
- [ ] Guarantee final-output and exit/close ordering.
- [ ] Distinguish launch failure, normal exit, cooperative interruption, and
  forced termination.
- [ ] Verify child-tree cleanup for host launches and guest `child_process`.
- [ ] Make noninteractive execution report appropriate stdio/TTY behavior.

**Acceptance:** JS and subprocess tools cannot silently truncate data, hang on
EOF, or leave workers behind after cancellation.

P1 and P2 should share byte-channel mechanics where useful, while keeping HTTP
metadata separate from program stdout. A bounded queue alone is not proof of
end-to-end backpressure.

### P3 — Clean up filesystem and SQLite contracts

Filesystem:

- [ ] Preserve structured errors across host RPC: `code`, `syscall`, `path`, and
  destination where applicable.
- [ ] Verify host and guest edits see the same bytes and produce required watch
  notifications.
- [ ] Qualify large-file chunking, rename behavior, descriptors, and executable
  discovery semantics exercised by OpenCode.
- [ ] Specify the guarantees of ordinary writes, guest sync operations, and
  `workspace.flush()`.
- [ ] Measure event-loop stalls under realistic read/search workloads before
  expanding asynchronous syscall support.

SQLite:

- [ ] Replace the temporary-file mailbox with a bounded, chunk-capable service
  protocol that preserves synchronous public API behavior.
- [ ] Introduce service-owned prepared-statement handles and reliable finalization.
- [ ] Avoid snapshot/flush work for genuinely read-only operations.
- [ ] Measure database growth costs before choosing a larger persistence redesign.
- [ ] Preserve rollback, ownership release, acknowledged durability, and quarantine
  after persistence failure.

**Acceptance:** history survives restart, storage failures remain visible, and
ordinary reads avoid unnecessary persistence work. Large transfers must respect
the shared-memory syscall window rather than assuming arbitrary payload size.

### P4 — Reduce server-specific environment adaptations

- [ ] Reduce remaining module failures to focused runtime reproductions: package
  exports conditions, module identity, dynamic imports, `import.meta`, and TLA.
- [ ] Remove corresponding packaging transformations as runtime fixes land.
- [ ] Centralize delivery of required JS/WASM substitutes and their assets.
- [ ] Audit the server's actual internal shell calls and record their disposition.
- [ ] Make guest-loopback and outbound-network routing explicit and consistent
  across the APIs OpenCode uses.
- [ ] Verify outbound model streaming and abort independently of inbound client SSE.

**Acceptance:** the server runs with fewer behavioral rewrites, and unsupported
runtime behavior produces useful errors.

### P5 — Plug in the JavaScript-first tool profile

- [ ] Retain dedicated read, edit, grep, and glob tools.
- [ ] Provide JavaScript execution in an owned guest process.
- [ ] Provide structured program execution with explicit argv.
- [ ] Remove shell from the model-facing tool profile and align environment
  instructions with the actual capabilities.
- [ ] Reuse OpenCode's tool lifecycle and permissions through its supported
  extension surface, verified against the pinned revision.

**Acceptance:** the model reads, edits, runs a check, diagnoses failure, fixes it,
and reruns successfully. Interruption and restart are included in qualification.

## Intended public boundary

Design reference: [runtime API comparison](runtime-api-comparison.md) reviews
Nodepod, WebContainers, ZenFS, and emnapi against the current APIs. It recommends retaining
these ownership boundaries, with concrete P1/P2 transport decisions and a P3
filesystem semantics table. These recommendations are design input, not completed
implementation or browser qualification.

```text
Workspace: files + persistence lifetime
Runtime:   process ownership + execution + service endpoints
Endpoint:  HTTP requests + streaming + cancellation
OpenCode:  sessions + agent loop + tool registration
```

Keep the public shape close to what exists. The substantive cleanup is beneath
it: HTTP stops masquerading as process output; SQLite stops using files as
request envelopes; streams gain flow control; and operations have explicit
ownership and failure behavior.

Preserve the distinction between cancelling an HTTP subscription, interrupting
an agent session, stopping a process tree, stopping a runtime, and closing its
workspace/storage lifetime.

## Execution order and verification

See [Node compatibility testing](node-compatibility-testing.md) for proposed
wiring of a pinned upstream Node test subset into real Vivari guest execution,
with reference-Node runs, explicit outcome reporting, and browser qualification.
Establish a small trustworthy baseline alongside P0; expand relevant regression
gates through P1–P4. This complements the focused and application contracts below.

Start with P0a and P0, then implement the HTTP bridge and shared stream mechanics in
P1/P2. Use demonstrated server blockers to prioritize P3/P4; do not postpone a
required correctness fix merely because it appears in a later section.

For each change, use focused runtime contracts and real Node/Bun comparisons
where applicable, then headless workers and real-browser qualification. Browser
checks are essential: Node workers can expose capabilities and scheduling
behavior unavailable in browser workers. Follow the runtime's local architecture,
durable-patch, documentation, and verification instructions during implementation.

Final qualification should include:

- A fresh-workspace server and complete tool delivery.
- Repeated model/tool cycles with concurrent HTTP streams.
- Slow readers/writers, cancellation, process exits, and listener replacement.
- Session/database growth, reload recovery, and injected storage failure.
- Worker/connection/queue accounting after repeated operations and shutdown.
- One newer OpenCode pin, recording which adaptations need changes.

Track passing workflows and remaining source patches, consumer overrides,
behavioral build transforms, and platform adapters. Patch size and API count are
not compatibility metrics. Set measured performance budgets from the baseline
rather than inventing estimates during planning.
