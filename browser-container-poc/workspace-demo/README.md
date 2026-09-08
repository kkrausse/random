# Workspace API demo

## Integration checkpoint (supersedes older walkthrough defaults below)

The demo now defaults to **Shared workspace-api**. Run from `browser-container-poc/`:
```sh
bun run --cwd workspace-demo prepare
PORT=4311 RUNTIME_DIR="$PWD/workspace-api/dist/runtime" bun run --cwd workspace-demo dev
```
Prepare consumes an already-built runtime distribution and the existing matched
V2 POC application receipt. Open workspace → Add missing example files → Start
runtime → Deliver prepared apps → Launch Vite / Launch OpenCode server + chat.
Opening discovers the runtime manifest automatically. Delivery restores excluded
dependencies after reopen, verifies hashes, rejects conflicting existing files,
and starts no applications. `guest/` owns its frozen dependency install.

See [current integration handoff](../workspace-api/INTEGRATION-HANDOFF.md) for exact
evidence and remaining failure: real provider edits and HTTP/SSE work headlessly,
but model-edit HMR currently needs verification/fixing. The latest official React
plugin packaging is untested in execution. Browser Control remains disconnected;
there is no browser acceptance claim. The older fixture remains explicit opt-in.

A small Bun + TypeScript browser shell consuming the public exports of
`../workspace-api/src/index.ts`. No local duplicate API contracts or kernel
protocol glue. Default mode is an explicitly labelled, usable **fixture**.

## Run

```sh
cd browser-container-poc/workspace-demo
bun install
bun run dev
# http://127.0.0.1:4310
```

Override the port with `PORT=4311 bun run dev`. The server binds loopback and
bundles the shell and imported chat component on request; reload after source changes.

```sh
bun run typecheck
bun test
bun run build
```

The build produces `dist/index.html` and `dist/app.js`, suitable
for serving at an origin root. Real API hosting additionally needs the isolation
headers and runtime distribution routes described below. The Bun dev server
already supplies COOP/COEP and `Service-Worker-Allowed: /`.

## Fixture walkthrough

1. **Open workspace**. This only opens files, not a runtime.
2. Select `/index.html`, edit it, and **Write file**. Read back or search source
   files independently of execution. New files can be written under existing
   directories by changing the path input.
3. **Start placeholder runtime**, then **Show static fixture preview**. Writing
   `/index.html` refreshes the iframe. This is direct sandboxed `srcdoc`, not
   Vite, TSX transformation, same-document HMR, or a listening backend service.
4. **Open chat fixture** mounts the separately owned OpenCode component with
   `mock: true`. Its sessions/messages are mock data, not model requests.
5. **Stop runtime** detaches both panels. Files still work.
6. **Save localStorage snapshot**, **Close workspace**, and reopen. Saved file
   bytes return. Closing a fixture does not implicitly snapshot unsaved changes.

The fixture implements the shared `Workspace`/`WorkspaceFs` interfaces using
memory and explicit localStorage byte snapshots. It reports ephemeral persistence;
successful fixture snapshots are **not evidence of the real API flush contract**.
It supports file rename/removal and recursive directory creation; directory
rename/removal and persistence of empty directories are outside this UI fixture.
Storage quota/JSON failures surface as errors. No real runtime object, process,
endpoint, or ripgrep result is fabricated. Filesystem search is an explicitly
labelled host-side literal scan (100 matches, skips binary and >1 MiB files,
`node_modules`, and `.git`).

## Real API integration

Switch to **Shared workspace-api** while the workspace is closed. There is no
automatic fallback. In the launch configuration, enter a valid distribution JSON
with `name`, matching manifest `version`, and `assetBaseUrl`.

The optional server mount exposes a prepared distribution at `/runtime/`:

```sh
RUNTIME_DIR=/absolute/path/to/prepared/distribution bun run dev
```

That directory must contain `distribution.json` and its referenced worker,
service-worker, and WASM assets. This demo does not build a distribution or
install guest dependencies. With no distribution configured, opening the real
workspace fails visibly (the default manifest URL returns HTTP 404).

The shell calls:

- `Workspace.open({ id: "default", storage: opfsStore(distribution) })`;
  the current backend has one persistent origin store.
- `Runtime.start({ workspace, distribution, tools: {} })` only on request.
- Vite: `runtime.node({ entry, args: ["--host", "0.0.0.0", "--port", "5173",
  "--strictPort"], cwd: "/workspace", env: {} })`, then `expose(5173)` and
  `attachPreview(iframe, endpoint)`. This uses the current trusted same-origin
  preview adapter. HMR still needs end-to-end verification against prepared assets.
- OpenCode: explicitly launch the configured module with configurable args
  (default `serve --hostname 0.0.0.0 --port 4096`), then `expose(4096)` and mount
  the chat client. The default module path is a **configuration placeholder**;
  set it to the actual prepared OpenCode 2 bundle entrypoint. No server bundle,
  provider credentials, or model proxy is silently provisioned.
- Drain stdout/stderr concurrently, log exit results, dispose attachments and
  endpoints, and stop owned executions. Stopping a runtime retains the workspace.
  Flush and close remain separate controls.

Exposure waits at most 30 seconds. Launch/transport errors stop the partially
launched service and report failure. Files can be edited/read after runtime stop.
Use **Add missing example files** for a newly empty workspace; existing files
are preserved. Example package metadata does not claim dependencies are installed.

## Chat component boundary

`src/chat-adapter.ts` directly imports `../opencode-client-demo/src/client.ts`.
The Bun server/build bundles it into `app.js`, consuming the agreed export and
deriving adapter types directly from that function:

```ts
mountOpenCodeClient(container: HTMLElement, options?: {
  endpoint?: { url: string; fetch: typeof fetch };
  mock?: boolean;
  directory?: string;
}): { dispose(): void }
```

The component owns chat UI and its connections. This demo owns workspace/runtime,
server executions and endpoints. The adapter passes `/workspace` as directory,
and adapts native Fetch input (`string`, `URL`, `Request`) to the shared endpoint's
string-based fetch signature. Response bodies remain streaming; Request uploads
are buffered to match the endpoint contract. Disposing chat precedes stopping its
server. Shadow-root styles are supplied by the component itself.

## Verification receipt

- `bun run typecheck`: passes browser shell + imported chat/API sources and the
  separate Bun server/test TypeScript project.
- `bun test`: fixture binary preservation/copy isolation, explicit snapshot/reopen,
  closed-handle rejection, file rename/removal, invalid snapshot/path and quota errors.
- `bun run build`: bundles shell and the actual chat component from commit `b02ac70`.
- HTTP smoke: index and JS served through Bun, with isolation headers.
- Browser interaction verification requires a connected Browser Control extension;
  see `BROWSER-CONTROL-TODO.md` for the current environment blocker.
- Real Vite/HMR, OPFS durability and OpenCode/model execution are not verified by
  fixture success. They require the prepared backend and application bundles.
