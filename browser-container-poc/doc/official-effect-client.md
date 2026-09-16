# Official Effect client migration

September 15, 2026.

## Implementation

- Official `@opencode/client/effect@2.0.3`, matching the prepared OpenCode server.
- Effect `4.0.0-rc.112`, matching the client's exact peer requirement.
- An `OpenCodeAPI` service layer injects the browser-workspace string/init fetch
  through `FetchHttpClient`. Routing query values and authentication supplied by
  the workspace connection remain caller-owned.
- Official resource methods replace handwritten HTTP paths, JSON decoding and
  the SSE parser. Schema values are encoded to the existing wire-shaped React
  snapshots; the upstream transcript reducer remains in use.
- Named Effect programs implement bootstrap, selection, prompts, model changes,
  pagination, interruption and replies. Connection/selection scopes own fibers;
  a Deferred gates handshake readiness, concurrent Effects hydrate snapshots,
  and interruptible sleep coalesces history recovery.
- `ChatAPIError` preserves official errors as causes. `ChatError` represents
  controller validation failures. Public React/host actions remain promises.
- Runtime dependencies and their license notices are bundled. Public snapshot
  types do not require consumers to install Effect or the SDK separately.

## Verification

- Package typecheck and build passed.
- Full package suite: **78 passed, 1 environment-gated skip**. Targeted migration
  checks cover stale selection cancellation, overlap recovery, form/permission
  replies, schema-invalid history, handshake timeout/disposal, stream decoding,
  request bytes/routing and cancellation of scheduled recovery.
- Packed consumer smoke passed: headless install without React/workspace;
  standalone React declarations; editor SSR and browser bundling with its actual
  optional workspace peer; isolated component CSS.
- TODO consumer typecheck/build and **3 tRPC HTTP tests** passed.
- Frozen isolated installation passed after removing identical duplicate local
  workspace lock entries emitted by Bun's dependency-update operation.

## Real browser receipt

Browser Control CLI 0.7.0, session `rapid-badger-571`, loopback admin demo at
`http://127.0.0.1:4391/` with a fresh origin for the initial run.

1. Open editor reached workspace/runtime/chat **Ready** through the injected
   browser-container transport using the official client.
2. New chat created a real OpenCode session.
3. A read-only request ran the native `read` tool against
   `/workspace/src/home.tsx`. The completed tool was rendered in the transcript;
   the assistant correctly reported the `Todos` heading at line 22.
4. A follow-up turn in that same conversation correctly recalled `Todos`.
   Both turns had persisted idle records with `outcome: "succeeded"`:
   `msg_0a7b2ae7b001Hl0HfrrF3SovZS` and `msg_0a7b47c570014z0nJhagtNPPTw`.
5. Reconnect returned to Ready with the same three assistant messages and two
   successful idle records. No visible alert was present.
6. Exit and reopen remounted the runtime and hydrated the same conversation and
   tool result. Model verification did not edit the application source.
7. Desktop sidebar geometry was 520px wide and full-height beside the preview
   at a measured 1839×1065 CSS viewport. At 600×900 CSS pixels, the preview was
   600×360 above a 600×540 editor panel. Screenshots were visually inspected.

The reported encrypted-reasoning caller error did not recur in the tool-backed
turn or follow-up. This demonstrates those successful requests; it does not
establish the cause of the earlier provider rejection.

Automation timing/locator corrections are recorded in
[`todo-app-demo/browser-control-todo.md`](../todo-app-demo/browser-control-todo.md).

## Bundle and run

The TODO demo's final lazy editor JS chunk is **946.45 kB / 291.40 kB gzip**,
compared with **320.16 kB / 108.37 kB gzip** before the SDK/Effect migration.
It is loaded when the editor is opened.

The compiled toolkit has been reinstalled into the TODO consumer and its host
production assets rebuilt. Restart an existing host process to load the current
editor asset manifest, then refresh:

```sh
cd browser-container-poc/todo-app-demo
LOCAL_EDITOR_ADMIN=1 PORT=4390 bun start
```

Open `http://127.0.0.1:4390/` and choose **Open editor**.
