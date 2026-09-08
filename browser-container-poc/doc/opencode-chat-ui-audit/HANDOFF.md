# Implementation handoff: optional workspace chat

Read [the source audit](README.md) for exact upstream paths, dependency evidence, revision, and license. This document is a **proposed boundary**, not newly implemented exports. Main packaging work owns final package names and API names.

## Decision and v0 scope

Provide two independently consumable layers:

1. **Headless:** injected endpoint → native V2 API/controller → immutable observable snapshots and actions. No React, DOM, CSS, or workspace navigation requirement. Custom consumers can use it directly.
2. **Optional React UI:** controller → transcript, Markdown/code, generic tool disclosure, textarea composer, request cards, stop/reconnect controls. Export useful presentation pieces as well as a composed chat view, with host callbacks for opening files. Keep dependency installation, styling, and imports optional for headless consumers.

The host opens the workspace and supplies its directory, endpoint and selected session. A workspace editor normally already has file navigation. Chat should work as a single panel without a directory picker, project header, route layout, native server picker, or a duplicate editor. Session history/model selection can be provided controls or host-controlled props; neither requires directory navigation.

**v0 supplied UI:** text/reasoning/tool/file message parts; incremental sanitized Markdown and readable code fences with copy; generic named-tool input/output/error disclosure; patch text/summary plus host file-open callback; simple attachment chips and upload/removal; enabled model choices; flat workspace-scoped session history/new session; real permission/question responses; execution/retry/error status; stop and reconnect; follow-bottom that yields to the reader. Preserve a visible fallback for unknown message/tool kinds.

Plain code/patch rendering is sufficient for first integration. Syntax highlighting, Pierre diffs, virtualized history, rich mentions/slash command editing, tool-specific polish, session tabs, and review comments are subsequent increments. Implement the attachment controls only when the pinned request adapter supports them; an enabled button must not silently discard files.

## Minimum host/controller seam

Illustrative TypeScript; `Snapshot`, `PromptDraft`, `PermissionDecision`, and `QuestionAnswers` below stand for the locally owned types described after the sketch. They are not imports from the upstream Solid package.

```ts
// Same narrow fetch contract as Workspace Endpoint; UI does not discover services.
type ChatEndpoint = {
  url: string;
  fetch(input: string, init?: RequestInit): Promise<Response>;
};

type HostContext = {
  endpoint: ChatEndpoint;
  directory: string;          // hidden runtime location; supplied by caller
  sessionID?: string;        // or caller opts into explicit creation
};

interface ChatController {
  getSnapshot(): Snapshot;   // stable reference until a real change
  subscribe(notify: () => void): () => void;
  ready: Promise<void>;
  selectSession(id: string): Promise<void>;
  createSession(title?: string): Promise<string>;
  loadOlder(): Promise<void>;
  send(draft: PromptDraft): Promise<void>;
  selectModel(model: { providerID: string; id: string } | undefined): Promise<void>;
  interrupt(): Promise<void>;
  reconnect(): Promise<void>;
  replyPermission(requestID: string, decision: PermissionDecision): Promise<void>;
  replyQuestion(requestID: string, answers: QuestionAnswers): Promise<void>;
  rejectQuestion(requestID: string): Promise<void>;
  dispose(): void;
}

// Optional React package can subscribe with useSyncExternalStore.
// Conceptual props, not a claim that these exports currently exist:
type ChatViewProps = {
  controller: ChatController;
  showSessions?: boolean;
  showModels?: boolean;
  onOpenFile?: (path: string, selection?: { startLine: number; endLine: number }) => void;
};
```

If main packaging already provides a controller, add a thin view adapter around it. Do not introduce a second event subscription/history store inside the UI. Keep action names aligned with that controller rather than adding synonymous parallel APIs.

`Snapshot` needs connection state (`connecting/connected/disconnected`), selected session, session choices, model choices/selection, canonical messages or derived stable-key view rows, execution status (`idle/running/retrying`, with authoritative completion/interruption/error), pending permission/question requests with per-request submitting/error state, history pagination/loading, and operation errors. A snapshot is per controller/endpoint scope, not a module-global selected session. Transport disconnection is distinct from execution completion.

`PromptDraft` contains text plus prepared attachment descriptors and optional selected model. Keep browser preview `blob:` URLs separate from serializable server attachments: upstream UI's attachment `{blob:{id,url}}` is a local UI format, not the native prompt payload. Build native file descriptors from the pinned schema/generated request types. `PermissionDecision` is `"once" | "always" | "reject"`; pinned `QuestionAnswers` is `string[][]`, ordered by question, containing selected labels/custom text. Respect each question's `multiple` and `custom` fields.

**Ownership/lifecycle:** the caller owns the workspace and Endpoint. A provided view unsubscribes on unmount; it disposes only a controller it created, not a caller-owned shared controller. Controller disposal cancels its fetch/SSE, timers, pending loads and listeners. It does not dispose the workspace endpoint or automatically interrupt a shared server session. Stop is an explicit server action. The host can translate Endpoint `closed` into a controller disconnect action if useful.

### Fetch details for this browser runtime

Existing [`OpenCodeAPI`](../../opencode-client-demo/src/api.ts) uses string URLs and the injected `endpoint.fetch`. Preserve that path for **all** requests, including SSE, rather than using global fetch or a native service. Endpoint fetch currently takes `(string, RequestInit?)`; it is narrower than `typeof globalThis.fetch`. Do not fix this with an unchecked cast when adding a generated client. Either retain the string-only transport or implement a tested `Request`/`URL` adapter preserving method, headers, body, and signal and respecting the runtime's buffered-upload limit.

The current endpoint documents buffered uploads capped at **8 MiB**; base64/JSON expansion counts toward that request limit. Attachment preparation must check serialized size, preserve draft on failure, and revoke local object URLs on removal/disposal. Preview bytes can come from the host; a private file URI is not necessarily browser-fetchable.

At audit time, [`client.ts`](../../opencode-client-demo/src/client.ts) is a vanilla DOM mount used by a React host: full transcript replacement, text-only part labels, forced scrolling, and text delta tracking in `content[ordinal]`. Its wire API has `{providerID,id}` and custom injected fetch. Preserve those transport/runtime decisions while replacing the presentation and per-kind delta handling.

## Exact V2 data boundaries to implement first

Pinned source: `packages/schema/src/{model,session-message,session-event,permission,question}.ts` and `packages/client/src/promise/generated/{types,client}.ts`, all at `d7a7256bb6b0952f486c95718cfbf460b1570a56`.

| Boundary | Required behavior |
| --- | --- |
| Model refs | Native pinned wire is `{providerID,id,variant?}`; the currently fetched public `Model.Ref` also uses `id`. Upstream display/composer types use `modelID`. Translate only at a named adapter boundary; do not infer wire fields from display types. |
| Native history | Preserve `SessionMessageInfo` union and content order. Do not flatten tools into strings or discard unknown native records. UI rows can be a smaller derived model with stable IDs. |
| Live content identity | Text/reasoning are keyed by `(sessionID, assistantMessageID, kind, ordinal)`; tools by tool ID. Text ordinal `0` can refer to the third content item after reasoning and a tool. Terminal `*.ended` payloads replace, not append, accumulated text. |
| Reduction | Copy/port the type-only `server-session-v2-reducer.ts` first if compatible with main controller; use its source tests as fixture references. It mutates its own pending-input map but returns message arrays. Call `clear(sessionID)` on scoped disposal/reset. Add missing-state recovery around it. |
| Bootstrap/reconnect | Subscribe and establish the connection marker, hydrate authoritative history and pending requests, then reconcile buffered live events without duplicating deltas. Keep a generation token for selected endpoint/session; stale completions cannot update the new selection. On live-only reconnect, refetch authoritative state; do not assume replay or resume from a stale delta buffer. Do not blindly reapply deltas already represented in a history snapshot. |
| Step vs execution | Step-ended is not necessarily session completion; multiple assistant steps/tool calls may follow. Prompt HTTP resolution is not necessarily execution success. Use execution lifecycle and refresh authoritative history/status on completion or transport recovery. |
| Permissions | Pinned generated client: `GET /api/permission/request`, `GET /api/session/{sessionID}/permission`, `POST /api/session/{sessionID}/permission/{requestID}/reply`. Match body to pinned generated type; consume `permission.asked/replied`. |
| Questions | Pinned generated client: `GET /api/question/request`, `GET /api/session/{sessionID}/question`, `POST /api/session/{sessionID}/question/{requestID}/reply` and `/reject`. Consume `question.asked/replied/rejected`. Latest-doc `/form` is not a drop-in route. |
| Cancel | Invoke `POST /api/session/{sessionID}/interrupt`; local abort cleans transport only. Keep an “interrupt requested” state until authoritative resolution, including when the interrupt call fails. |

For bootstrap, the reducer's “missing assistant → no touched messages” case and admitted/promoted input dependency are explicit recovery signals to consider. The reducer does not solve history/event ordering by itself; borrow reconciliation ideas from `server-session.ts`, or use the main controller's tested authoritative-refetch strategy before optimizing streaming recovery.

## Staged implementation and file ownership

These are suggested work units. **No permission to edit concurrently owned files is implied.** Main agent `ses_f80b87aabffecxahTVNNLC30bT` owns workspace-api, client, runtime, React packaging and workspace-demo. This audit sidequest owns only `doc/opencode-chat-ui-audit/` and creates no shared implementation changes.

| Stage | Deliverable / suggested ownership after explicit handoff | Exit criterion |
| --- | --- | --- |
| 1. Headless data contract | Main client owner extends its existing controller: native union, stable snapshots, per-kind reduction, requests, explicit server interruption. Vendored reducer + notice in that owner's client source area if chosen. | A non-React consumer can list/select/create, send, observe mixed parts, answer a request, reconnect and stop using only injected Endpoint. |
| 2. Minimal optional React UI | A fresh UI agent gets a **new package directory chosen by main packaging owner**. Add ChatView/Transcript/MessagePart/ToolCard/Composer/RequestCard and a small subscription hook; presentation uses controller callbacks. | Fixture host renders all v0 states without runtime startup or directory navigation. Headless import loads no React/CSS. |
| 3. Markdown/source helpers | Same UI owner copies `markdown-stream.ts` + `markdown-projection.ts` with MIT notice/revision, builds a React block renderer with sanitization, plain-code fallback and copy. Later add worker-backed highlighting if measured need. | Partial fenced Markdown, completion and error fallback work; model-produced HTML cannot execute; completed blocks and selected text remain stable while tail streams. |
| 4. Workspace integration | Main/demo owner wires its packaged controller and actual browser endpoint into the optional view; retains host editor `onOpenFile`. | Existing fresh-consumer/React packaging checks pass and real guest conversation/tool/request/stop flow is verified. |
| 5. Targeted refinements | UI owner adds patch/code highlighting, specialized tool views, paged-history windowing, composer machine if required. | Each feature has measured/observed need and preserves fixture/real-flow checks. |

Copy priority: **native reducer → Markdown projection pair → small permission/tool card behavior → composer machine if rich editing is needed**. Avoid a whole `message-part.tsx`, timeline or app copy: respective core files are 2,647, 1,508 and (session page) 2,374 lines before dependencies. Do not copy tests for cosmetics; reuse upstream behavioral cases for the actual reducer/Markdown code that gets adopted.

## Acceptance tests for the implementation agent

1. **Native V2 adapter:** reasoning → tool → text with text ordinal zero; multiple text ordinals; `ended` replacement; tool streaming/running/completed/error; unknown tool fallback; retries and multiple steps. Check persisted history equals final live view without duplicate text. Include assistant at a history page boundary and missing-start recovery.
2. **Transport/lifecycle:** all HTTP and SSE hit the injected fetch; no implicit service/global-fetch fallback; reconnect during generation; selection change while history is pending; disposal while send/stream is active; two views/controllers remain isolated. Cover `Request` inputs if a generated client adapter is added.
3. **Requests:** load pre-existing permission/questions on mount; live arrival/removal; allow once/always/reject; single/multi/custom answer rules; response failure retains request and error; request answered elsewhere disappears without duplicate submission.
4. **Composer:** Enter sends, Shift+Enter inserts newline, IME composition does not submit; failed submission preserves text/files; stop hits interrupt; local request abort does not claim stopped; file previews are revoked and oversized uploads rejected before send.
5. **Transcript/browser:** sanitized Markdown links/HTML, incomplete fences, code-copy contents, large tool output disclosure, unknown parts, keyboard-accessible controls, follow-bottom while following and no jump while reading older content. Load older history preserves the visible anchor; streaming does not recreate the whole transcript subtree.
6. **Package/host:** build a fresh React consumer outside this monorepo using packed artifacts; no private upstream workspace imports or missing worker/CSS assets. Headless-only consumer compiles without React. Strict Mode mount/unmount does not create duplicate sessions/streams or dispose the host endpoint. Use the required `browser-control` CLI for visible-browser checks.
7. **Real guest:** on the pinned runtime, create/select session with hidden caller directory, choose enabled model, send prompt, observe streaming/tool output, open affected file in host editor, answer an actual request and interrupt an active run. Record runtime/revision and distinguish fixture evidence from live evidence.

## Handoff status

Source audit and a targeted upstream-reducer fixture probe are complete. No UI code, dependency installs, packaging changes or guest modifications were made. Next concrete task: agree the main controller's snapshot/action boundary, then assign a new isolated React UI package directory and implement stages 1–3 against pinned mixed-message/request fixtures before touching the demo.
