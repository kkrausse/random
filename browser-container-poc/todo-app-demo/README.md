# Todo app: IRS Tools stack + browser agent kit

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
bun run --cwd ../opencode-chat build
bunx --package bun@1.3.9 bun install
```

The dependencies point at compiled package directories, so toolkit source, tests, and
build dependencies do not enter this app. Bun 1.3.9 is used for installation because
the installed Bun 1.4.0 rejects sibling `file:` package paths. Build/run commands work
with the installed Bun. After rebuilding a toolkit package, reinstall with `--force`.

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

The existing pinned runtime and OpenCode V2 package are prerequisites. Defaults are
`../workspace-api/dist/runtime` and `../vivari/.runtime/opencode-v2-package`; override
with `RUNTIME_DIR` and `OPENCODE_PACKAGE_DIR`. Use the workspace distribution command
to deliver the current preview query adapter before preparing:

```sh
bun run --cwd ../workspace-api distribution
bun run prepare:editor
bun run build
LOCAL_EDITOR_ADMIN=1 PORT=4390 bun start
```

Open http://127.0.0.1:4390 and choose **Enable editing**. `LOCAL_EDITOR_ADMIN=1`
is explicitly a **local loopback admin fixture**, not a production identity system.
Without it the launcher is absent and direct editor JS/CSS, runtime/prepared assets,
and model endpoints return 403. Replace `src/server/editing.ts` with the app's real
session/role policy when integrating authentication. The Vite development boundary
uses that same policy for editor modules.

`prepare.ts` is a single toolkit call. It packages the existing `src`, Vite, React
Router, and TypeScript configs; there is no second guest frontend. The shared
React Router config uses the toolkit's deployment basename, while the Vite boundary
excludes `src/editing.tsx` and its editor imports from guest execution. Framework
SPA rendering, tRPC React Query, CSS, and HMR all run from the same frontend source.
Guest `/api` calls go through the existing preview bridge to this real Bun server.

The app owns the launcher, authorization, editing state, and readiness predicate.
`src/editor-panel.tsx` mounts the library editor with a workspace provider and the
toolkit recipe. The editor's **Reload file** picks up agent edits before manual
editing; manual text autosaves locally. Exit refreshes the normal app's backend
queries. The normal host page continues to use its built source.

`.editor/` is ignored preparation output, not checked-in scaffolding. OPFS source
and chat history survive closing/reopening the editor on the same origin; dependencies
are restored on each open. **A local flush is not a server save or Git commit.**
Remote Git patch persistence is a future, separate milestone. Todo data remains the
ordinary server-owned in-memory map and resets only when that Bun server restarts.
