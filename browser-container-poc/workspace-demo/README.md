# Workspace React demo

A **normal interactive React app by default**, with caller-controlled optional
editing through public `WorkspaceEditing`. `src/SampleApp.tsx` is both the deployed
app and the exact known-good source seeded into guest Vite. Both use the same
application-owned `/api` backend. Vite/OpenCode run inside the browser only after
Enable editing. The original React tree remains mounted and visible during boot.

## Run

With the pinned runtime and OpenCode package already prepared in this checkout,
build both local packages first (also required after changing their source):

```sh
cd browser-container-poc/workspace-api
bun install --frozen-lockfile --ignore-scripts
bun run build
cd ../opencode-chat
bun install --frozen-lockfile --ignore-scripts
bun run build
cd ../workspace-demo
bun install --ignore-scripts
LOCAL_EDITOR_ADMIN=1 bun run demo
```

The demo uses built public `@vivari/workspace-api` exports and
`@vivari/opencode-chat` root, `/react` and `/styles.css` through local file
dependencies. `demo` and the browser build check those exports and print exact
preparation instructions if missing. See [local package delivery](../workspace-api/LOCAL-PACKAGES.md)
for independent tarball installation and runtime asset copying. Omit
`LOCAL_EDITOR_ADMIN=1` for normal non-admin mode: no toggle, and direct editor
asset/model requests return 403. This flag is a **local admin fixture**, not identity.

Open **http://127.0.0.1:4311** and click **Local editor mode** in the page header.
The dashboard includes a counter with backend save/refresh/stream controls, a local
interactive checklist, startup instructions, and suggested agent edits. The checklist
is React view state; source changes persist separately in the workspace. Existing
workspaces preserve their previous source; use **Reset source** inside editing mode
to load this expanded sample into an existing workspace.

That single editor action:

1. Checks asset availability before opening persistent storage.
2. Opens/restores the origin's workspace and adds only missing guest source/config.
3. Starts the real browser runtime and hash-verifies/delivers 2,291 prepared files.
4. Launches guest Vite, attaches the preview, and waits for its React root to render.
5. Launches authenticated guest OpenCode and waits for health, event connection,
   models and session history. An empty server stays empty: click **New chat**
   explicitly before sending. Existing sessions are selected without creating another.

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
`PORT=4312 LOCAL_EDITOR_ADMIN=1 bun run demo` selects another port (and origin store).
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

- `@vivari/workspace-api/react`: generic controlled lifecycle and provider.
  `src/workspace-provider.tsx` is only the demo diagnostics adapter.
- `src/sample-recipe.ts`: application-specific startup stages, missing-file seeds,
  prepared delivery, guest ports, health checks and endpoint Fetch adaptation.
  These are deliberately outside the core API and generic React provider.
- `src/main.tsx`: normal app, app-owned permission/enable state and lazy editor load.
  `src/editor.tsx` / `editor-components.tsx`: full-window preview, stable host corner
  controls, chat overlay, expandable source editor, Reset source, Exit/retry.
   `src/chat-adapter.ts` owns one public `createChatController` per service endpoint,
   awaits `ready`, and disposes on replacement/release or startup cancellation.
   `/react` `ChatView` only subscribes; hiding/remounting the panel does not own the
   controller/server. The bounded optional panel and file callback remain replaceable.
   The callback opens the source editor, mapping guest `/workspace/` paths to its FS.
   There is no directory picker or attachment upload. The app's bundler resolves
   React peers from the app to avoid duplicate React through Bun file symlinks.
  Host controls use minimal Base UI/shadcn-style buttons, Tailwind and Lucide.
- `src/SampleApp.tsx`, `prepare.ts`, `guest/`: **shared normal/guest source** and
  pinned dependencies. Host React is bundled into `/app.js`; guest React is served
  by in-browser Vite from the persistent workspace.
- `serve.ts`, `demo.ts`, `setup.ts`: host HTTP/proxy process and explicit asset setup.

## Lifecycle and retries

Conflicting actions are excluded. **Exit** also works during boot: it aborts,
waits for current work, stops services and closes/releases the lease. Cleanup errors
offer Retry Exit; a failed start offers Retry editing. Re-entry preserves saved
source/chat and redelivers excluded dependencies. Unsaved editor text is discarded
on Exit. Explicit Exit acknowledges cleanup; unload is best-effort. Only one tab per
origin may own OPFS; `localhost` and `127.0.0.1` are independent stores.

**Reset source** is intentional: restore only `/index.html`, `/src/main.tsx`,
`/src/App.tsx`, `/vite.config.mjs` from the prepared recipe snapshot, flush, restart
Vite and reconnect OpenCode (paused to prevent concurrent agent writes). No path
deletion, package/config replacement or unknown-file cleanup. Chat/session/backend
state survives. Dependency/package.json changes can still require manual repair.
Guest React state remounts; the original normal React state remains underneath.

## Server policy and backend routing

`server-policy.ts` owns authorization. Replace its loopback + explicit env fixture
with the app's existing session/role check. `serve.ts` calls public `/server`
`authorizeEditorRequest` before runtime, prepared and lazy editor assets, diagnostics,
and model proxy routes. The public normal static dependency graph is determined at
build time; editor code is split and fetched only on entry. Production hosts must
apply equivalent policy when serving artifacts; simply publishing all `dist` files
on an unguarded static server bypasses authorization.

`backend.ts` owns a server-lifetime counter, native stream, and local request echo
fixture. Backend state is independent of workspace resets, but restarting this tiny
server resets it. Real apps supply their existing durable backend. The echo route
is a local request-test fixture, not an application production endpoint.

The recipe opts into `endpoint.attachPreview(iframe, {hostPaths:["/api"]})`. Matching iframe
requests use native Fetch, not guest Vite: original cookies/credentials, methods,
headers, upload bytes, response status and streams. Root-absolute paths are required;
relative `api/...` resolves under `/preview/PORT/`. Routers need a prefix-aware base
and must retain `__vv_listener`/`__vv_host_paths` query identity across navigation/SW
revival. OAuth callbacks, top navigation and URL semantics need app integration;
there is no automatic seamless identity with the deployed URL. Guest and normal
React roots do not share memory. Same-origin trusted editing is not code isolation.

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
Latest public-chat integration and fresh independent QA:
[integration checkpoint](tests/integration-qa/README.md). An admin QA-owned server
is available at **http://127.0.0.1:4312**; the retained 4311 server is non-admin.
