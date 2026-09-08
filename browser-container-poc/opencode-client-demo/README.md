# Reusable OpenCode 2 browser chat

`src/client.ts` has no top-level DOM effects. Its shadow-root styles are self-contained.

```ts
import { mountOpenCodeClient } from "../opencode-client-demo/src/client";

const chat = mountOpenCodeClient(container, {
  endpoint: { url: endpoint.url, fetch: endpoint.fetch.bind(endpoint) as typeof fetch },
  directory: "/workspace",
});
// Before replacing the endpoint or destroying the containing workspace:
chat.dispose();
```

Contract: `mountOpenCodeClient(container: HTMLElement, options?: { endpoint?: {url: string; fetch: typeof fetch}; mock?: boolean; directory?: string }): {dispose(): void}`.
The endpoint URL type reuses `workspace-api`'s `Endpoint`; its public fetch signature follows the integration contract. Requests passed to it are absolute URL strings plus `RequestInit`, including cancellation signals. Bind adapters that rely on `this`. The parent owns Workspace, Runtime, server launch, endpoint disposal, credentials and transport routing. This client never discovers or starts a native service and never falls back to global fetch. An omitted endpoint displays a waiting state.

For demo placeholders explicitly use `{ mock: true }`. This takes precedence over an endpoint and displays **MOCK — in-memory fixtures**. Fixtures implement the same HTTP/SSE boundary, deterministic text chunks, model choice, session creation/history and interruption. They are ephemeral and perform no model/tool execution. The standalone harness opts into this mode.

## Run

```sh
bun install
bun run dev          # http://localhost:5194, explicit fixture harness
bun run typecheck
bun test
bun run build
```

## V2 contract verification

Sources fetched 2026-09-07 (V2 only):
- https://opencode.ai/v2/docs/build/client
- https://opencode.ai/v2/docs/api
- https://opencode.ai/v2/openapi.json

HTTP adapter uses documented `data` envelopes and cursor pagination: `GET/POST /api/session`, `GET /api/model?location[directory]=…`, `GET /api/session/:id/message`, `POST /api/session/:id/model` with `{model:{providerID,modelID}}`, `POST /api/session/:id/prompt` with `{text}`, and `POST /api/session/:id/interrupt`. Prompt admission is not completion. Both session and message lists follow all `cursor.next` pages; history is chronological. Models are switched before the next prompt; “Server default” leaves the session's existing/default choice in place.

The published OpenAPI describes SSE payloads only as JSON strings. Event envelopes and `session.text.delta`, `session.text.ended`, and `session.execution.*` fields were therefore checked against the existing POC installation's **`@opencode-ai/core` and `@opencode-ai/schema` 0.0.0-dev-19167**, specifically `schema/dist/event.js` and `schema/dist/session-event.js`. Events have `type` and `data`; text payloads carry `sessionID`, `assistantMessageID`, `ordinal`, and `delta`/`text`. HTTP paths are verified against the published V2 spec, not claimed to have been exercised against a running bundled server.

The SSE reader supports split UTF-8, CRLF/LF frames, comments, multiline data, Effect failure events and abort-driven reader cancellation. Sending is enabled after `server.connected`, avoiding the initial subscription race. Disconnects are explicit; use Reconnect to reload authoritative history, since V2 subscriptions have no replay. Dispose closes local requests/subscriptions; it does not interrupt server execution or dispose the parent's endpoint. Abort execution invokes the real interrupt endpoint as well as cancelling the in-flight prompt request.

## Scope and limitations

Minimal plain DOM controls intentionally match this POC's dependency-light UI. Plain-text messages, reasoning and tool summaries are rendered safely as text. Rich tool views, attachments, permission/form replies, provider authentication, and deletion are outside this chat's current UI. A model can pause awaiting a permission/form response; Abort remains available even for an already-running selected session. Simultaneous clients can modify sessions; refresh reloads their state. Very large histories currently load all pages. Connection changes require dispose/remount. V2 remains beta; a future runtime bundle may require a schema update. No real in-browser OpenCode HTTP endpoint was available during this implementation; deterministic transport tests cover behavior without using a native service.
