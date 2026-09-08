# Workspace React demo

A realistic **React library consumer**, with a separate React guest application.
The host's `WorkspaceProvider` wraps public `workspace-api` exports. Its editor,
preview, status and OpenCode chat consume typed React context. Guest Vite and
guest OpenCode run inside the browser runtime; the host never substitutes a
native Vite/OpenCode process.

## Run

With the pinned runtime and OpenCode package already prepared in this checkout,
build the local library first (also required after changing library source):

```sh
cd browser-container-poc/workspace-api
bun install --frozen-lockfile --ignore-scripts
bun run build
cd ../workspace-demo
bun install --ignore-scripts
bun run demo
```

The demo uses `@vivari/workspace-api` and its `/react` subpath through a local
file dependency. See [local package delivery](../workspace-api/LOCAL-PACKAGES.md)
for independent tarball installation and runtime asset copying. This checkpoint
retains the existing Start workspace flow; the production editing toggle and
backend passthrough remain pending.

Open **http://127.0.0.1:4311** and click **Start workspace**. That single action:

1. Checks asset availability before opening persistent storage.
2. Opens/restores the origin's workspace and adds only missing guest source/config.
3. Starts the real browser runtime and hash-verifies/delivers 2,291 prepared files.
4. Launches guest Vite, attaches the preview, and waits for its Document to load.
5. Launches authenticated guest OpenCode and waits for health, event connection,
   models and session history. An empty server gets one “Sample workspace” session.

An empty workspace gets an interactive React counter. Existing `/src/App.tsx`,
configuration and chat sessions are **preserved**, including previous acceptance
edits. Edit **Guest source editor → Save file** or ask OpenCode to change
`/workspace/src/App.tsx`; both affect the same guest preview through HMR. Save
writes and flushes; **Read file** picks up model edits. New guest configuration
selects `opencode/muse-spark-1.3-contributor-free`; existing model settings remain
user-owned. Model calls require a reachable provider and may hit provider limits.

`demo` verifies existing prepared hashes and input fingerprints, preparing only
missing/stale apps. It packages an existing compiled runtime if its distribution
is missing; it does **not** rebuild the large runtime on every start. A compatible
already-running demo is reused. Other port owners are reported, never killed.
`PORT=4312 bun run demo` selects another port (and therefore another origin store).
Ctrl-C stops the server owned by that terminal.

The one Bun server serves the React host, `/runtime/`, `/prepared/`, isolation
headers, and the existing local `/api/model/opencode` proxy. No separate proxy
process or secret in the browser bundle is needed. Provider-side configuration
stays in the host proxy. Each guest OpenCode launch receives an ephemeral auth
credential through the endpoint adapter, never through rendered logs.

## Prerequisites / explicit preparation

This is a pinned runtime POC, not a fresh-checkout zero-prerequisite installer.
It requires Bun, installed host dependencies, the reviewed compiled runtime and
matched OpenCode source package. Current prepared artifacts are ignored by git.
When missing, follow the [runtime integration handoff](../workspace-api/INTEGRATION-HANDOFF.md)
and the [runtime build documentation](../vivari/README.md). From `browser-container-poc/`:

```sh
# Requires the pinned runtime source/toolchain described in vivari/README.md:
bun vivari/scripts/build-runtime.ts patched
bun workspace-api/scripts/distribution.ts

# Requires the installed/frozen OpenCode source checkout at
# vivari/.runtime/opencode-v2-source, revision d7a7256bb6b0952f486c95718cfbf460b1570a56:
bun vivari/scripts/package-opencode-tui.ts --v2

bun run --cwd workspace-demo prepare
bun run --cwd workspace-demo demo
```

`prepare` installs the guest's own frozen dependencies and verifies the pinned
OpenCode receipt. `RUNTIME_DIR`, `PREPARED_DIR`, and `OPENCODE_PACKAGE_DIR` can name
explicit prepared locations. Both preparation and serving honor them. `bun run dev`
starts the watch-mode server directly when assets are already prepared; reload the
host after source changes. Missing/stale assets produce an early actionable error.

## Library-consumer structure

- `src/workspace-provider.tsx`: reusable React boundary around **public API only**.
  Owns workspace/runtime/services, serializes actions, reports progress/errors,
  and disposes registered UI attachments before stopping their processes. The
  `useWorkspace()` hook exposes state and a controller; wrap mutations in
  `controller.run(...)`. Provider unmount aborts pending startup and closes resources.
- `src/sample-recipe.ts`: application-specific startup stages, missing-file seeds,
  prepared delivery, guest ports, health checks and endpoint Fetch adaptation.
  These are deliberately outside the core API and generic React provider.
- `src/main.tsx`: host React components consuming context. Preview attaches in an
  effect; chat wraps `mountOpenCodeClient` through `mountChat` with effect cleanup.
  Host controls use minimal Base UI/shadcn-style buttons, Tailwind and Lucide.
- `src/sample.ts`, `prepare.ts`, `guest/`: **separate guest React application** and
  pinned dependencies. Host React is bundled into `/app.js`; guest React is served
  by in-browser Vite from the persistent workspace.
- `serve.ts`, `demo.ts`, `setup.ts`: host HTTP/proxy process and explicit asset setup.

## Lifecycle and retries

Startup disables conflicting controls and rejects duplicate actions. A failed
stage retains completed work; fix its reported issue and **Retry Start workspace**.
Delivery is resumable and rejects conflicting existing dependency bytes. Existing
project files are never replaced by the seed. Unsaved editor changes must be saved
before another start or close.

Under **Advanced**, Stop runtime detaches services while leaving files editable;
Close workspace stops services, acknowledges a flush and releases storage. Start
workspace reopens and restores excluded dependencies automatically. Use explicit
Close for acknowledged persistence before ending a browser session: page-unload
cleanup is best-effort, not a durable-flush guarantee. Only one workspace tab per
origin can hold the OPFS lease. `localhost` and `127.0.0.1` have independent stores.
The opt-in fixture is labelled memory/localStorage/static HTML and proves no real
runtime or model behavior.

## Checks and evidence

### Local diagnostics

Run the same `bun run demo` command. Diagnostics go to
**`browser-container-poc/workspace-demo/.diagnostics/events.jsonl`**, with the
previous generation in `events.jsonl.1` (gitignored). The server prints the
absolute path. The header shows the current operation/run ID and **Download local
diagnostics** (`http://127.0.0.1:4311/diagnostics`); Activity shows recent progress.
For live inspection from `workspace-demo`:

```sh
tail -f .diagnostics/events.jsonl
```

Records include page/run IDs, server/request IDs, timestamps, operation/stage
durations, runtime/application versions, worker creation/init/readiness and
persistence milestones, service/client readiness/exits, and proxy HTTP status,
stream byte counts/completion/cancellation/failure. Errors retain a redacted
message, stack and cause. Browser initialization installs error/rejection handlers
before loading the React bundle. The startup command also records prerequisite
and port-conflict failures before the server starts.

For another `Workspace.open` timeout, find `operation.failed` for the displayed
run ID, then the preceding `workspace.open` and `workspace.open.waiting` records.
The UI error includes elapsed time and the last milestone. Ten-second wait records
and visibility changes help distinguish a stalled stage from gaps in browser
execution. Boot log categories are observed hints, not proof of completed work.
The previous unexplained 120-second timeout's cause remains unproven.

Two approximately 2 MiB disk generations are retained. Browser recent/pending
buffers hold at most 160/100 bounded events; uploads are small batches with a
three-second deadline. Upload failure is silently retried from the bounded buffer
and cannot fail startup. Disk logging is best-effort too. Already-uploaded records
survive reload; pending records during abrupt unload can be lost. Proxy records
correlate by server/request ID and time, not by inspecting guest prompts.

No request bodies, prompts, editor source, headers, launch environments or raw
guest stdout/stderr are intentionally recorded. Guest output is represented by
first-output and drained-byte summaries. Known credential fields/patterns and URL
credentials/query strings are redacted again at the disk boundary. This is
pragmatic redaction, not a guarantee for arbitrary secrets embedded in free-form
exception text. No external telemetry is sent.

```sh
bun run typecheck
bun test
bun run build
```

Build emits `dist/index.html`, `dist/app.js`, `dist/app.css`; static deployment also
needs the runtime/prepared routes, local proxy and COOP/COEP headers from `serve.ts`.

See [turnkey receipt](tests/TURNKEY-EVIDENCE.md) for this change's exact verification
and original failure diagnosis. Prior real browser/model/OPFS acceptance remains
in [real-app evidence](tests/REAL-APPS-EVIDENCE.md) and `tests/browser-evidence/`.
The React host requires its own browser pass; do not equate fixture or headless
tests with OPFS, guest rendering or same-Document HMR.
See [independent QA and diagnostics receipt](tests/REACT-QA-EVIDENCE.md) for the
current browser blocker, host startup checks, and diagnostic failure-path tests.
