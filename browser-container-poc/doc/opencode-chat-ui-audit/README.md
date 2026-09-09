# OpenCode V2 chat UI: source audit

**Recommendation: ship a headless client/controller plus an optional, small React chat UI. Reuse selected OpenCode algorithms and interaction patterns; do not vendor the app shell.** Consumers should be able to supply their own UI. The provided UI should take an existing controller and display a conversation, with optional session/model controls. Directory is caller-supplied runtime context, not required navigation.

The most useful discovery is that OpenCode already separates `packages/session-ui` from `packages/app`. However, this is **a private Solid package, not a ready-to-import React chat library**. Its native V2 adapter is in the app, outside that package. See [implementation handoff](HANDOFF.md) for scope, contract, ownership, and acceptance tests.

## Provenance and version boundaries

Audited 2026-09-07 from the actual Git objects in local checkout `/Users/kkrausse/Documents/repos/anomalyco/opencode`, remote **[anomalyco/opencode](https://github.com/anomalyco/opencode)**. All upstream source links below are pinned to **`d7a7256bb6b0952f486c95718cfbf460b1570a56`**, committed 2026-08-10 (`test: stabilize Windows CI timing (#41600)`). Files were extracted with `git archive` into an isolated temporary directory; the checkout's HEAD was a different revision and was not used as the audit baseline.

- This is the revision matched by the existing browser guest's core/schema **`0.0.0-dev-19167`**. Local receipts: [`vivari-v2-results.md`](../vivari-v2-results.md), [`editable-app-demo/prepare.ts`](../../editable-app-demo/prepare.ts), and [`TESTING-HANDOFF.md`](../../editable-app-demo/TESTING-HANDOFF.md). This audit did not rebuild or independently rematch the guest binary.
- The actual interactive app is [`packages/app`](https://github.com/anomalyco/opencode/tree/d7a7256bb6b0952f486c95718cfbf460b1570a56/packages/app), with Solid, Vite, Tailwind, Kobalte, Solid Router, and TanStack Solid Query/Virtual. `packages/web` is an Astro site, not the chat app entrypoint. **Solid does not mean V1:** this matched V2 app consumes the generated V2 client and native V2 events.
- At this revision, manifests say `@opencode-ai/app`, `@opencode-ai/session-ui`, and `@opencode-ai/ui` version `1.18.15`; the client manifest says `1.17.13`. Those source manifest numbers are not the published dev-19167 distribution version and do not establish API compatibility by themselves.
- A second version boundary exists *inside* the V2 app: `session-ui` imports compatibility `Message`/`Part` types from `@opencode-ai/sdk/v2` (its manifest points to a vendored `opencode-ai-sdk-1.18.8-dev.tgz`). Native V2 history uses `type: "assistant"`, `content`, and model `{providerID, id}`; the compatibility render model uses `role`, separate parts, and `modelID`. An import path containing `/v2` is not proof of compatibility with the current V2 HTTP server.
- Fetched the official [V2 introduction](https://opencode.ai/v2/docs/), [client guide](https://opencode.ai/v2/docs/build/client), and [API reference](https://opencode.ai/v2/docs/api). Current docs name `@opencode/client@beta`; the [matched source guide][client-guide] names `@opencode-ai/client@next`. Current API docs expose **forms**, whereas the pinned app/server use **questions**. Use the pinned schema/generated contract for implementation, not a silent latest-client upgrade.
- Explicitly checked the current [published OpenAPI](https://opencode.ai/v2/openapi.json): `Model.Ref` currently requires `id` and `providerID`, with optional `variant`, **also matching the pin**. Do not assume the latest wire field is `modelID` based on UI examples or earlier documentation. The verified `modelID` mismatch here is the compatibility UI model; the verified current HTTP drift is questions→forms.

## Source inventory and reuse decisions

Paths are relative to the pinned repository. “Port” means adapting the presentation to React, not treating Solid JSX as React JSX.

| Capability | Actual source and useful entry points | Coupling / reuse decision |
| --- | --- | --- |
| Transcript composition | [`app/src/pages/session/timeline/message-timeline.tsx`][timeline], `rows.ts`, `projection.ts`, `row-reconciliation.ts` in the same directory | Actual V2 timeline, not just an older `SessionTurn` example. Solid virtualizer, language context, file component, app types, gesture/measurement helpers. `rows.ts` imports grouping functions from the large `message-part.tsx`. Use row identities/grouping as reference; whole timeline copy is costly. |
| Message/part presentation | [`session-ui/src/components/message-part.tsx`][parts]: `Message`, `Part`, `AssistantParts`, `PART_MAPPING`, `ToolRegistry`; [`context/data.tsx`][data] | Solid + compatibility SDK types; Data, I18n, Dialog, FileComponent contexts; core path/encoding helpers, UI primitives, motion. Data includes session/message/part/status/diff maps and `directory`. Port a small registry with a generic fallback; avoid importing this 2,647-line module for one renderer. |
| Native history → render model | [`app/src/utils/session-message.ts`][normalize]: `normalizeSessionMessages`, `sessionMessagePartID` | Type imports plus Effect JSON decoding. Converts native text/reasoning/tool content, files, shell, compaction and switched model/agent records into compatibility messages/parts. Best reference for field translation; do not make the compatibility model a new public API. |
| Live V2 state | [`app/src/context/server-session-v2-reducer.ts`][reducer]: `createV2SessionReducer`; [`server-session.ts`][session-store] | Reducer has **only type imports** and is directly reusable with pinned types. Covers step, text, reasoning, tools, retry, shell, compaction, input admission/promotion. Store adds history loading/reconciliation and normalization. Reducer is not a complete reconnect/bootstrap controller. |
| Streaming Markdown/code | [`session-ui/src/components/markdown-stream.ts`][md-stream]: `stream`, `project`; [`markdown-projection.ts`][md-projection] | Best small source-copy candidate: 122 + 11 lines; Marked + Remend and a type-only circular import. Projects completed blocks, live tail, open code fence; no router, directory, Solid, or SDK dependency. |
| Full Markdown renderer | [`session-ui/src/components/markdown.tsx`][markdown], `markdown-worker.ts`, `markdown.worker.ts`, `markdown-cache.tsx` | Solid DOM lifecycle, worker transport, Shiki streaming tokens, Marked, Remend, DOMPurify, morphdom, core checksum, copy-button Solid roots and i18n. Port the block protocol first. Full worker renderer is a separate optimization, not a small component copy. Preserve sanitization and stale-worker disposal semantics. |
| File/code/diffs | [`session-ui/src/components/file.tsx`][file], `session-diff.ts`, `apply-patch-file.ts`, `pierre/*`; `v2/components/session-review-v2.tsx` | Pierre diff/file instances, worker pool, selection bridges, themes, virtualizer, Solid lifecycle. For v0 render bounded patch text/addition counts and call the host's `onOpenFile`. Port pure diff normalization later; full review/file panel duplicates editor responsibilities. |
| Tool execution | [`message-part.tsx`][parts], `basic-tool.tsx`, [`v2/components/basic-tool-v2.tsx`][basic-tool], `tool-error-card.tsx`, `v2/components/tool-error-card-v2.tsx` | Actual registry has specialized tool renderers and a generic fallback; context tools (`read/glob/grep/list`) can group, todos have separate treatment. `BasicToolV2` itself is comparatively presentational: trigger/title/subtitle/args/changes/status/open callbacks, but still Solid/Kobalte/CSS. Port generic disclosure + status, then read/edit/write/shell views. Preserve unknown tool output. |
| Composer and attachments | [`session-ui/src/v2/components/prompt-input/index.tsx`][composer], [`interaction.ts`][interaction], [`machine.ts`][machine], `store.ts`, `attachments.ts`, `types.ts` | Real extracted composer seam: explicit controller, draft store, history, suggestions, attachment handlers, injected model control. State machine is type-only TS; interaction/store are Solid. App integration [`app/src/components/prompt-input-v2.tsx`][app-composer] pulls SDK, files, comments, layout, permission, language, commands, prompt store. Use the seam; start with a React textarea and attachment chips rather than importing app integration. |
| Model selector | [`app/src/components/dialog-select-model.tsx`][models]: `ModelSelectorPopoverV2`; `dialog-select-model-search.ts` | `useLocal().model`, provider ordering, language, dialogs, tooltips and keybindings. Reuse search/display rules if useful; simple caller-supplied choices + selection callback are sufficient. Keep display IDs separate from wire model refs. |
| Sessions/history | [`app/src/pages/home/home-sessions-view.tsx`][history], `home-sessions-controller.tsx`; [`timeline/model.ts`][timeline-model] | Home view has server/group/tab/avatar/project and many scroll/search props. Timeline model uses ServerSync/Sync and session identity/history. Provide an optional flat session list scoped by the caller's workspace; do not copy home navigation. |
| Permissions | [`app/src/pages/session/composer/session-permission-dock.tsx`][permission] | Small, useful presentational seam: `request`, `responding`, `onDecide("once" | "always" | "reject")`; language + Button/DockPrompt/Icon. Port directly in spirit with injected text/callbacks. |
| Questions | [`app/src/pages/session/composer/session-question-dock.tsx`][question] | Supports multiple questions, single/multi choice, custom answer, keyboard focus; embeds SDK calls, Solid Query, server-scoped cache and document/dock sizing. Extract a controlled request/answers/onReply/onReject card; pin Question schema. Current-doc Form API is a separate migration. |
| Errors/retry/cancel | [`session-ui/src/components/session-retry.tsx`][retry], tool error cards; [`app/src/components/prompt-input/submit.ts`][submit] | Retry is a server retry countdown, not “resubmit prompt”. Submit integration calls `session.interrupt`; error rendering also lives in timeline rows. Show connection, operation, execution, and tool errors in the relevant place. A cancelled fetch alone does not stop execution. |
| Autoscroll | [`ui/src/hooks/create-auto-scroll.tsx`][scroll]; timeline measurement/gesture helpers | Tracks user-scrolled state, own programmatic scrolling, resize/working/settling, bottom threshold, cleanup. Port behavior to a React hook; avoid current demo's unconditional scroll-to-bottom on every render. |

### The dependency boundary that matters

```text
native V2 HTTP + event stream
  → server-sdk (transport, native event adapter/coalescing, per-directory contexts)
  → server-session (canonical history + native reducer + loading/reconciliation)
  → session-message normalizer (compatibility messages + parts)
  → timeline projection / session-ui renderers

app.tsx / session.tsx wrap that with router + server/global/sync + language/theme
  + settings/tabs/layout + prompt/models + files/comments + permissions/terminal.
```

[`app.tsx`][app] and [`pages/session.tsx`][session-page] expose the provider footprint. [`utils/server.ts`][server-api] creates the native client with injected fetch; [`context/server-sdk.tsx`][server-sdk] adapts `{type,data}` to its internal `{type,properties,current}` and coalesces adjacent same-part deltas. [`context/sdk.tsx`][sdk-context] resolves directory-scoped contexts. These are app concerns, not required UI props.

The app uses both native `SessionMessageInfo[]` and compatibility message/part maps. Copying only a renderer and passing the existing demo's `{id,type,text,content}` data will not work. Conversely, a new React renderer can consume a small native-derived view model and avoid the entire compatibility store. Keep native history intact as the authoritative data representation, including otherwise undisplayed message types.

### Styles, assets, and package feasibility

- [`session-ui/package.json`][session-package] has `private: true`, wildcard source-TSX exports, `workspace:*`/`catalog:` dependencies and the vendored SDK tarball. A repo-internal export is not a supported standalone published component package. No registry install was attempted.
- [`ui/package.json`][ui-package] is publicly publishable but exports Solid source and declares Solid/Meta peers. Direct import into the current React/Vite setup needs a Solid compilation/runtime boundary; an effect wrapper around a DOM mount does not convert frameworks.
- A separately built Solid island is technically possible, but would bring two UI runtimes and require auditing its providers/portals/cleanup and package closure. For this project's simple React UI, a targeted port has a smaller maintenance boundary. No bundle-size numbers were measured.
- [`app/src/index.css`][app-css] imports UI Tailwind, session styles, V2 Tailwind and animations; defines `/assets/Inter.ttf` and `/assets/JetBrainsMonoNerdFontMono-Regular.woff2`. [`session-ui/src/styles/index.css`][session-css] imports many component styles; [`ui/src/styles/index.css`][ui-css] includes theme/base/utilities and KaTeX CSS. V2 cards use their own CSS/token names; icon sprites and provider/file icons are additional assets. Copying TSX alone is insufficient.
- Keep the optional React package on the host's minimal shadcn/Base UI/Tailwind/Lucide conventions. Own a scoped small token surface; load syntax/diff dependencies only where used. Avoid importing upstream's global reset, fonts or app assets just to render a tool card.

## Licensing and maintenance

Root [`LICENSE`][license] is **MIT, Copyright (c) 2025 opencode**; app/UI/session-UI manifests also say MIT. Substantial copied code must carry the copyright and complete MIT permission/warranty notice in distributed copies. For each vendored helper, record repository, revision, source path, and local modifications; include an upstream MIT notice in the package distribution, not only this audit.

This audit contains references and original analysis, not a vendored implementation. Third-party dependencies and copied font/icon/media assets need their own notices where their licenses require them; the root MIT notice does not replace those. No font/media asset license inventory or dependency-license audit was performed because no assets/dependencies were copied. Pin helper versions and review upstream changes intentionally; beta API renames, question→form migration, private-package reshuffles, and CSS/token changes are observable maintenance boundaries.

## What was actually verified

- Read exact-revision source, package manifests, root license, source client documentation, current official V2 docs, and the local existing endpoint/client code. No live web-app browser inspection or visual parity claim.
- Executed the exact pinned `createV2SessionReducer` under Bun from the isolated archive (no dependency install; its imports are type-only). Fixture sequence: step started → reasoning started/delta → tool input started → text started/delta/ended → tool called/success. Result preserved `[reasoning, completed tool, text]`; text ordinal `0` updated the third content item; `text.ended` replaced `"hel"` with `"hello"`; tool text output was retained.
- Also verified a text delta with no existing assistant produces no message/touched IDs. **The reducer needs bootstrap/missing-state recovery around it.** Copying it alone is not a reliable live controller.
- Source inspection confirms `normalizeSessionMessages` counts text and reasoning ordinals separately, maps wire `model.id` to UI `modelID`, maps edit/write `path` to compatibility `filePath`, and maps edit metadata to `filediff`. It skips an assistant without a parent user; therefore paginated history must preserve turn context, and a new renderer should not blindly adopt that dropping behavior.
- Reuse rankings and relative effort are engineering estimates from dependency tracing and file size. No React port, upstream app build, visual test, bundle benchmark, guest test, or latest-package compatibility test was performed in this sidequest.

[client-guide]: https://github.com/anomalyco/opencode/blob/d7a7256bb6b0952f486c95718cfbf460b1570a56/packages/www/content/docs/build/client.mdx
[timeline]: https://github.com/anomalyco/opencode/blob/d7a7256bb6b0952f486c95718cfbf460b1570a56/packages/app/src/pages/session/timeline/message-timeline.tsx
[parts]: https://github.com/anomalyco/opencode/blob/d7a7256bb6b0952f486c95718cfbf460b1570a56/packages/session-ui/src/components/message-part.tsx
[data]: https://github.com/anomalyco/opencode/blob/d7a7256bb6b0952f486c95718cfbf460b1570a56/packages/session-ui/src/context/data.tsx
[normalize]: https://github.com/anomalyco/opencode/blob/d7a7256bb6b0952f486c95718cfbf460b1570a56/packages/app/src/utils/session-message.ts
[reducer]: https://github.com/anomalyco/opencode/blob/d7a7256bb6b0952f486c95718cfbf460b1570a56/packages/app/src/context/server-session-v2-reducer.ts
[session-store]: https://github.com/anomalyco/opencode/blob/d7a7256bb6b0952f486c95718cfbf460b1570a56/packages/app/src/context/server-session.ts
[md-stream]: https://github.com/anomalyco/opencode/blob/d7a7256bb6b0952f486c95718cfbf460b1570a56/packages/session-ui/src/components/markdown-stream.ts
[md-projection]: https://github.com/anomalyco/opencode/blob/d7a7256bb6b0952f486c95718cfbf460b1570a56/packages/session-ui/src/components/markdown-projection.ts
[markdown]: https://github.com/anomalyco/opencode/blob/d7a7256bb6b0952f486c95718cfbf460b1570a56/packages/session-ui/src/components/markdown.tsx
[file]: https://github.com/anomalyco/opencode/blob/d7a7256bb6b0952f486c95718cfbf460b1570a56/packages/session-ui/src/components/file.tsx
[basic-tool]: https://github.com/anomalyco/opencode/blob/d7a7256bb6b0952f486c95718cfbf460b1570a56/packages/session-ui/src/v2/components/basic-tool-v2.tsx
[composer]: https://github.com/anomalyco/opencode/blob/d7a7256bb6b0952f486c95718cfbf460b1570a56/packages/session-ui/src/v2/components/prompt-input/index.tsx
[interaction]: https://github.com/anomalyco/opencode/blob/d7a7256bb6b0952f486c95718cfbf460b1570a56/packages/session-ui/src/v2/components/prompt-input/interaction.ts
[machine]: https://github.com/anomalyco/opencode/blob/d7a7256bb6b0952f486c95718cfbf460b1570a56/packages/session-ui/src/v2/components/prompt-input/machine.ts
[app-composer]: https://github.com/anomalyco/opencode/blob/d7a7256bb6b0952f486c95718cfbf460b1570a56/packages/app/src/components/prompt-input-v2.tsx
[models]: https://github.com/anomalyco/opencode/blob/d7a7256bb6b0952f486c95718cfbf460b1570a56/packages/app/src/components/dialog-select-model.tsx
[history]: https://github.com/anomalyco/opencode/blob/d7a7256bb6b0952f486c95718cfbf460b1570a56/packages/app/src/pages/home/home-sessions-view.tsx
[timeline-model]: https://github.com/anomalyco/opencode/blob/d7a7256bb6b0952f486c95718cfbf460b1570a56/packages/app/src/pages/session/timeline/model.ts
[permission]: https://github.com/anomalyco/opencode/blob/d7a7256bb6b0952f486c95718cfbf460b1570a56/packages/app/src/pages/session/composer/session-permission-dock.tsx
[question]: https://github.com/anomalyco/opencode/blob/d7a7256bb6b0952f486c95718cfbf460b1570a56/packages/app/src/pages/session/composer/session-question-dock.tsx
[retry]: https://github.com/anomalyco/opencode/blob/d7a7256bb6b0952f486c95718cfbf460b1570a56/packages/session-ui/src/components/session-retry.tsx
[submit]: https://github.com/anomalyco/opencode/blob/d7a7256bb6b0952f486c95718cfbf460b1570a56/packages/app/src/components/prompt-input/submit.ts
[scroll]: https://github.com/anomalyco/opencode/blob/d7a7256bb6b0952f486c95718cfbf460b1570a56/packages/ui/src/hooks/create-auto-scroll.tsx
[app]: https://github.com/anomalyco/opencode/blob/d7a7256bb6b0952f486c95718cfbf460b1570a56/packages/app/src/app.tsx
[session-page]: https://github.com/anomalyco/opencode/blob/d7a7256bb6b0952f486c95718cfbf460b1570a56/packages/app/src/pages/session.tsx
[server-api]: https://github.com/anomalyco/opencode/blob/d7a7256bb6b0952f486c95718cfbf460b1570a56/packages/app/src/utils/server.ts
[server-sdk]: https://github.com/anomalyco/opencode/blob/d7a7256bb6b0952f486c95718cfbf460b1570a56/packages/app/src/context/server-sdk.tsx
[sdk-context]: https://github.com/anomalyco/opencode/blob/d7a7256bb6b0952f486c95718cfbf460b1570a56/packages/app/src/context/sdk.tsx
[session-package]: https://github.com/anomalyco/opencode/blob/d7a7256bb6b0952f486c95718cfbf460b1570a56/packages/session-ui/package.json
[ui-package]: https://github.com/anomalyco/opencode/blob/d7a7256bb6b0952f486c95718cfbf460b1570a56/packages/ui/package.json
[app-css]: https://github.com/anomalyco/opencode/blob/d7a7256bb6b0952f486c95718cfbf460b1570a56/packages/app/src/index.css
[session-css]: https://github.com/anomalyco/opencode/blob/d7a7256bb6b0952f486c95718cfbf460b1570a56/packages/session-ui/src/styles/index.css
[ui-css]: https://github.com/anomalyco/opencode/blob/d7a7256bb6b0952f486c95718cfbf460b1570a56/packages/ui/src/styles/index.css
[license]: https://github.com/anomalyco/opencode/blob/d7a7256bb6b0952f486c95718cfbf460b1570a56/LICENSE
