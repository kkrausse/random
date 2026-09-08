# Source provenance

Compatibility target: OpenCode guest **0.0.0-dev-19167**, repository revision
**d7a7256bb6b0952f486c95718cfbf460b1570a56** (2026-08-10).

Vendored from https://github.com/anomalyco/opencode at that exact revision:

| Local file | Upstream path | Modifications |
| --- | --- | --- |
| `src/vendor/reducer.ts` | [`packages/app/src/context/server-session-v2-reducer.ts`](https://github.com/anomalyco/opencode/blob/d7a7256bb6b0952f486c95718cfbf460b1570a56/packages/app/src/context/server-session-v2-reducer.ts) | Type-only import redirected to local generated types; `V2Event` aliased to `OpenCodeEvent`; provenance comment. Algorithm unchanged. |
| `src/vendor/types.ts` | [`packages/client/src/promise/generated/types.ts`](https://github.com/anomalyco/opencode/blob/d7a7256bb6b0952f486c95718cfbf460b1570a56/packages/client/src/promise/generated/types.ts) | Exact generated type-only source, no runtime dependency. |
| `LICENSE.upstream` | [`LICENSE`](https://github.com/anomalyco/opencode/blob/d7a7256bb6b0952f486c95718cfbf460b1570a56/LICENSE) | Exact complete MIT notice, Copyright (c) 2025 opencode. Distributed in tarballs. |

`src/api.ts` derives from this repository's `opencode-client-demo/src/api.ts`:
same injected string-only endpoint URL resolution, pagination, model-catalog
activation and SSE parser. Replaced workspace imports and minimal hand-written
message/event types with the pinned native contract; formatted the local copy. No code from the Solid UI,
private packages, fonts or media is included. Markdown rendering is locally
authored with Marked 17.0.4 tokenization and React escaping; upstream Markdown
helpers were reviewed but not copied.

The React bundle includes the Marked tokenizer. Its complete Marked/Markdown
notices from `marked@17.0.4/LICENSE.md` are distributed as `LICENSE.marked`.

HTTP route/body verification used the pinned
`packages/client/src/promise/generated/client.ts` and `types.ts`, including
`session/active`, descending cursor pages, `{model:{providerID,id}}`,
`permission/{id}/reply` with `{reply}`, and `question/{id}/reply` with `{answers}`.
Do not replace question endpoints with the current public Form API silently.

The source audit and acceptance rationale are in the owning repository's
`browser-container-poc/doc/opencode-chat-ui-audit/`. This package does not depend
on those files at runtime or during its build.
