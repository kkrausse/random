# Browser editor: library-owned product, small app integration

Status: UX and API direction agreed; validate a runnable IRS mock before implementing
the new library integration. This replaces the separate-guest-app direction from the
earlier IRS experiment. Reuse working library/runtime code rather than rewriting it.

## The experience we want

An authorized developer opens the normal application and chooses **Edit app**.
The editor opens alongside a live, editable version of that same application.
They can ask OpenCode to change it, see tool activity and the resulting UI, and
inspect or edit source directly. Exiting returns to the normal application.

The editable application uses the **mainline frontend**: its source, entry point,
routes, providers, dependencies and configuration. The host backend continues to
serve the application APIs. We do not maintain another frontend application just
to make the first one editable.

### Expected behavior

- Ordinary app use works without starting a workspace, runtime or agent.
- Eligible developers get a ready-made launcher and editor interface.
- Opening the editor shows meaningful startup progress and supports cancellation.
- Chat includes sessions, model selection, streaming responses, tool results,
  permissions/questions, stop and reconnect, using the existing chat UI work.
- Agent edits and manual saves update the actual application preview through HMR.
- Source links in chat open the corresponding file in the editor.
- Saved edits and chat sessions survive exit/re-entry. Opening never silently
  replaces the developer's saved workspace with a newer application snapshot.
- Exit cleans up services and restores the normal app. Authentication revocation
  or a change of signed-in identity closes the editing session.
- Recovery and reset are library features with explicit behavior. Distinguish
  restoring source from deleting a workspace; avoid an ambiguous reset button.
- The default component is sufficient. Consumers may choose the individual UI
  pieces and placement through context-based composition when they need it.

## The IRS PR should be small

The application integration should consist of:

1. A short `prepare.ts`/`prepare.js` script invoking library preparation on the
   existing project, plus its build command wiring.
2. A configured provider and one pre-made editor component.
3. An authenticated model proxy that keeps provider credentials on the server.
4. Minimal server wiring for authorized artifact delivery and required runtime headers.

Illustrative API, to be refined through the runnable consumer:

```tsx
<BrowserEditorProvider
  artifact="/browser-editor/manifest.json"
  inferenceEndpoint="/api/model/opencode"
  access={{ allowed: isDeveloper, identity: userId }}
>
  <App />
  <BrowserEditor />
</BrowserEditorProvider>
```

Here `allowed` means eligible, not already editing. The pre-made component includes
the launcher; the provider owns editing state. A custom trigger can use a hook.
The host supplies its verified identity/access result rather than teaching the
library about Clerk. Exact props for authenticated fetching/model defaults should
be established in the mock, not by exporting every internal runtime option.

Illustrative preparation:

```ts
import { prepareBrowserEditor } from '@kev-browser-agent-kit/opencode-chat/prepare'

await prepareBrowserEditor({
  projectRoot: process.cwd(),
  outputDirectory: 'build/browser-editor',
})
```

These export names are proposals, not implemented APIs. A framework adapter, if
needed, belongs in the library and may be selected by this call. It must not require
the application to recreate its routes or maintain a guest entry point.

## Ownership

| Application | Library |
| --- | --- |
| Existing frontend source and app configuration | Preparing that project for the browser runtime |
| Existing `package.json` and `bun.lock` | Dependency delivery using the app's locked resolutions |
| Authentication and developer policy | Admission lifecycle, cancellation and cleanup |
| Backend APIs and authenticated inference proxy | Guest OpenCode connection and chat/controller lifecycle |
| Where artifacts are hosted | Artifact transport, validation and workspace seeding |
| Optional layout choices | Default editor, preview, source UI, chat, diagnostics and reset |

The workspace package continues to own general runtime/filesystem/preview
primitives. The OpenCode/editor integration composes those primitives into the
ready-to-use product. Standalone chat should remain usable without starting a
workspace. Package/subpath details are secondary to keeping this boundary clear.

## Same app, not a second guest project

- Use the current project's files by default, including current working-tree edits
  and new non-ignored files when preparing locally. Avoid a handwritten frontend
  source allowlist that must be updated whenever the application grows.
- Preparation produces the snapshot delivered to a new workspace. Production
  serves the snapshot prepared for that deployment; it does not expose a live Git
  checkout to the browser. Existing workspaces retain their edits.
- Server-only code, credentials, generated output, caches and installed dependencies
  need appropriate treatment by preparation. This is build/adapter behavior, not a
  second application that IRS must curate.
- The app's package manifest and lockfile are authoritative. No independently
  maintained `guest/package.json` or `guest/bun.lock`.
- Any native-to-browser dependency adaptation is library-owned and explicit.
- Preserve mainline routes, providers and frontend startup. If a framework feature
  needs adaptation, solve it in the framework integration and prove it on IRS.
- A ZIP or another transport may be useful internally. Its format is an
  implementation detail, not the public API or a justification for a parallel app.
- Do not use the new editor integration to smuggle in unrelated SSR, routing,
  database or deployment changes to the IRS PR. Identify genuine prerequisites
  separately and keep their motivation clear.

## Trust model

This is an authorized developer feature. The editable frontend can use the real
host backend with that developer's privileges; it is not a separate test database
or an isolation boundary from same-origin app authority. Server-side authorization
protects artifacts and the inference proxy independently of the provider's UI gate.
Provider keys remain server-side. The library owns the mechanics; IRS owns access.

## Sequence: validate the consumer before implementing the library

### 0. Preserve the prior work

- IRS reference branch: `feat/browser-workspace-editor`, checkpoint `45aab39`.
  This preserves the working editor history, API sketch, and an **unfinished**
  preparation experiment. The checkpoint is not a passing implementation.
- Clean IRS starting branch: `feat/browser-editor-library-integration`, based on
  `main` at `738b7ac`, rather than the old integration branch.
- The plan lives directly on `random`'s `main`; no separate POC branch.

### 1. Run a mock of the desired API in IRS

On the fresh IRS branch, write the small integration we want consumers to have.
Back the proposed library imports with a lightweight local mock implementation.
It must actually render and run in the normal IRS app, not just typecheck against
declarations. Keep the mock replaceable by the future package exports.

Demonstrate opening/closing the pre-made editor, normal-app continuity, layout,
configuration and the access gate. Represent simulated chat/startup explicitly;
do not suggest the mock has a real workspace or working agent. Run the app and
inspect the interaction before committing to the contract. Use the mock to settle
how the provider preserves the app and places/replaces its preview.

### 2. Implement behind that consumer API in this repository

Inventory the existing workspace, editable-app demo and OpenCode chat code.
Move/reuse the editor adapter, startup recipe, source/preview controls and
diagnostics here. Preserve useful existing implementations and tests. Build the
mainline-app preparation/framework integration rather than another IRS-shaped
guest. Keep the consumer-facing API stable while replacing the mock behavior.

### 3. Replace the IRS mock with the real package

Exercise actual preparation, runtime startup, authentication, model read/edit
tools, HMR, source save, cancellation, persistence, reset and exit/re-entry. Verify
that new normal application files are included without editing a source list and
that frontend dependencies come from the application lockfile.

Finally review the IRS diff: it should still read like a prepare call, provider,
pre-made component and model proxy with minimal asset/server wiring. If it contains
a large editor implementation or a parallel frontend, the boundary is still wrong.

## Immediate next step

Use the fresh IRS branch to implement and run the mock consumer above. Assess that
experience together before continuing the real library extraction.
