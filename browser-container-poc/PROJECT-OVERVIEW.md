# kev-browser-agent-kit: project overview

Last summarized: **September 8, 2026**. This is the starting point for what exists,
which demo to use, and what is still being integrated. Older receipts describe
the exact revision they tested; they are not blanket acceptance of newer UI code.

## The idea

**kev-browser-agent-kit** provides browser implementations of agent harness
capabilities: workspace files, execution, tools, service endpoints and previews,
plus an optional OpenCode chat client. Applications and existing harnesses compose
these capabilities; the kit is not itself an agent harness. OpenCode supplies the
agent loop in the demos, and the runtime implementation uses upstream Vivari.

An ordinary application can optionally enable an editable version of itself.
The normal application is visible while browser-hosted execution starts. The
editable application then fills an iframe, while a stable host shell supplies a
floating chat/editor/reset/exit panel. OpenCode edits project files; a development
server such as Vite updates the preview. Existing application APIs stay on the
real backend.

The core library does not require React, Vite, OpenCode, or a chat UI. It supplies
files, compatible program execution, tools and service endpoints—not a claim to
run arbitrary native Linux binaries or stock Node/Bun.

## What is what

| Directory / public package | Purpose |
| --- | --- |
| `workspace-api/` → `@kev-browser-agent-kit/workspace` | Workspace filesystem/persistence, Runtime execution, byte streams, endpoints, preview adapter, typed ripgrep |
| `@kev-browser-agent-kit/workspace/react` | Optional provider/controller/hooks and controlled `WorkspaceEditing` boundary; does not choose applications to launch |
| `@kev-browser-agent-kit/workspace/assets` | Server/build-only helpers for delivering a separate runtime distribution |
| `@kev-browser-agent-kit/workspace/server` | Application-supplied editor authorization adapter |
| `opencode-chat/` → `@kev-browser-agent-kit/opencode-chat` | Standalone headless OpenCode client; injected HTTP transport, no VM or Vite dependency |
| `@kev-browser-agent-kit/opencode-chat/react` and `/styles.css` | Optional replaceable chat UI: models, sessions, Markdown, tools, permissions/questions, interruption |
| `editable-app-demo/` | Main consumer example: normal React app, optional editing shell, app recipe, local backend/model proxy, diagnostics |
| `vivari/` | Runtime source/build preparation and durable runtime patch; developer infrastructure rather than consumer UI |
| `terminal-agent-demo/` | Earlier integrated OpenCode/Vite/terminal POC and runtime research evidence |
| `chat-client-demo/` | Earlier standalone DOM chat demo; shared-package React chat supersedes it as the main integration target |
| `qemu/`, `hybrid*`, other experiment directories | Earlier or separate runtime experiments; not required entrypoints for the current sample |

All paths in this table are under `browser-container-poc/`. This shared historical
directory also contains independent QEMU/hybrid experiments, so the umbrella is a
public project name rather than a wholesale directory move. `workspace-api/`,
`opencode-chat/` and `vivari/` remain the source/build directory names. Upstream
`@vivari/core`, runtime protocol identifiers, source pins and attribution retain
their upstream names. Consumers should use the public package names above.

### Four separately delivered things

1. **Library packages:** built ESM and TypeScript declarations; local file dependency
   or packed tarball, no registry publication required.
2. **Runtime distribution:** matching workers, WASM and Service Worker assets,
   delivered explicitly with their version/manifest.
3. **Application recipe and prepared apps:** source plus Vite/OpenCode dependencies.
   These are not included automatically in the core package.
4. **Host backend:** application API, authorization and model forwarding. Credentials
   remain server-side; frontend embedding does not replace backend authorization.

See [local package installation](workspace-api/LOCAL-PACKAGES.md) and
[chat package integration](opencode-chat/INTEGRATION-HANDOFF.md).

## Demos and how to use them

**Live availability check on September 8:** localhost ports **4311, 4312, 43917,
and 5194 were all unreachable**. These are launch URLs, not currently confirmed
running servers. Previous messages saying servers were left running are historical.

### 1. Main sample: optional editing shell

**Use this first:** `editable-app-demo/`.

- Normal interactive React counter/backend sample by default.
- Local admin mode offers **Enable editing**.
- Editing starts the browser runtime, delivers prepared dependencies, starts guest
  Vite/OpenCode and displays a full-window editable app with host-owned controls.
- **New chat** explicitly creates a session; the model selector and transcript use
  the new public chat package.
- **Reset source** restores four declared sample source files, not backend/chat
  data or arbitrary workspace files. **Exit** stops/closes editing and restores
  the normal view. The sample backend's own data is server-lifetime, not durable.

From the repository root, after local package setup and with existing
runtime/OpenCode preparation available:

```sh
LOCAL_EDITOR_ADMIN=1 bun run --cwd browser-container-poc/editable-app-demo demo
```

Default URL: **http://127.0.0.1:4311**. First-time local package setup:

```sh
cd browser-container-poc/workspace-api
bun install --frozen-lockfile --ignore-scripts
bun run build
cd ../opencode-chat
bun install --frozen-lockfile --ignore-scripts
bun run build
cd ../editable-app-demo
bun install --ignore-scripts
LOCAL_EDITOR_ADMIN=1 bun run demo
```

Open **http://127.0.0.1:4311**. Omit `LOCAL_EDITOR_ADMIN=1` for non-admin mode
(no editing toggle; protected editor routes denied). It is a local fixture, not
real identity verification. Override the default with `PORT=4312` if needed. A new port is a different
browser origin and persistent store.

This is not yet a zero-prerequisite fresh-checkout installer: compiled runtime,
matched OpenCode package and toolchain prerequisites are documented in the
[demo README](editable-app-demo/README.md). The startup command reuses verified
prepared output and prepares missing/stale app assets; it does not always rebuild
the runtime.

### 2. Browser contract harness

`workspace-api/` is the lower-level verification page, not the product demo:

```sh
# From browser-container-poc/
bun workspace-api/scripts/serve-contract.ts
# http://127.0.0.1:43917
```

The browser checks expose `window.contract.run()` and `window.contract.search()`.
They cover real filesystem/runtime/preview behavior independently of the main UI.

### 3. Historical chat and terminal demos

`chat-client-demo/` uses port 5194 for its standalone fixture.
`terminal-agent-demo/` contains the older integrated terminal-first POC. Consult their
own READMEs when reproducing historical evidence; use the main sample for current
package consumption and editing UX.

## What has actually been verified?

| Area | Evidence / qualification |
| --- | --- |
| Core runtime and earlier integrated browser flow | Real browser acceptance at `5fb2a02`: OPFS close/reload, preview SW routing, genuine guest OpenCode model tool edit, same-Document Vite HMR, interruption and restored session history |
| Locally consumable API and React package | External packed TypeScript/React consumer, declarations/build and runtime relocation checks passed; package increment `c52aa4a` |
| Optional editing shell / reset / backend routing | Implemented at `96160af`; focused auth, request/streaming, reset and runtime checks passed; its newer complete browser flow remains pending |
| Optional chat package | `4f32cf6`, query fix `a66ad66`, integration `7e6a7d3`; headless-without-React and React consumers plus controller/transport tests passed |
| Latest shell + new chat together | Integration QA: 22 chat tests/82 assertions, 16 demo tests/170 assertions, builds and host HTTP checks passed. Real guest/UI/browser acceptance was blocked by disconnected Browser Control |
| Diagnostics | Bounded, redacted, rotating local logs and run IDs; actual upload → disk → download tested, commit `2014387` |

The last failed Browser Control checks do not establish its current connection.
Reconnect and check before resuming browser acceptance. Pending cases include
the new chat's live guest interaction, UI behavior, latest iframe API/cookie
behavior, lifecycle races and persistence after the newer shell changes.
Forced OPFS quota/flush-write failures also lack browser acceptance.

Current receipt: [shell/chat integration QA](editable-app-demo/tests/integration-qa/README.md).
Earlier evidence: [real-app receipt](editable-app-demo/tests/REAL-APPS-EVIDENCE.md).

## IRS Tools: real application integration in progress

The sibling worktree is outside this rename's scope. Any consumer still using the
previous public package scope must migrate its dependencies/imports to the names
above, reinstall local packages and regenerate its own lockfile.

- Original checkout: `../irs-tools`, kept on its original branch.
- Isolated worktree: `../irs-tools-browser-editor` (sibling of this repository).
- Feature branch: **`feat/browser-workspace-editor`**.
- Goal: consume the public packages in the existing application, keep normal app
  behavior, offer developer-authorized editing, and use its real backend/Clerk.
- Routing audit `6c2249d`: keep React Router, prefer `ssr:false` with build-time
  prerendering, align package versions, and implement correct static/deep-link
  serving. Guest framework-plugin/Tailwind compatibility still needs qualification.
- Clerk forwarder `8eb3a85`: every protected request uses Clerk SDK verification
  and developer authorization, fixed upstreams, server-held provider credentials,
  streaming/cancellation. Fifteen tests/94 assertions included actual SDK JWT
  validation with ephemeral keys and loopback HTTP streaming.
- **App integration agent is still working.** No finished IRS Tools demo URL or
  full app acceptance is claimed. Real sign-in, authenticated assets, fresh-token
  forwarding and guest tool-loop verification remain required.
- An in-progress consumer note identified development JSX in the packaged React
  build failing production prerender; its proposed host workaround is not a
  package fix. Verify the final integration handoff and resolve this before
  calling production React consumption qualified.

The worktree's `docs/browser-editor-integration.md`,
`docs/browser-editor-auth.md` and `docs/browser-editor-routing/README.md` contain
the evolving details. Do not treat intermediate files as completed-agent results.

## Diagnostics and remaining practical boundaries

- Main demo logs: `editable-app-demo/.diagnostics/events.jsonl` and rotated `.1`.
  The UI provides a run ID/download link. These files are local and gitignored.
- One persistent workspace owner per origin; currently only workspace ID `default`.
- Dependencies excluded from OPFS are explicitly re-delivered after reopen.
- Same-origin iframe rendering is not arbitrary-code isolation from the host.
- Root-relative API routing is supported by explicit policy; arbitrary relative
  URLs, OAuth navigation and router behavior are not automatically identical.
- Normal host React state can remain mounted, but guest state is a separate tree.
- Chat targets the pinned OpenCode V2 dev-19167 contract; it is not an unqualified
  client for all future server versions. Attachments are not implemented.

## Next milestones

1. Finish the IRS Tools branch integration and record exact run/prerequisite steps.
2. Resolve consumer-discovered package/build issues with production-mode checks.
3. Fresh independent browser QA of the latest shell/chat, then the real IRS Tools
   app with Clerk, routing, Tailwind edits, same-origin APIs and persistence.
4. Keep the base runtime, optional React shell, optional chat UI and app-specific
   launch/delivery recipes independently consumable.
