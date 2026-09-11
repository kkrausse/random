# Runtime API comparison: Nodepod, WebContainers, ZenFS, and emnapi

Date: September 10, 2026  
Status: Design research and recommendations; proposed contracts are not implemented

## Recommendation

Keep the cleanup plan's **Workspace → Runtime → Endpoint** ownership boundaries.
Borrow simpler setup and familiar filesystem options from other SDKs, while
completing the streaming, coherence, and persistence contracts underneath ours.

The highest-value next design artifact is a small P1/P2 transport contract:
listener identity, request lifecycle, byte credits, cancellation, and cleanup.
Accompany it with a filesystem semantics table for P3. A broad SDK redesign is
not necessary to make progress.

This review compares source and public documentation, not runtime performance or
browser acceptance. Nodepod source was inspected at
[`10266efb66e9f1ead1853f6a8519a2606b4a77d0`](https://github.com/R1ck404/Nodepod/tree/10266efb66e9f1ead1853f6a8519a2606b4a77d0).
WebContainers findings concern its documented public API; its internal transport
was not inspected. ZenFS findings use its current README and Port backend source.

## At a glance

| Concern | Ours today | External reference | Recommendation |
| --- | --- | --- | --- |
| Ownership | Persistent Workspace, attached Runtime, owned Execution/Endpoint | Nodepod and WebContainers offer one booted facade | Retain separate lifetimes; put convenience in an optional startup recipe |
| Host filesystem | Small async, workspace-rooted API | WebContainers models `fs.promises`; Nodepod adds conveniences | Specify familiar options and errors, with explicit path mapping |
| Filesystem authority | Host and guest enter the same filesystem service | Nodepod has MemoryVolume, shared read access, and worker synchronization paths | Preserve one authoritative service; qualify coherence before adding caches |
| HTTP | Fetch-shaped endpoint; process-per-request relay | Nodepod has direct programmatic request dispatch without preview SW | Adopt direct runtime ingress, retaining streaming `Response` semantics |
| Server discovery | `expose(port)` waits for a listener and binds its identity | WebContainers has `port` and `server-ready` events | Retain listener-bound handles; distinguish listening from application health |
| Process I/O | Separate byte iterables; fire-and-forget stdin | WebContainers exposes Web Streams for terminal text; Nodepod emits strings | Keep binary stdout/stderr; add acknowledged input and producer flow control |
| Delivery/export | Explicit prepared assets and OPFS flush | WebContainers mount/export; Nodepod snapshot/restore | Consider explicit import/export later; keep it distinct from durability |
| Storage backends | Rust/WASM VFS and OPFS persistence | ZenFS separates Node-facing API, mounts, and backends | Use this separation as a design reference for future mounts |

## 1. Nodepod: closest end-to-end comparison

### Public shape

The SDK presents `Nodepod.boot({ files, workdir, serviceWorker })`, `fs`,
`spawn(command, args, options)`, `request(port, options)`, `port(number)`,
`snapshot()`, `restore()`, and `teardown()`. This is approachable: one object
answers “where are my files, how do I run something, how do I reach its server?”

Our separate Workspace and Runtime are useful for keeping files alive through a
server restart. A recipe can provide similarly short startup without moving
storage ownership into a process-oriented object. Today these are public lifetime
boundaries, not independent backend instances: Workspace opens the Host, and
Runtime attaches to that Host using a matching distribution.

### HTTP: borrow the separation, design the streaming ourselves

`Nodepod.boot({ serviceWorker: false })` supports programmatic HTTP. In the
inspected source, `request()` converts the supplied body to an ArrayBuffer and
calls the instance-scoped request proxy. It returns `CompletedResponse`.
The worker HTTP ingress awaits `server.dispatchRequest()` and posts response
metadata and a complete response body back to the host.

That is a useful example of **runtime ingress independent of preview**, but this
path is not a template for an indefinitely open SSE response or streamed upload.
Our `Endpoint.fetch(): Promise<Response>` is already a better public fit for the
server client; P1 should replace its internals.

Proposed flow:

```text
Endpoint.fetch(path, init)
  → runtime ingress, addressed to listener identity
  → existing guest HTTP implementation
  → response headers followed by byte chunks

Preview attachment
  → Service Worker / iframe adapter
  → runtime networking ingress where applicable
```

Preserve normal guest HTTP handling. Nodepod's `dispatchRequest` belongs to its
HTTP implementation; it is not evidence that we should invoke an application's
router directly. The Vivari attachment point still needs investigation.

### Filesystem: familiar facade, different coherence model

Nodepod's `NodepodFS` is an async facade over synchronous MemoryVolume operations.
It provides encoding-aware reads, recursive mkdir/rm options, stat metadata, and
path-scoped watches. Its `writeFile` automatically creates parent directories.
That last behavior is convenient but differs from Node's ordinary `writeFile`.

The separate `NodepodFSClient` reads shared memory from sibling workers and rejects
writes with `ENOTSUP`, directing writes back to the owner. Process-worker source
also contains VFS synchronization and snapshot-loading paths. These are distinct
paths, not a claim that every Nodepod filesystem operation is shared-memory RPC.

Our shared filesystem service avoids making replicated worker trees the central
contract. Keep that advantage. An async method signature alone does not establish
that work is nonblocking: this is visible in Nodepod's facade and is also a concern
for our guest async filesystem implementation.

### Processes and snapshots

Nodepod's process handle emits text output, exposes `write(string)`/`kill()`, and
resolves completion with stdout/stderr strings and an exit code. The inspected
implementation trims retained output strings above its configured threshold.
This is convenient for command summaries but not our desired binary transport or
complete-output contract. Keep collection as an explicit, size-limited helper
above the underlying streams.

Its shallow snapshot excludes `node_modules`, `.cache`, and `.npm`; restore can
automatically install dependencies. This reinforces the useful distinction
between authored files and redeliverable dependencies. For us, export, restore,
dependency delivery, and `flush()` should have separately stated effects so
restoring source does not implicitly become package installation or database reset.

Source references at the inspected revision:

- [`src/sdk/nodepod.ts`](https://github.com/R1ck404/Nodepod/blob/10266efb66e9f1ead1853f6a8519a2606b4a77d0/src/sdk/nodepod.ts): boot, request, spawn, snapshot/restore.
- [`src/sdk/nodepod-fs.ts`](https://github.com/R1ck404/Nodepod/blob/10266efb66e9f1ead1853f6a8519a2606b4a77d0/src/sdk/nodepod-fs.ts): host filesystem facade.
- [`src/sdk/nodepod-fs-client.ts`](https://github.com/R1ck404/Nodepod/blob/10266efb66e9f1ead1853f6a8519a2606b4a77d0/src/sdk/nodepod-fs-client.ts): shared reader and ownership restriction.
- [`src/sdk/nodepod-process.ts`](https://github.com/R1ck404/Nodepod/blob/10266efb66e9f1ead1853f6a8519a2606b4a77d0/src/sdk/nodepod-process.ts): text I/O and retention.
- [`src/threading/process-worker-entry.ts`](https://github.com/R1ck404/Nodepod/blob/10266efb66e9f1ead1853f6a8519a2606b4a77d0/src/threading/process-worker-entry.ts): VFS synchronization and HTTP ingress.

## 2. WebContainers: useful embedding API reference

The [public API](https://webcontainers.io/api) supplies `boot`, `fs`, `mount`,
`spawn`, `export`, port/server-ready events, and `teardown`. The documented
filesystem is modeled after `fs.promises`, with `mkdir({ recursive })`,
`rm({ recursive, force })`, `readdir({ withFileTypes })`, encoding-aware reads,
and scoped watchers.

Most useful for us:

- **Typed directory entries:** avoid an RPC `stat` for every name when displaying
  a file tree. Measure and implement this as one backend operation.
- **Explicit mutation options:** our `mkdir()` currently calls mkdirp, and
  `remove()` exposes no policy options. Document those existing semantics before
  choosing compatible extensions or a deliberate migration.
- **Batch delivery/export:** mounting a tree or prepared snapshot makes examples
  and fresh-workspace provisioning simpler than repeated host writes. First
  define merge/replace behavior, paths, symlinks, limits, and partial failure.
- **Lifecycle clarity:** teardown invalidates derived objects. Our separate
  stop/close boundaries should document equally clear invalidation rules.

WebContainers' process interface is terminal-oriented: its documented output is a
single text ReadableStream containing stdout/stderr and descendant output, with a
text WritableStream input. Borrow Web Streams interoperability, while preserving
our separate byte channels and noninteractive process semantics.

The documented port/server-ready events are useful for discovery. In our contract,
listener attachment and application readiness should be separate: launch, attach,
then perform a bounded application health request. A port number alone also cannot
identify the same server after restart; retain our listener identity check.

## 3. ZenFS: filesystem layering and mount reference

[ZenFS](https://github.com/zen-fs/core) separates a Node-compatible filesystem API
from configurable mounts/backends. Its examples combine archive, memory, and
persistent backends at different paths. Relevant backend concepts include Fetch,
CopyOnWrite, Port, and browser storage through its DOM package.

The inspected [Port backend](https://github.com/zen-fs/core/blob/main/src/backends/port.ts)
offers typed RPC methods for remote filesystem operations, byte-range read/write,
readiness, and synchronization. Its source explicitly says direct synchronous
operations are not permitted on PortFS; its async mixin/local state is another
layer. Do not infer identical synchronous semantics for arbitrary remote storage.

Useful application to our design:

- Keep storage implementation behind filesystem operations rather than exposing
  OPFS handles or shared-memory layout to embedding consumers.
- Treat transport, Node compatibility, and persistence as distinct concerns.
- If future requirements justify mounts, model prepared dependencies, writable
  project files, and temporary data explicitly; define cross-mount rename and
  watch behavior before exposing a general mount API.
- A read-only dependency layer plus writable overlay is worth evaluating when
  delivery/storage measurements justify it. Our existing Rust/WASM VFS remains
  the implementation to improve for the current milestone.

## 4. emnapi: native-addon compatibility and host injection

Added following the suggested [emnapi project](https://github.com/toyobayashi/emnapi).
Source inspected at
[`ca282f418104016b17b9661af98c9791301f819c`](https://github.com/toyobayashi/emnapi/tree/ca282f418104016b17b9661af98c9791301f819c).
Its README identifies main as the 2.x branch and points to `v1.x` for stable;
an integration should deliberately select matching package/toolchain versions.

### What it supplies

emnapi implements **Node-API for addons compiled to WebAssembly** using
Emscripten, wasi-sdk, or suitable clang builds. It also powers napi-rs's WASM
support. An existing platform-native `.node` binary is not itself a WASM artifact:
use an upstream WASM build or compile a compatible addon and its dependencies.

Its most useful API-design lesson is explicit host injection. The WASI example
uses `instantiateNapiModule(input, options)` with a context, WASI instance,
worker-creation hook, memory imports, and worker-pool settings. It obtains addon
exports through `napiModule.exports`. Node-API lifecycle, JS values/callbacks,
references, async work, and thread-safe functions are a richer compatibility
surface than a manifest describing callable C functions.

### Filesystem relationship

The browser example builds a memfs filesystem and supplies it to
`new WASI({ version: 'preview1', fs })`; the Node path uses `node:fs`.
The filesystem is supplied through the selected WASI host implementation, rather
than being persistence supplied by emnapi. The example also constructs WASI in
child workers; its example setup is not proof of cross-worker file coherence
with our workspace.

For Vivari, the desired adaptation is:

```text
Guest package JS wrapper
  → compatible upstream WASM addon + emnapi loader
  → Node-API imports/context inside the guest process
  → WASI or Emscripten filesystem adapter
  → existing Vivari filesystem service

Addon thread creation
  → process-owned worker allocation and cleanup
```

That bridge requires investigation: a Promise-only host `workspace.fs` cannot
simply be passed to a synchronous WASI filesystem interface. Reuse or adapt the
guest filesystem/syscall boundary, mapping paths and descriptors consistently.
Emscripten has its own filesystem integration surface; the demonstrated WASI
`fs` option is not a universal option for every WASM build.

### Where this fits our cleanup

- **P4 package compatibility:** potentially use compatible upstream napi-rs or
  Node-API WASM distributions behind a centralized loader/asset-delivery adapter.
  Keep the package's normal JS exports where possible. This supports the plan's
  preference for upstream JS/WASM implementations.
- **P2 process ownership:** `onCreateWorker` and explicit contexts are useful
  integration points. Account for addon workers, asynchronous callbacks, and
  shared memory in guest process teardown. The example explicitly calls
  `uv_library_shutdown()` and destroys its context; abrupt cancellation needs
  qualification beyond that normal-completion example.
- **P3 filesystem coherence:** require addon reads/writes to observe the same
  workspace as guest `node:fs` and host editing. Avoid a private example memfs
  becoming an accidental second filesystem.
- **FFI:** retain distinct Node-API addon and explicit FFI loading paths. An
  emnapi build fits a Node-API dependency; a C ABI library may fit our existing
  manifest-based FFI. Select based on the dependency's actual interface.

### A bounded evaluation

After the server-only baseline identifies a required addon, check whether its
upstream distribution already supplies a compatible WASM build. Qualify that
exact package with its ordinary JS import and one meaningful operation. If it
uses files or threads, additionally verify host-write → addon-read,
addon-write → guest/host-read, asynchronous callbacks, and cancellation cleanup.
Record artifacts, exports conditions, worker URLs, memory/thread requirements,
and package/toolchain versions in the delivery receipt.

This is a compatibility candidate, not evidence that the current server needs a
new addon subsystem. It also does not replace the inbound HTTP bridge or establish
SQLite persistence guarantees.

Sources at the inspected revision:

- [`packages/emnapi/README.md`](https://github.com/toyobayashi/emnapi/blob/ca282f418104016b17b9661af98c9791301f819c/packages/emnapi/README.md): scope, build targets, loading options, threading requirements.
- [`packages/example/wasi-module-loader.js`](https://github.com/toyobayashi/emnapi/blob/ca282f418104016b17b9661af98c9791301f819c/packages/example/wasi-module-loader.js): injected filesystem, WASI, memory, and worker loader.
- [`packages/example/index-wasi.js`](https://github.com/toyobayashi/emnapi/blob/ca282f418104016b17b9661af98c9791301f819c/packages/example/index-wasi.js): exported binding, callbacks, and cleanup.

## Concrete decisions for the next step

Testing companion: [Node compatibility testing](node-compatibility-testing.md)
describes how to wire upstream Node tests into Vivari, following Bun's general
compatibility-testing approach, while retaining browser/workspace contracts.

### P1/P2: transport contract first

1. Keep `runtime.expose(port)` returning a listener-bound Endpoint. Its signal
   should have a documented lifetime: waiting for attachment versus owning the
   resulting endpoint. Handle server exit while waiting, not only caller abort.
2. Programmatic endpoint creation must work without Service Worker registration.
   Preview setup becomes an explicit async step; resolve how that interacts with
   today's synchronous `attachPreview()` before changing the public signature.
3. Resolve `fetch()` when response headers arrive; stream request and response
   bodies with independently bounded byte credits. Preserve repeated headers at
   the transport boundary, subject to Fetch's browser-visible restrictions.
4. Define request ID, listener ID, metadata, data, EOF, error, cancellation, and
   credit messages. Specify how each terminal transition releases queues and
   connections, including a body that the consumer never reads.
5. A cancelled response body closes that request, not its server. Runtime stop
   closes owned requests and processes; listener replacement invalidates old
   endpoints rather than silently retargeting them.
6. Make `writeStdin()` and `closeStdin()` acknowledged async operations, or expose
   a byte WritableStream backed by equivalent acknowledgments. State whether a
   write acknowledgment means admission to a bounded queue or guest consumption.
7. Retain byte stdout/stderr and specify final-output/exit ordering. AsyncIterable
   versus ReadableStream is secondary to end-to-end flow control; adapters can
   provide interoperation without forcing all consumers to change.

Acceptance examples: headers and first SSE event before completion; concurrent
JSON requests during SSE; slow upload/download bounded in memory; binary fidelity;
abort during every phase; process exit during attachment; listener replacement;
final output before stream closure; no retained connections after shutdown.

### P3: filesystem semantics table

Write down and qualify these before broadening the method count:

| Topic | Required decision or check |
| --- | --- |
| Paths | Host `/src/a.ts` maps to guest `/workspace/src/a.ts`; define normalization and symlink traversal behavior |
| Errors | Preserve `code`, `syscall`, `path`, and `dest`; translate paths to the caller's namespace |
| mkdir/write/remove | State parent creation, existing-target, missing-target, recursive, and force behavior |
| Directory entries | Consider `withFileTypes` or a typed listing method to avoid N+1 RPCs |
| Watches | Define scope, coalescing, rename notifications, unsubscribe, and host/guest visibility; invalidations are not a durable edit log |
| Large files | Bound transport chunks; add range/stream operations when workloads need them |
| Persistence | Distinguish visible writes, sync acknowledgment, workspace flush, and database commit |
| Close | Specify behavior of pending operations and watchers during workspace closure |

Our current references are `workspace-api/src/types.ts`, `workspace.ts`,
`runtime.ts`, and `browser/endpoint.ts`. The broader implementation order and
SQLite requirements remain in the [cleanup plan](opencode2-server-runtime-cleanup.md).

## Bottom line

Nodepod helps with a compact facade and preview-independent HTTP. WebContainers
helps with familiar filesystem operations and embedding ergonomics. ZenFS helps
with filesystem/backend separation. Together they support the current cleanup
direction: retain ownership boundaries, make contracts explicit, and replace the
transport shortcuts. The comparison does not establish that a runtime replacement
would improve the target server workload.
