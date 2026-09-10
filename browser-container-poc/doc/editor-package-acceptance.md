# Package-owned editor acceptance

The consumer is `editable-app-demo`, adapted in place into a small full-stack todo
app. This checklist covers the package-boundary iteration; it does not substitute
for running the browser runtime.

## Boundary

- The app owns authorization results, its launcher, and whether editing is enabled.
- Reusable source/preview/chat controls and OpenCode attachment live in
  `@kev-browser-agent-kit/opencode-chat/editor`.
- Existing workspace controller/lifecycle APIs are reused.
- The normal and editable application share their source and call the same host API.
- Standalone headless/chat consumers do not require a workspace runtime.
- The normal application's entry graph does not eagerly load editor/runtime code.

## Verification flow

1. Build/typecheck the packages and consumer; run focused controller, source-save,
   backend, authorization and proxy tests.
2. Start the demo with its documented local admin fixture on an available port.
3. Create a todo, toggle it and reload. Confirm server-backed state survives page
   reload. This demo's server-lifetime data need not survive process restart.
4. Enter editing through the app's launcher. Inspect startup progress, the preview
   and real guest chat connection. The underlying normal app should stay mounted.
5. Edit the shared application source. Wait for automatic filesystem save and verify
   HMR in the same preview document. Local filesystem save must not be labeled as
   remote patch persistence.
6. Create a chat and request a small source change. Verify tool execution, file-link
   navigation, HMR, and host API access from the preview.
7. Exit and re-enter. Confirm source/chat retention and service cleanup, including
   cancellation during startup. Check non-admin asset and inference denial.

Record which steps actually pass and the concrete blocker for anything unverified.
An HTTP test, successful bundle or simulated chat does not establish guest runtime
acceptance.

## Separate persistence milestone

Current capability audit: `workspace-api/src/workspace.ts` rejects workspace IDs
other than `default`, and its React controller opens that default ID. Per-admin
server persistence therefore must not be inferred from the existing origin-local
store. `runtime.node()` runs guest JavaScript; no installed Git/patch executable or
public patch engine has been qualified. Host Git commands in the runtime build
scripts are not browser Git support. A JS/WASM implementation can be delivered
through the existing tool/runtime interfaces before considering core API changes.

The agreed next storage contract is a complete Git-compatible patch against a
prepared base, one active workspace per admin, dirty autosave around once a second,
reset with retained prior state, and patch application on deployment with a blocking
error on conflict. No version/history UI. Before claiming this milestone, prove
added/deleted files, reset with a pending save, failed saves, stale concurrent writes,
successful deployment migration and conflict preservation using actual stored patches.
