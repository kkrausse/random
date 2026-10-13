# reading-context-client

The one place Reading Context talks to OpenCode Server v2. It is a small normalized layer over the
official `@opencode/client` (pinned to an exact version in `package.json`), used by:

- the Chrome extension, which imports `src/index.ts` directly as the workspace package
  `reading-context-client`;
- the Android app, which loads the bundle built from `src/android-bridge.ts` in a hidden WebView
  and calls it across a JavaScript bridge.

Everything that crosses the API is plain JSON-serializable data. There are no classes.

```sh
bun install            # at the repository root (bun workspace)
cd client
bun run check          # tsc
bun run build:android  # rebuild app/src/main/assets/reading-client.js
bun run verify         # end to end against a throwaway local server and a fake provider
bun run verify:bridge  # the built Android bundle in headless Chrome, same server
```

## Shared API

```ts
import { createReadingClient } from "reading-context-client";

const client = createReadingClient({ baseUrl, password, directory });
```

`createReadingClient(config, options?)` takes `{ baseUrl, password, directory }` (`directory` is
the server-side workdir, OpenCode's "location") and optional `{ fetch, onRequestFailure,
requestTimeoutMs }`. Every method returns a Promise and rejects with an `Error` whose `message` is
fit to show to the reader (for example `OpenCode returned HTTP 401: the server password is missing
or wrong.` or `Cannot reach OpenCode: ...`).

| Method | Arguments | Result |
| --- | --- | --- |
| `checkConnection` | none | `{ version }` |
| `listModels` | none | `Model[]` |
| `listSessions` | `{ limit? }` (default 50) | `Session[]`, most recently updated first |
| `createSession` | `{ model?, title? }` | `Session` |
| `getSession` | `sessionId` | `Session` |
| `setModel` | `sessionId`, `model` | nothing |
| `sendPrompt` | `sessionId`, `text` | `{ messageId }` |
| `interrupt` | `sessionId` | `{ interrupted }` |
| `listMessages` | `sessionId` | `Message[]`, oldest first, latest 200 |
| `loadConversation` | `sessionId`, `{ pendingMessageId? }` | `Conversation` |
| `subscribe` | `sessionId`, `onEvent` | `{ ready, close }` |

Data shapes:

```ts
ModelRef     { providerId: string, modelId: string, variant?: string }
Model        { providerId: string, modelId: string, name: string, variants: string[] }
Usage        { input, output, reasoning, cacheRead, cacheWrite, cost }   // tokens; cost in USD
Session      { id, title, created, updated, model?: ModelRef, usage: Usage,
               outcome?: "succeeded" | "failed" | "interrupted" }        // times in epoch ms
Message      { id, role: "user" | "assistant", text, complete, created,
               model?: ModelRef, usage?: Usage, durationMs?, tools?: string[], error?: string }
Conversation { session: Session, messages: Message[], busy: boolean, error?: string }
```

Things worth knowing:

- **The model belongs to the session.** v2 has no per-prompt model. Pass `model` to
  `createSession`, or change it later with `setModel`; `sendPrompt` only carries text. A variant of
  `""` or none means the model's default.
- **`sendPrompt` returns immediately.** The reply arrives through `subscribe`. Keep the returned
  `messageId` and pass it to `loadConversation` as `pendingMessageId`: until the server has turned
  the queued prompt into a message, that is the only sign the chat is busy.
- **One assistant message is one provider step.** A question that uses a tool produces a tool-only
  step with empty `text` and then the answer. UIs skip `complete` assistant messages with empty
  text; their `usage` still counts.
- **Totals come from the server.** `Session.usage` is the server's own running total for the
  session and includes title generation, so it can exceed the sum of the visible messages.
- **`Conversation.busy`** is the server's authoritative "still working" state.
  `Conversation.error` is set when the most recent run failed.
- **`listModels`** returns active, enabled models. Right after a server start the list is briefly
  empty while the location loads; the client retries for about two seconds before returning.

### Events

`subscribe(sessionId, onEvent)` opens the server's single global event stream, keeps the events for
that session, and normalizes them. It reconnects by itself (1 s, 2 s, 4 s ... capped at 10 s) until
`close()` is called, and treats 45 s without the server's 15 s heartbeat as a dead connection.
`ready` resolves `true` once the stream is first connected.

| `kind` | Other fields | Meaning |
| --- | --- | --- |
| `connected` | `reconnected: boolean` | Stream is open. If `reconnected`, events may have been missed: reload the conversation. |
| `disconnected` | `message` | Stream dropped; a reconnect is already scheduled. |
| `busy` | | The server started working on a prompt. |
| `message` | `messageId`, `model: ModelRef` | A new assistant message (one step) started. |
| `reasoning` | `messageId` | The model is thinking before it answers. |
| `text.delta` | `messageId`, `delta`, `text`, `fromStart` | More answer text. `text` is everything received for this message so far. |
| `text.done` | `messageId`, `text` | Authoritative full text of the finished text part. |
| `tool` | `messageId`, `tool`, `status: "started" \| "completed" \| "failed"` | Tool activity. `tool` can be `""` if the start was missed. |
| `retry` | `attempt`, `message` | The provider call failed; the server will try again. The run stays busy. |
| `blocked` | `reason: "permission" \| "question"`, `message` | The run waits for an answer these UIs cannot give. Offer Stop. |
| `usage` | `usage: Usage` | New session totals. |
| `title` | `title` | The server named the session. |
| `idle` | `outcome: "succeeded" \| "interrupted"` | The run finished. Reload the conversation. |
| `error` | `message` | The run failed. Terminal, like `idle`. |

`fromStart: false` on a `text.delta` means the subscription joined while the message was already
streaming, so `text` lacks its beginning (the server does not expose partial text any other way).
The following `text.done` carries the whole text.

A UI can be driven by rendering `text` from `text.delta`/`text.done` as the streaming message, and
calling `loadConversation` on `idle`, `error`, and `connected` with `reconnected: true`.

## Android bridge

`bun run build:android` bundles `src/android-bridge.ts` and everything it needs into one classic
script, `app/src/main/assets/reading-client.js` (ES2020 syntax, no module imports, no Node or bun
APIs). The built file is committed so the Android build needs no JavaScript toolchain; rebuild and
commit it whenever `client/src` or the `@opencode/client` pin changes.

### Loading it

The script must run in a page whose origin is the OpenCode server, so its `fetch` calls are
same-origin (the server sends no CORS headers for other origins). Give the WebView a document with
the script inline and the server URL as base URL; nothing is fetched for the page itself:

```java
webView.getSettings().setJavaScriptEnabled(true);
webView.addJavascriptInterface(host, "AndroidHost");   // before loading
webView.loadDataWithBaseURL(serverUrl + "/",
        "<!doctype html><script>" + readAsset("reading-client.js") + "</script>",
        "text/html", "utf-8", null);
// after onPageFinished:
webView.evaluateJavascript("window.ReadingBridge.call("
        + JSONObject.quote(callId) + "," + JSONObject.quote(method) + ","
        + JSONObject.quote(argsJson) + ")", null);
```

Do not navigate the WebView to the server URL instead: the server answers every path with its own
web UI under a Content-Security-Policy that blocks inline scripts. When the server URL setting
changes, load the document again with the new base URL and call `configure` again. `AndroidHost`
methods are invoked on WebView's JavaScript bridge thread, not the UI thread. The page keeps its
event stream only while the WebView's timers run, so do not call `pauseTimers()` or `onPause()` on
it while a chat is open; `unsubscribe` when the chat screen goes away.

### Contract

Java to JS, always this one entry point, all arguments strings:

```js
window.ReadingBridge.call(callId, method, argsJson)
```

JS to Java, `addJavascriptInterface` methods taking strings:

```js
window.AndroidHost.resolve(callId, resultJson)        // exactly once per call, on success
window.AndroidHost.reject(callId, errorMessage)       // exactly once per call, on failure
window.AndroidHost.event(subscriptionId, eventJson)   // any number of times per subscription
```

`callId` is any string unique among calls in flight. `argsJson` is a JSON object (`"{}"` when a
method takes no arguments). `resultJson` is always valid JSON, `"null"` for methods without a
result. `errorMessage` is plain text for the reader, not JSON.

| `method` | `argsJson` | `resultJson` |
| --- | --- | --- |
| `configure` | `{ "baseUrl", "password", "directory" }` | `{ "configured": true }` |
| `checkConnection` | `{}` | `{ "version" }` |
| `listModels` | `{}` | `Model[]` |
| `listSessions` | `{ "limit"? }` | `Session[]` |
| `createSession` | `{ "model"?: ModelRef, "title"? }` | `Session` |
| `getSession` | `{ "sessionId" }` | `Session` |
| `setModel` | `{ "sessionId", "model": ModelRef }` | `null` |
| `sendPrompt` | `{ "sessionId", "text" }` | `{ "messageId" }` |
| `interrupt` | `{ "sessionId" }` | `{ "interrupted": boolean }` |
| `listMessages` | `{ "sessionId" }` | `Message[]` |
| `loadConversation` | `{ "sessionId", "pendingMessageId"? }` | `Conversation` |
| `subscribe` | `{ "subscriptionId", "sessionId", "readyTimeoutMs"? }` | `{ "connected": boolean }` |
| `unsubscribe` | `{ "subscriptionId" }` | `null` |

- `configure` must be the first call; anything earlier is rejected with `Call configure first.`
  Calling it again replaces the connection and closes every subscription. An empty `baseUrl` means
  the page's own origin. It does not contact the server; use `checkConnection` for that.
- `subscribe` resolves once the event stream is connected, or after `readyTimeoutMs` (default
  5000) with `connected: false` while it keeps connecting. Send the prompt after it resolves so the
  first events are not missed. Each event is delivered as
  `AndroidHost.event(subscriptionId, eventJson)` where `eventJson` is one event object from the
  table above. Subscribing again with a `subscriptionId` in use replaces that subscription.
- After `unsubscribe` resolves, no further event is delivered for that `subscriptionId`.
- Unknown methods and missing required arguments are rejected (`Unknown method: x`,
  `Missing argument: sessionId`).

Field names and shapes are exactly those of the shared API above.

## Mock harness

Nothing here ever contacts a real model.

- `scripts/mock-provider.ts` is a fake OpenAI-compatible `/v1/chat/completions` streaming server.
  Directives in the prompt steer it: `[[slow]]` (streams for about 30 s, for interrupt tests),
  `[[reasoning]]`, `[[tool:glob {"pattern":"*"}]]` (one tool call, then an answer), `[[fail]]`
  (HTTP 500). It records the tool names each request offered, which is how `verify` checks the
  server policy.
- `scripts/dev-server.ts` starts `opencode serve` on `127.0.0.1` in a scratch directory laid out
  like the Pi deployment (`deploy/opencode.json` from `server/runtime/`, `deploy/workdir`), with its
  own `HOME` and `XDG_*` homes, a minimal environment, a dead outbound proxy, and a config that
  registers the fake as provider `mock` (models `mock-1`, `mock-2`) and enables only that provider.

```sh
cd client
bun run verify                                    # scratch under client/.scratch
SCRATCH=/some/dir PORT=41555 bun run scripts/dev-server.ts   # keep a server running; prints URL and password
OPENCODE_BIN=/path/to/opencode bun run verify     # test another CLI build
CHROME=/path/to/chrome bun run verify:bridge
```

The harness always passes the `mock` model explicitly. Do the same in anything built on it: for a
moment after a location first loads, the server lists the bundled catalog's hosted models before
the provider restriction applies.
