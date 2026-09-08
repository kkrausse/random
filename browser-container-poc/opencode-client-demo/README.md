# opencode-client-demo (placeholder chat client for F2)

Status: scaffold only. `workspace-api` F1/C2/D2 are not implemented yet, so this
demo does not run end-to-end. That is expected. Do NOT modify
`../opencode-demo/` (shell-first TUI demo) or `../workspace-demo/`.

Concept (from `doc/api-handoff.md` task F2): the OpenCode server is launched
explicitly as an ordinary application via `Runtime.node({ entry: <serve entry>,
args: ["serve", ...] })`, exposed with `runtime.expose(port)`, and this small
browser chat client talks to it through the endpoint fetch adapter — NOT the TUI.

UI: server start/stop + endpoint status + health check, session list /
create / select, message input + send, transcript pane fed by stream/append
text events, stop/abort button, log pane. Restart preserves durable workspace
state (files); processes do not resume.

## Intended real imports

```ts
import { Runtime } from "workspace-api"; // F1: Workspace/Runtime + expose(port)
import { createOpenCodeClient } from "<pinned-opencode-bundle>/client"; // D2 bundle
```

Real flow: `Runtime.start({ workspace, ... })` →
`runtime.node({ entry: "<opencode serve entry>", args: ["serve", "--port", "4106"],
cwd: "/workspace", env: {...provider config} })` → `runtime.expose(4106)` →
endpoint `fetch` adapter → pinned OpenCode HTTP client: list/create sessions,
POST prompt, stream text events, abort via AbortSignal/client abort, health
probe. Optional application-state mount stays explicit and separate from
project source. Provider config (baseURL/env) lives in the OpenCode recipe,
not in core.

## What is stubbed

`src/opencode-stub.ts` declares the intended typed surface — `Runtime`
(`node`/`expose`/`stop`), `EndpointHandle` (`url`/`port`/`fetch`/`close`),
`startServer(runtime, opts)` (ordinary-app serve launch + expose),
`checkEndpointHealth(endpoint)`, `SessionClient` (`list`/`create`/`send`/
`abort`/`subscribe` with `ChatEvent` text/done/error) — but every method
throws/rejects `not implemented`. `src/main.ts` imports ONLY from the stub
(never kernel bridge globals, `window.demo`, or sibling
`node_modules`/`.runtime` paths), so the UI wiring typechecks but reports
honest failure at runtime.

## F2 acceptance mapping

- Generic endpoint health: `Check health` → `checkEndpointHealth(endpoint)`
  asserts the listener is reachable (transport readiness), not log parsing.
- Real client events: `Send` → `client.send(...)` streams `ChatEvent`
  text deltas into the transcript pane until done/error; requires streaming
  Fetch through the endpoint adapter (task C2 gate).
- Session operates on attached project: sessions are created against the
  server started with `projectRoot: "/workspace"`.
- Server stop/restart preserves durable state: `Stop server` stops execution
  and closes the endpoint while workspace files persist; restart reattaches.
- Model edit reaches Vite HMR when provider permits: out of scope for this
  scaffold's UI; record 429/external failures separately from transport
  success (provider gateway from E1).

## Wire-up step (after API F1/C2 land)

1. Implement `browser-container-poc/workspace-api/` (F1 core + C2 streaming
   fetch) and pin the matched OpenCode application bundle + client (D2).
2. In `src/main.ts`, replace `from "./opencode-stub"` with the real
   `workspace-api` import and pinned client; implement `startServer` as the
   `runtime.node` serve launch + `runtime.expose` + client construction.
3. Delete `src/opencode-stub.ts` (or keep only for type reference).
4. Add `workspace-api` (+ client bundle) dependencies to `package.json`.
5. Verify F2: health probe → create/list session → send prompt → streamed
   text events → abort → stop/restart preserves durable state → (provider
   permitting) model edit reaches Vite HMR.

## Run (once API exists)

```sh
bun install
bun run typecheck
bun run dev   # serves index.html (host server TBD)
```
