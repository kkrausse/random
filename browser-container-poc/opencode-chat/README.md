# @vivari/opencode-chat

Optional, locally packable OpenCode V2 chat. **The root is headless**: it imports
no React, DOM implementation, CSS, workspace runtime, service discovery or VM
library. `/react` provides a replaceable chat template. All traffic, including
SSE, uses the caller's endpoint.

**Pinned server:** `0.0.0-dev-19167`, revision
`d7a7256bb6b0952f486c95718cfbf460b1570a56`. This is not a latest-beta API client.
See [PROVENANCE.md](PROVENANCE.md) and the distributed full MIT upstream notice.

## Host integration

```tsx
import { createChatController } from '@vivari/opencode-chat';
import { ChatView } from '@vivari/opencode-chat/react';
import '@vivari/opencode-chat/styles.css';

// Create once per host-owned endpoint scope, outside rendering.
const controller = createChatController({
  endpoint: { url: endpoint.url, fetch: (input, init) => endpoint.fetch(input, init) },
  directory: '/workspace', // hidden caller location; never a directory picker
  // sessionID: 'ses_...',
  // autoCreateSession: true, // explicitly opt into mutation on empty bootstrap
});
await controller.ready;

// Give the parent a bounded height; the transcript scrolls inside the panel.
<div style={{ height: 640 }}>
  <ChatView controller={controller} showSessions showModels
    onOpenFile={(path, selection) => editor.open(path, selection)} />
</div>;

// Only when this endpoint scope is truly finished (not each view unmount):
controller.dispose();
```

React >=18 is an **optional peer**. Importing/installing the root does not require
React. Standard web fetch type declarations (`RequestInit`, `Response`) are
needed by TypeScript consumers, e.g. TypeScript's DOM lib or compatible server
fetch types. There is no DOM access in root JavaScript.

### Stable exports

- Root: `createChatController(options)` and public types (`ChatEndpoint`,
  `ChatController`, `ChatSnapshot`, `ChatOptions`, `PromptDraft`, `ModelRef`,
  native `SessionMessageInfo`, request types).
- React: `ChatView`, `useChatSnapshot`, `Transcript`, `MessagePart`, `ToolCard`,
  `Composer`, `PermissionCard`, `QuestionCard`, `Markdown`, `CodeBlock`.
- Explicit CSS: `@vivari/opencode-chat/styles.css`. All selectors scoped under
  `.oc-chat`; no reset, fonts, app assets, Tailwind or host routing required.
  Standalone presentation pieces can be wrapped in `.oc-chat` for these styles.
- `ChatViewProps`: `{controller, showSessions?:boolean, showModels?:boolean,
  onOpenFile?:(path, selection?:{startLine,endLine})=>void}`. Both controls default
  to visible. View unmount only unsubscribes, including Strict Mode remounts.

### Controller

`getSnapshot()` is referentially stable between changes and recursively frozen.
`subscribe(notify)` returns an unsubscribe function. Controllers are isolated.
`ready: Promise<void>` resolves after event handshake and initial hydration;
failures also appear in `snapshot.error`. Catch `ready` to handle host startup.

Actions return promises and reject on failure, also recording visible errors:

| Action | Meaning |
| --- | --- |
| `selectSession(id)` | Cancel prior selection's requests; hydrate chosen session |
| `createSession(title?) → Promise<string>` | Explicit creation and selection |
| `loadOlder()` | Fetch next descending cursor page and prepend in native order |
| `send({text})` | Submit native text prompt; preserve UI draft on failure |
| `selectModel({providerID,id,variant?})` | Persist explicit session model; `undefined` rejects because pinned API has no reset-to-default operation |
| `interrupt()` | Explicit server stop request, retained until authoritative idle/interruption; failure can be retried |
| `reconnect()` | Replace local subscription, hydrate authoritative history/requests/activity |
| `replyPermission(id, 'once'\|'always'\|'reject')` | Pinned permission response |
| `replyQuestion(id, string[][])` / `rejectQuestion(id)` | Ordered answers, respecting single/multi/custom rules |
| `clearError()` | Dismiss local operation error |
| `dispose()` | Abort only controller-owned requests/SSE/timers/listeners |

Snapshot fields: connection, sessionID, sessions, models, model, native messages,
execution (`idle/running/retrying/unknown`), interruptRequested, sending, loading,
loadingOlder, hasOlder, permissions/questions with per-request submitting/error,
and operation error. Disconnection becomes **unknown execution**, not success.
Step completion and prompt HTTP acceptance are not execution completion.

No default session creation, attachment uploads, endpoint lifecycle calls,
server stop/discovery, provisioning, route navigation or directory picker.
Persisted native files render as chips; tool file paths invoke the host callback.
Attachment composer controls are intentionally absent pending a tested upload
adapter and size accounting for the runtime's buffered request limit.

### Streaming and reconciliation

The pinned upstream native reducer preserves mixed content order, per-kind text
and reasoning ordinals, tool IDs, terminal text replacement, retries, shell and
compaction records. Unknown native records retain a readable fallback. Text and
reasoning are tokenized as Markdown; HTML is escaped, images are inert text, and
only safe links become anchors. Code fences support copy and incomplete tails.
Tool input/output/metadata/errors are collapsed and scroll-bounded.

SSE is live-only. Bootstrap establishes `server.connected` before history and
pending-request hydration. Selection/generation tokens reject stale results.
There is no server cursor shared by history and SSE: overlapping deltas are
**not replayed onto history**, which would duplicate persisted text. A short
authoritative refresh follows overlaps/missing reducer state and terminal
events. During overlap, the UI may display snapshot increments rather than
every token. Absolute request events reconcile over hydration; successful and
externally answered requests cannot be resurrected by stale snapshots.
Reconnect is explicit; there is no unbounded automatic network retry loop.

Transcript follow-bottom yields when readers scroll up. Loading older messages
preserves scroll height/position. Rendering uses stable message and tool keys;
completed unchanged message rows are memoized. Markdown retokenizes a changed
part; there is no worker/highlighter or DOM morphing pipeline.

## Build and verification

```sh
bun install
bun run typecheck
bun test
bun run build
bun pm pack --destination /path/to/artifacts
bun test/consumer-smoke.ts
```

Fixture coverage includes mixed ordinal semantics, ended replacement, missing
assistant, bootstrap/selection races, overlapping history/deltas, injected
transport/disposal, permission retry, question rules/removal, interrupt failure,
disconnect/reconnect, pagination and markup safety. Consumer smoke installs the
tarball outside this tree, checks headless installation without React, compiles
headless declarations and bundles/SSR-renders a separate React consumer.

**Not yet verified live:** real guest prompt/tool/permission/question/stop flow,
browser clipboard and IME interactions, scroll/selection behavior and responsive
visual QA. Those checks belong to fresh host integration against the pinned
guest. Fixture evidence is not a claim of real-server/browser QA.
