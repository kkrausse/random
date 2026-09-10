# Todo app: IRS Tools stack baseline

A minimal unauthenticated todo app using the relevant wiring from `../irs-tools` (the sibling repository of `random`):

- React 19 and React Router 7 framework mode: `appDirectory: 'src'`, `ssr: false`, `prerender: true`. React Router supplies the default client entry. IRS's `entry.server.tsx` is used only for build-time prerendering, producing static HTML plus client assets.
- Vite with Tailwind CSS 4, React Router, and tsconfig-paths plugins, in that order; `@/*` maps to `src/*`. Development `/api` requests proxy to Bun on port 3001.
- `Bun.serve` route maps: `/api/*` uses tRPC's `fetchRequestHandler` at endpoint `/api`; production `/*` uses `createStaticHandler('build/client')`. No framework request handler runs in production.
- tRPC 11: one `initTRPC` context in `src/server/trpc.ts`, procedures in `trpcRouter.ts`, Valibot schemas passed directly to `.input()`. Context contains `req` and an in-memory todo map.
- IRS's `httpBatchLink`, typed client, both React tRPC providers, and QueryClientProvider. Active frontend calls use `useTRPC()` with TanStack Query `queryOptions`, `mutationOptions`, and query-key invalidation, matching IRS's current hooks.
- IRS's static handler pattern: exact files, directory index, explicit application-route SPA fallback, real unknown-path/asset 404s, HEAD support, traversal checks, and immutable asset caching. The application-route allowlist is reduced to `/`.

Clerk, SOPS, encryption, and IRS business integrations are omitted. Native HTML controls keep the UI minimal. There are no editor or browser runtime dependencies.

Requires Bun 1.3 or newer. Run commands from this directory:

```sh
bun install
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
