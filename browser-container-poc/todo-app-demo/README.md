# Todo app: IRS Tools stack + browser agent kit

**Current clean-integration qualification: blocked at preview hydration.** Preparation
v2 and the qualified beta-19425 server are integrated and host-tested. The first
clean-origin browser attempt installed the full package tree and started Vite, but
optimized dependency requests returned HTTP 504 before preview/chat readiness.
The separate upstream Tailwind WASM scanner repair is available through the explicit
source-pinned selection below. Combined browser HMR and retention remain pending.
See the [candidate migration](../doc/opencode-editor-candidate-migration.md),
[preparation contract](../doc/workspace-preparation-v2.md), and
[scanner repair](../doc/todo-tailwind-followup.md).

A minimal unauthenticated todo app using the relevant wiring from `../irs-tools` (the sibling repository of `random`):

- React 19 and React Router 7 framework mode: `appDirectory: 'src'`, `ssr: false`, `prerender: true`. React Router supplies the default client entry. IRS's `entry.server.tsx` is used only for build-time prerendering, producing static HTML plus client assets.
- Vite with Tailwind CSS 4, React Router, and tsconfig-paths plugins, in that order; `@/*` maps to `src/*`. Development `/api` requests proxy to Bun on port 3001.
- `Bun.serve` route maps: `/api/*` uses tRPC's `fetchRequestHandler` at endpoint `/api`; production `/*` uses `createStaticHandler('build/client')`. No framework request handler runs in production.
- tRPC 11: one `initTRPC` context in `src/server/trpc.ts`, procedures in `trpcRouter.ts`, Valibot schemas passed directly to `.input()`. Context contains `req` and an in-memory todo map.
- IRS's `httpBatchLink`, typed client, both React tRPC providers, and QueryClientProvider. Active frontend calls use `useTRPC()` with TanStack Query `queryOptions`, `mutationOptions`, and query-key invalidation, matching IRS's current hooks.
- IRS's static handler pattern: exact files, directory index, explicit application-route SPA fallback, real unknown-path/asset 404s, HEAD support, traversal checks, and immutable asset caching. The application-route allowlist is reduced to `/`.

Clerk, SOPS, encryption, and IRS business integrations are omitted. Native HTML controls keep the UI minimal. The integration starts from baseline `aa7a4a6` and adds toolkit-owned preparation, authorized Bun routes, and an app-owned editor mount.

Build the local toolkit packages once, in dependency order, then install this consumer:

```sh
bun run --cwd ../workspace-api build
bun --cwd ../opencode-chat install --linker isolated --force --frozen-lockfile
bun run --cwd ../opencode-chat build
bun install --linker isolated --force --frozen-lockfile
```

The dependencies point at compiled package directories, so toolkit source, tests, and
build dependencies do not enter this app. Bun 1.4.0 with the isolated linker supports
these sibling `file:` package paths. After rebuilding a toolkit package, reinstall
with `--force --linker isolated --frozen-lockfile`.

Run the ordinary app from this directory:

```sh
bun dev
```

Open http://localhost:5173. The Bun development API listens on port 3001.

```sh
bun test
bun run typecheck
bun run build
bun start
# Or build and serve locally in one command:
bun run preview
```

Production serves `build/client` at http://localhost:3000; set `PORT` to change it. Prerendering produces the page shell; the browser loads todos through tRPC after hydration.

## Todo procedures

| Procedure | Kind | Input |
| --- | --- | --- |
| `getTodos` | query | none |
| `addTodo` | mutation | `{ title: string }` |
| `setTodoCompleted` | mutation | `{ id: string, completed: boolean }` |
| `deleteTodo` | mutation | `{ id: string }` |

The typed client batches requests to `/api/<procedure>`. Titles are trimmed and validated to 1–200 characters with Valibot. Errors use tRPC's protocol (`BAD_REQUEST`, `NOT_FOUND`, `METHOD_NOT_SUPPORTED`), not REST response shapes. All clients share an in-memory list that resets on server restart.

`src/server/trpcRouter.test.ts` exercises real HTTP requests through Bun and the tRPC batch client, including CRUD and protocol failures. The corrected baseline is a separate commit after the original `6411544` starter.

## Enable the browser editor

The existing qualified runtime distribution and unchanged beta-19425 application
are prerequisites. Runtime defaults to `../workspace-api/dist/runtime`; override
with `RUNTIME_DIR`. Set `OPENCODE_PACKAGE_DIR` explicitly to the retained candidate
root containing `build-receipt.json` and `.runtime/opencode-bun-server/`. It is not
the old CLI package directory. After the package builds/install above:

```sh
export OPENCODE_PACKAGE_DIR=/private/var/folders/t_/x48jtnps7n5_0g_pt9xpvbg00000gn/T/opencode/server-process-candidate.0co24kti
bun run prepare:editor
bun run build
LOCAL_EDITOR_ADMIN=1 PORT=4390 bun start
```

### Select the source-pinned Tailwind repair

After building the authorized upstream PR with
`bun ../vivari/scripts/build-tailwind-wasm-candidate.ts --node /absolute/path/to/node`,
select its receipt and hash explicitly before `prepare:editor`. The verified build
from this iteration uses:

```sh
export TAILWIND_CANDIDATE_RECEIPT="$PWD/../vivari/.runtime/tailwind-wasm-candidate/11050dda2c4e26a3412b1745e84ea41d8fed6335/a6719da6db7b71197e68f29625597633cb31de6cb13f434f485d02e80e4856e3/receipt.json"
export TAILWIND_CANDIDATE_SHA256=456722dd32ebba38e957bf9560eaab820936e8c16132d14b5c861381793adc9a
bun run prepare:editor
```

A fresh build writes its own exact artifact/receipt identity to
`../vivari/.runtime/tailwind-wasm-candidate/current.json`; use that receipt and
digest together. The pinned PR source is verified by the toolkit. The chosen
archive is retained as a binary input under `/workspace/.browser-editor-backends/`,
and the derived lock records its distinct SHA-512 and source provenance. It is not
identified as the published registry archive. Omit both environment variables to
select the published backend. Browser CSS HMR acceptance of the PR build is pending.

### Open the editor

Open http://127.0.0.1:4390 and choose **Open editor**. The editor starts closed;
the explicit button mounts its lazy entry. `LOCAL_EDITOR_ADMIN=1`
is explicitly a **local loopback admin fixture**, not a production identity system.
Without it the launcher is absent and direct editor JS/CSS, runtime/prepared assets,
and model endpoints return 403. Replace `src/server/editing.ts` with the app's real
session/role policy when integrating authentication. The Vite development boundary
uses that same policy for editor modules.

The exact retained receipt and all five application outputs are verified before
preparation. `.editor/prepared/manifest.json` is `browser-editor-v2`, retaining
the receipt verbatim, source revision, dependency original/derived lock provenance,
and the frozen ripgrep support installation. The standalone receipt is also saved
at `.editor/prepared/opencode-build-receipt.json`. Guest application delivery is
`/app`; ordinary `ripgrep@0.3.1` uses `/app/node_modules/.bin/rg` with preserved
links and executable modes. The global model config is written under `/.server`
in the workspace, isolated from source editing scans. Chat readiness requires
authenticated health, plugin activation, loaded global config and an enabled
tool-capable Muse Spark model. Other recipe model selections fail explicitly.

This entrypoint fixes its database at `/runtime-probe/opencode.sqlite`. Application
delivery creates only a marker in that directory and never resets its database.
Chat uses the controller's bounded stdin-EOF shutdown mode; its lifecycle and
conversation retention still need combined browser acceptance. Shell permission
is configured for the upcoming built-in shell gate, not evidence that it passed.

`prepare.ts` is a single toolkit call. It packages the existing `src`, Vite, React
Router, and TypeScript configs; there is no second guest frontend. The shared
React Router config uses the toolkit's deployment basename, while the Vite boundary
excludes `src/editing.tsx` and its editor imports from guest execution. Framework
SPA rendering, tRPC React Query, CSS, and HMR all run from the same frontend source.
Guest `/api` calls go through the existing preview bridge to this real Bun server.

The app owns the launcher, authorization, editing state, and readiness predicate.
`src/editor-panel.tsx` mounts `PreparedBrowserEditor`; the toolkit composes its
workspace provider, controller and default recipe. The editor's **Reload file** picks up agent edits before manual
editing; manual text autosaves locally. Exit refreshes the normal app's backend
queries. The normal host page continues to use its built source.

`.editor/` is ignored preparation output, not checked-in scaffolding. OPFS source
and chat history retention are intended lifecycle behavior, not a completed browser
qualification of this revision; dependencies are restored on each open.
**A local flush is not a server save or Git commit.**
Remote Git patch persistence is a future, separate milestone. Todo data remains the
ordinary server-owned in-memory map and resets only when that Bun server restarts.
