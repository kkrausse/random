# Vivari JavaScript workspace API plan

Status: design baseline from the September 7, 2026 API discussion. **The API
examples below are proposed, not implemented.** Implementation starts with the
small handoffs in [api-handoff.md](api-handoff.md). No implementation sessions
were launched as part of writing this plan.

## Direction

A browser-hosted JavaScript execution environment with a filesystem, explicit
compatible APIs, and callable tools. Node/Bun/Linux-like behavior is a qualified
compatibility surface, not a claim to run stock Node, Bun, or a complete Linux OS.

The application should consume this as a library. Opening files, starting
execution, and attaching clients have separate lifetimes. Vite and OpenCode are
ordinary programs launched explicitly by the application or user.

### Decisions carried forward from the discussion

- **Workspace means files and persistence**, not running applications.
- **Runtime means active execution machinery** attached to those files.
- Prefer **`runtime.node({ entry, ... })`** and a corresponding Bun-compatible
  entrypoint over string-based command lookup for first-party library usage.
- Statically configured tools should have **typed methods on the runtime**, for
  example `runtime.tools.ripgrep(...)`.
- `spawn(command, args)` is a compatibility path for installed executables. It
  does not need to be the primary public abstraction or the first implementation.
- Vite startup is a module launch. No special core `startVite()` API is needed.
- **`runtime.expose(port)` obtains a browser-facing service handle.** No
  `access: "preview" | "http"` classification or per-call approval mechanism.
- Terminal UI is an optional execution-channel adapter. It does not define the
  runtime, and the current terminal compatibility channel is not a full PTY.
- React integration and the OpenCode client UI follow the core API.

### Proposed defaults to qualify during implementation

These make the plan executable; they are not additional settled user decisions:

- One active runtime attachment per workspace initially. Current persistence is
  even narrower: one persistent kernel per origin. Do not advertise independent
  workspace IDs or concurrent stores until their namespaces/ownership are real.
- Workspace paths are relative to its own root (`/src/App.tsx`); the initial
  runtime attachment mounts it at `/workspace`.
- Typed execution/tool calls bind explicitly to their configured implementation,
  not to an executable that mutable project `PATH` can shadow.
- New nonterminal execution streams are byte-based and distinguish stdout/stderr.
  The current merged-text bridge needs an actual extension to provide this.
- Endpoint handles belong to a runtime generation and a listening service
  instance. They close on listener/runtime loss; a replacement is obtained
  explicitly. A reused numeric port must not silently retarget an old handle.

## Current implementation and evidence

| Area | Existing implementation / limitation |
| --- | --- |
| SDK | `Vivari.boot`, `mount`, `fs`, `spawn`, preview URLs, events, teardown |
| Process handle | Text input/output, merged stdout/stderr, exit, resize, forced subtree cleanup; no full PTY |
| Files | VFS in FS-worker WASM memory; OPFS write-behind; no public durable-flush contract |
| Persistence failure | Can continue without persistence; early `BootOptions.onLog` reveals failure, but readiness must become structured |
| Services | Guest listen events and `/preview/<port>/` routes; close-event wiring incomplete in inspected core SDK |
| Browser transport | Buffered preview HTTP plus separate WS/SSE tunnels; demo manually forwards tunnel messages |
| Tool delivery | Pinned JS/WASM assets and hash receipts; ripgrep packaging emits `/bin/rg` and a real WASM payload |
| Bun | Node-backed compatibility frontend, not a native Bun executable |
| Integration | Real matched OpenCode V2 model edit reached real Vite HMR in the same iframe document |
| TUI performance | Large allocation reduction established; sustained responsiveness remains unresolved |

Use [V2 results](vivari-v2-results.md), the current
[demo README](../opencode-demo/README.md), and
[performance results](../opencode-demo/PERFORMANCE-RESULTS.md). Historical
handoffs contain superseded blockers. Local `.runtime/patched` source and frozen
demo distributions may differ; always record the build actually tested.

## Where does a `spawn()` executable live?

There are two namespaces: the **TypeScript library API** and the **guest/runtime
filesystem**. They may have entrypoints to the same implementation.

```text
Configured ripgrep tool (pinned JS + genuine WASM)
    ├── runtime.tools.ripgrep(options)   typed, direct implementation binding
    └── /bin/rg                         optional compatibility launcher
                                            ↑
                                     spawn("rg", args)

Project files / dependencies
    └── /workspace/node_modules/.bin/...   project-installed command entrypoints
```

The saved workspace is not the whole runtime root filesystem. `/bin`, tool
payloads, temporary files, and optional application-state mounts have separate
ownership. A runtime-supplied tool does not have to be copied into project source.

**Current code:** `kernel-host/kernel.js:resolveProgram()` resolves a path
relative to `cwd`, or checks `env.PATH` followed by `/bin`; it also tries `.js`
suffixes. `installCoreutils()` writes built-in JS programs into `/bin/*.js`.
`scripts/package-ripgrep.ts` packages an explicit `/bin/rg` launcher. This is
limited program-file resolution, not an arbitrary native Linux binary loader.

**Public API preference:** if ripgrep is statically configured, use
`runtime.tools.ripgrep(...)`. It should work without a public CLI launcher being
installed. If a CLI frontend is provided, share its implementation and behavior
with the typed method. Keep exact PATH/shebang compatibility in a separate
contract; first-party typed calls should not require it.

## Proposed usage

Names such as `opfsStore`, `distribution`, and `ripgrep` below are supplied
descriptors/adapters, not existing exports. Dependency preparation is an explicit
prior step; launching Vite does not silently install packages.

```ts
// Files and persistence only. Internal storage workers are allowed.
const workspace = await Workspace.open({
  id: "my-project",
  storage: opfsStore,
});

await workspace.fs.writeFile("/src/App.tsx", source);

// Initialize execution infrastructure; start no project programs.
const runtime = await Runtime.start({
  distribution,
  workspace, // mounted at /workspace in the initial API
  tools: { ripgrep },
});

try {
  const matches = await runtime.tools.ripgrep({
    pattern: "TODO",
    paths: ["/workspace/src"],
  });

  const vite = await runtime.node({
    entry: "/workspace/node_modules/vite/bin/vite.js",
    args: ["--port", "5173", "--strictPort"],
    cwd: "/workspace",
    env: {},
  });

  // Output consumers must run while execution runs; queues are bounded.
  const logs = consumeOutput(vite.stdout, vite.stderr);
  const endpoint = await runtime.expose(5173, {
    signal: AbortSignal.timeout(30_000),
  });

  // Browser adapter owns iframe registration and WS/SSE relay plumbing.
  // Exact attachPreview signature is part of the transport handoff.
  const attachment = attachPreview(iframe, endpoint);

  await userRequestsStop();
  attachment.dispose(); // detach UI; does not stop Vite
  await vite.stop();
  await logs;
} finally {
  await runtime.stop(); // stop executions; workspace remains accessible
  await workspace.flush(); // durability acknowledgment, not process snapshot
  await workspace.close();
}
```

The preview adapter should ultimately make ordinary URL consumption convenient.
Do not claim `iframe.src = endpoint.url` alone handles today's manual tunnel
registration, new-frame Service Worker control, and HMR until that is verified.

## Object contracts

### Workspace

- Owns filesystem identity, live file access, and persistent state.
- `fs`: initially read/write, stat/list, mkdir, rename/remove, and watch. Preserve
  binary data and use one authoritative file tree for API calls and guest code.
- `persistence`: observable opening/durable/ephemeral/failed state with a concrete
  error; runtime readiness is a separate state.
- `flush()`: acknowledges persistence of preceding accepted mutations or rejects.
  It does not promise an atomic multi-file checkpoint or ongoing-write quiescence.
- `close()`: releases storage resources; proposed behavior is to reject while a
  runtime remains attached rather than implicitly kill user execution.
- Export/import and versioned coherent checkpoints are later storage operations.
- Stopping a runtime must leave this object usable. A facade over a destroyed
  `vm.fs` does not satisfy that contract.

### Runtime and Execution

- `Runtime.start(...)`: validates distribution/tool compatibility and attaches
  execution to the workspace. Errors and cancellation clean up partial startup.
- `node({ entry, args, cwd, env, signal? })`: explicitly selects the configured
  Node-compatible frontend; module resolution stays inside the runtime.
- `bun(...)`: expose only with documented, qualified Bun-compatible behavior.
- `spawn(command, args, options)`: optional public compatibility path. Preserve
  guest child-process behavior even if this method ships after typed entrypoints.
- Launch resolves after execution is accepted/started, not after completion or
  application readiness. Missing entries/start failure reject; ordinary nonzero
  exits are completion results. Define stable error codes in the first type slice.
- Execution supplies bounded byte streams, a single-settlement `exited` result,
  and idempotent `stop()`. Record exit code versus forced termination distinctly.
- Drain output concurrently; document one-reader ownership, EOF, cancellation,
  backpressure/overflow behavior, and what final output precedes completion.
- `runtime.stop()` terminates owned executions/descendants and closes endpoints;
  it does not close the workspace or save process memory.
- Terminal mode remains a separate optional I/O adapter with resize/input and
  accurately described signal support. Detaching its UI does not kill execution.

### Typed tools

- `Runtime.start({ tools: { ripgrep } })` statically determines the tool methods;
  preserve inference without `any` or an untyped string-based `callTool` API.
- Run expensive tool work in workers against the same filesystem, not on the UI
  thread or by copying every file through browser JavaScript.
- Ripgrep is a real search program, not an AI tool definition. OpenCode may use
  its CLI adapter; the host application may use its typed API.
- Initial typed search may collect a **bounded** structured result. Specify
  truncation, cancellation, no-match, invalid-pattern, and binary/UTF-8 behavior.
  Distinguish ripgrep exit 1 (no match) from execution/regex failures.
- Runtime-local JS/WASM packages and host-mediated services are different kinds
  of integration. Guest access to a host service needs a serialized protocol;
  arbitrary JavaScript functions cannot simply be sent into a worker.

### Endpoint

- `expose(port, { signal? })` obtains/establishes browser routing and waits for an
  actual listener. Subscribe-and-check existing state to avoid missed-event races.
- All supported listening ports are eligible in the initial trusted embedding.
  This is not an ACL, authorization grant, or public internet publication.
- No `access` type. HTTP, streaming, and WS are transport support, not caller roles.
- Handle has `url`, lifecycle/closure information, and a `fetch` adapter when
  browser-native fetch cannot supply the needed semantics. Settle exact types in
  the transport slice; keep the client independent of kernel protocol messages.
- Listening means transport readiness. An application can explicitly perform a
  health request; core does not parse Vite/OpenCode startup log text.
- Listener/runtime loss settles pending operations and closes connections. Route
  ownership must include runtime and listener identity, not just a numeric port.
- Streaming Fetch is its own gate: today's EventSource/SSE tunnel does not prove
  that the OpenCode client's fetch-based event stream works through preview HTTP.
- Detaching a preview releases that attachment's connections, not the server.

## Bundles, updates, and extension recipes

Keep these independently versioned:

1. Runtime distribution: worker assets, JS compatibility code, WASM and ABI.
2. Tool/application bundle: files, typed bindings, optional command launchers.
3. Project dependencies: lockfile-derived installed tree, disposable cache.
4. Prepared development cache: e.g. Vite optimization, with stricter compatibility.
5. User files/application state: persistent data with explicit ownership.

Start with verified manifests and file delivery. A general overlay filesystem or
arbitrary dynamic plugin loader is not required. Some builtin changes require a
new distribution; a file bundle cannot make an unsupported runtime API appear.

Bundle identity includes relevant runtime/patch ABI, tool version, dependency
lock, install configuration and path-sensitive inputs. Validate paths/hashes
before installation; preserve user-modified files and reject unknown conflicts.
Stage installation/releases and activate completed versions. Caches are
disposable acceleration, not workspace authority. Retain assets needed by active
runtime generations; define cleanup independently of current-release activation.

The cookbook should have four fill-in recipes:

- JS tool: typed worker call, optional CLI launcher, same underlying behavior.
- WASI command: pinned artifact, arguments/stdio/filesystem bindings, real exits.
- Node/Bun builtin: shared primitive, facades, module registry, qualified subset.
- FFI library: WASM reactor manifest, ABI/layout, allocator/pointer lifetime,
  callbacks, cleanup, and both facades where offered.

Each recipe includes file locations, build/install commands, compatibility
requirements, one real positive and negative probe, update procedure, and a
receipt. Keep consumer-specific FFI layouts outside the generic substrate.

## Embedding and security boundaries

Removing per-call `access` flags does not make endpoints security capabilities.
The current same-origin unsandboxed preview, parent runtime handle, multiple
egress paths, and unauthenticated model proxy are POC facts, not isolation.

Origin separation and transport sender/connection ownership belong to the
embedding adapter. Network enforcement belongs at all outbound paths and the
trusted gateway. Environment variables/provider config select an endpoint; they
do not enforce policy. Keeping a key server-side does not restrict callers' use
of it. An allowed model endpoint still permits disclosure of submitted source.

Plan the embedding origin layout and storage/SW routing constraints alongside
endpoint extraction. Implement stronger policy as a separate track rather than
adding misleading `access` labels to `expose()`. Keep model provider configuration
in the OpenCode/application recipe; core only supplies generic connectivity.

## First milestone and follow-ons

**First milestone:** a small standalone consumer opens files, explicitly starts
the runtime, calls ripgrep, launches Vite by module entrypoint, attaches a preview,
observes same-document HMR, stops execution, durably saves and reopens the files.
It consumes public imports only, with no shell requirement or kernel bridge glue.

Follow with a pinned OpenCode application bundle + explicit server launch + real
HTTP client/event-stream acceptance. React context, OpenCode UI, richer terminal
behavior, hybrid backends, and TUI performance work can build on or proceed
separately from these contracts. Detailed tasks and copy-paste handoff instructions
are in [api-handoff.md](api-handoff.md).
