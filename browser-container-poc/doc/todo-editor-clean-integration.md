# TODO clean integration — BLOCKED, September 11, 2026

The high-level API cleanup is complete and passes focused checks. **End-to-end
acceptance is not PASS.** Runtime qualification stopped when the build audit found
an existing application compatibility workaround, as required by the user's
instruction to escalate and stop rather than push through hacks.

## Public API before and after

Before, `todo-app-demo/src/editor-panel.tsx` used four toolkit symbols across three
entrypoints: `BrowserEditor`, `createBrowserEditorRecipe`, `WorkspaceProvider` and
`useWorkspace`, with a nested component to retrieve and wire the controller.

After, its complete component is:

```tsx
import { PreparedBrowserEditor } from '@kev-browser-agent-kit/opencode-chat/editor'
import '@kev-browser-agent-kit/opencode-chat/editor.css'

const hostPaths = ['/api']
const isPreviewReady = (frame: HTMLIFrameElement) => !!frame.contentDocument?.querySelector('main input#title:not(:disabled)')

export default function EditorPanel({ onExit }: { onExit(): void }) {
  return <PreparedBrowserEditor hostPaths={hostPaths}
    initialPath="/src/home.tsx" isPreviewReady={isPreviewReady} onExit={onExit} />
}
```

The wrapper composes the existing workspace lifecycle and default recipe. The
lower-level `BrowserEditor`, recipe and workspace APIs remain available. Host-owned
authorization, preview backend paths/readiness, lazy mounting and `useState(false)`
remain explicit. The launcher is now **Open editor**. This is browser-local source
editing, not publication of host source.

## Genuine before/after comparison

`aa7a4a6` is the actual standalone `todo-app-demo` before editor integration.
Earlier comparisons under `editable-app-demo` describe a different application.
From the repository root, compare snapshots (two refs, not triple-dot):

```sh
git diff aa7a4a6 HEAD -- browser-container-poc/todo-app-demo
git diff --stat aa7a4a6 HEAD -- browser-container-poc/todo-app-demo
# Business frontend and backend: expected empty diff.
git diff aa7a4a6 HEAD -- browser-container-poc/todo-app-demo/src/home.tsx \
  browser-container-poc/todo-app-demo/src/server/trpcRouter.ts \
  browser-container-poc/todo-app-demo/src/schema/todo.ts
```

The original integration commits are `dc34cba` and `9f202e9`. Shared library work
is outside the application diff. The application still has its short prepare call,
server policy/asset/model routes, runtime headers, and framework configuration.
At this checkpoint the complete app diff is **12 files, 163 insertions and 12
deletions**, including documentation and lockfile. The business-code comparison
above was empty.

## Concrete hard blocker: guest Tailwind is a different build path

Baseline Vite used upstream `@tailwindcss/vite`. The integration replaces that
import with `browserCompatibleTailwind()` in `opencode-chat/src/vite.ts`.
Host mode still uses upstream Vite integration, but guest mode calls Tailwind's
compiler with a homemade recursive scanner. At lines 85–92 it only scans
TS/JS/HTML files and splits candidates with ``/[\s"'`<>={}]+/``.

A bounded host check with the installed Tailwind 4.3.3 proved an actual semantic
difference, without changing any application or runtime:

| Compiler input | Result |
| --- | --- |
| `["data-[state=open]:block"]` | emits `.data-\\[state\\=open\\]\\:block[data-state="open"] { display: block; }` |
| Same token through the existing scanner | becomes `["data-[state", "open]:block"]`; emits no utility |

This uses the supported upstream compiler in both cases, isolating the scanner's
loss. It does not claim this variant is currently present in the TODO UI. It proves
the compatibility adapter is not equivalent to the normal frontend build and can
silently lose styles during model edits. Extending the regex or adding another
consumer transform would push through the prohibited workaround. None was added.

Other audited build details:

- `browserEditorBoundary` deliberately substitutes the app-owned editing entry
  with a null component in the preview, preventing recursive editor mounting.
- React Router basename and Vite base use the shared preview prefix; existing
  middleware restores the bridge-stripped prefix. This remains an explicit
  framework/transport adapter, not evidence of ordinary unadapted Vite execution.
- Preparation currently substitutes WASM esbuild/Rollup packages, strips project
  scripts, and installs a generated dependency manifest. It does not qualify
  arbitrary project scripts or preserve the app lockfile as the installation input.
- `prepare.ts` still requires `d7a7256`; `recipe.ts` still launches its CLI wrapper.
  Neither accepts/launches the new immutable direct-server candidate yet.

## Verification and exact limitations

- `opencode-chat`: typecheck and package build passed.
- Existing focused editor lifecycle/source/markup tests: **8 passed, 29 assertions**.
- TODO consumer: typecheck and production/prerender build passed after reinstalling
  the compiled local package with the documented Bun 1.3.9 installer.
- The deterministic Tailwind counterexample above passed its mismatch assertions.
- No new browser session, runtime process, model call or qualification server was
  started. Therefore no preview/chat, real-model edit/HMR, built-in shell/Node,
  browser CRUD or close/reopen teardown evidence is claimed for this revision.

The prior beta-19425 startup/retention/model-tools receipts were read, including
their exact supported config/launch contracts and V2 config/API documentation.
Those receipts qualify `20aff6d9…`, app `55be88221d3d21dc…`, runtime distribution
`098e0b60…` in their own harness; they do not qualify this TODO integration or its
model-facing shell tool. Their assets were not changed or requalified here.

**Escalation:** establish a clean supported Tailwind build/runtime capability
before resuming this integration. Then adapt ordinary supported package/config/launch delivery to the
immutable candidate and run the full requested browser acceptance, including the
actual built-in shell tool. No speculative runtime fixes were attempted.

Cleanup: no live processes/tabs were created. Only ignored local package/build
outputs were regenerated; existing prepared workspaces and runtime assets were
preserved. The commit contains only this API/label/documentation cleanup.
