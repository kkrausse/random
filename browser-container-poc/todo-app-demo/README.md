# Todo app

A small fullstack todo application: React 19, React Router 7 framework mode with Vite, and a Bun TypeScript server. This matches the core IRS Tools architecture: Vite proxies API requests to Bun during development; Bun serves the API, built assets, and React Router SSR in production. React Router supplies its default client entry. Native HTML controls keep the single-page interface small.

Requires Bun 1.3 or newer.

```sh
bun install
bun dev
```

Open http://localhost:5173. The development API listens on 127.0.0.1:3001.

```sh
bun test
bun run typecheck
bun run build
bun start
```

Production runs at http://127.0.0.1:3000; set `PORT` to change it.

## Todos

Add a todo, check it to mark it complete, or delete it. Data is held in memory and resets when the Bun server restarts. All clients share the same list.

| Method | Path | Body |
| --- | --- | --- |
| GET | `/api/todos` | — |
| POST | `/api/todos` | `{ "title": "Buy milk" }` |
| GET | `/api/todos/:id` | — |
| PATCH | `/api/todos/:id` | `{ "title": "Buy bread", "completed": true }` (either field) |
| DELETE | `/api/todos/:id` | — |

Titles are trimmed and must contain 1–200 characters. Invalid input returns 400, missing todos return 404, and unsupported methods return 405.
