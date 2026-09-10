# Plain todo app → live-edit integration

The plain full-stack application is preserved on `feat/todo-before-live-edit` at
`80b6b16f88138093dfd967f16fcac386796a0285`. This is an isolated comparison branch;
it is not merged into main. Its frontend `src/SampleApp.tsx`, backend `backend.ts`
and todo API tests are byte-for-byte copies of the todo conversion at `921e26b`.

The original todo conversion still contained the earlier editor, so it is not the
correct baseline for measuring the total live-edit integration.

## Compare

Use two refs, not triple-dot: compare the actual snapshots rather than the common
ancestor. From the `random` repository root:

```sh
# Complete application diff, including tests/docs/lockfiles.
git diff feat/todo-before-live-edit main -- browser-container-poc/editable-app-demo

# Application code/configuration only; omit historical QA and lockfile noise.
git diff feat/todo-before-live-edit main -- \
  browser-container-poc/editable-app-demo \
  ':!browser-container-poc/editable-app-demo/tests' \
  ':!browser-container-poc/editable-app-demo/*.md' \
  ':!browser-container-poc/editable-app-demo/**/bun.lock' \
  ':!browser-container-poc/editable-app-demo/bun.lock'
```

Package implementation is under `browser-container-poc/opencode-chat`, outside
this consumer diff. No workspace API redesign is required by this integration.

## What the integration currently costs

- App-owned admin policy, launcher/enable state and lazy editor mount.
- A small `src/editor.tsx` adapter consuming the package UI.
- Shared-source preparation, runtime/app asset delivery and startup recipe.
- Authorized asset/model proxy routes, runtime headers and backend preview routing.
- Local diagnostic collection and integration tests.

All preview/source/chat UI now lives in the package. Preparation, runtime startup
recipe and server scaffolding are still substantial consumer code; the diff is
intended to expose that remaining extraction work rather than imply that the
future two-endpoint high-level integration is already implemented. Git-patch
server persistence is not part of this snapshot.
