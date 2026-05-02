# Account Migration Plan

This document describes the full plan for adding multi-user authentication to bird-log using Clerk.
Each phase is designed to be handed off to an LLM as a self-contained implementation task.

---

## Stack context (read before each phase)

- **Framework**: Next.js (App Router), TypeScript, Bun
- **DB**: SQLite via `better-sqlite3` + Drizzle ORM; schema at `src/db/schema.ts`, db instance at `src/db/index.ts`
- **Auth**: Clerk (to be added)
- **Deployment**: Docker container on Raspberry Pi, Cloudflare tunnel for ingress, local volume for `/data` (SQLite) and `/uploads` (photos)
- **Package manager**: Bun (`bun add`, `bun run`)

---

## Phase 1 — Environment variable infrastructure

**Goal**: Make the app env-var driven so secrets (Clerk keys, etc.) can be injected at runtime without being committed to git.

### Tasks

1. **Create `.env.local` (gitignored) for local dev**
   - `.gitignore` already ignores `.env*`, so no change needed there.
   - Create `.env.local` with placeholder values for every var the app will eventually need:
     ```
     # Clerk
     NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
     CLERK_SECRET_KEY=

     # App
     DATABASE_PATH=./data/bird-log.db
     UPLOADS_DIR=./uploads
     ```

2. **Create `.env.example` (committed) with the same keys but empty values**
   - This is the reference template for anyone deploying the app.

3. **Update `src/db/index.ts` to read `DATABASE_PATH` from env**
   - Replace the hardcoded `./data/bird-log.db` with `process.env.DATABASE_PATH ?? './data/bird-log.db'`.

4. **Update all `POST /api/sightings` and related upload routes to read `UPLOADS_DIR` from env**
   - Replace hardcoded `./uploads` path with `process.env.UPLOADS_DIR ?? './uploads'`.
   - There are at least two places: the POST handler (writing files) and `GET /api/uploads/[filename]` (serving files).

5. **Add a Docker secrets / runtime injection section to this doc** (update this file) explaining that in production the `.env` file will be bind-mounted or vars passed via `docker run --env-file`.

### Acceptance criteria
- `bun run dev` still works with `.env.local` present.
- No secrets or env vars are hardcoded in source.
- `.env.example` is committed.

---

## Phase 2 — Clerk authentication setup

**Goal**: Add Clerk to the Next.js app so users can sign up / sign in. No data scoping yet — just auth wiring.

### Prerequisites
- Phase 1 complete (env var infrastructure exists).
- A Clerk account and application created at clerk.com. The app will need two environments: development (for local) and production (for the Pi). Both sets of keys go into the appropriate `.env` files.

### Tasks

1. **Install Clerk SDK**
   ```bash
   bun add @clerk/nextjs
   ```

2. **Add Clerk middleware** (`src/middleware.ts`)
   - Use `clerkMiddleware()` from `@clerk/nextjs/server`.
   - Protect all API write routes (`POST`, `PUT`, `DELETE` to `/api/sightings*`) — return 401 if not signed in.
   - Leave read routes (`GET`) public for now (no login required to browse).
   - Leave all page routes public for now (we'll lock down the `/add` and `/edit` pages in Phase 4).
   - Use Clerk's `createRouteMatcher` to define public vs protected paths.

3. **Wrap the root layout** (`src/app/layout.tsx`)
   - Wrap the tree in `<ClerkProvider>`.
   - Add `<SignInButton>`, `<SignedIn>`, `<SignedOut>`, `<UserButton>` components to `src/components/Nav.tsx` so the nav shows sign-in/sign-out state.

4. **Add sign-in and sign-up pages**
   - Create `src/app/sign-in/[[...sign-in]]/page.tsx` using Clerk's `<SignIn>` component.
   - Create `src/app/sign-up/[[...sign-up]]/page.tsx` using Clerk's `<SignUp>` component.
   - Set `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in` and `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up` in `.env.local` and `.env.example`.

5. **Verify environment variable names** match exactly what Clerk expects:
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
   - `CLERK_SECRET_KEY`
   - `NEXT_PUBLIC_CLERK_SIGN_IN_URL`
   - `NEXT_PUBLIC_CLERK_SIGN_UP_URL`

### Acceptance criteria
- Unauthenticated users can browse all pages and read data.
- Unauthenticated `POST /api/sightings` returns 401.
- Sign-in page exists and Clerk auth flow works end-to-end locally.
- `UserButton` shows in nav when signed in.

---

## Phase 3 — Database migration: add `userId` to sightings

**Goal**: Add a `userId` column to the `sightings` table and backfill existing rows with a known default user ID (your Clerk user ID).

### Prerequisites
- Phase 2 complete (Clerk is installed, you have a real Clerk user ID from signing in).

### Tasks

1. **Find your Clerk user ID**
   - Sign in locally, open the Clerk dashboard or use `auth()` in a debug route to print your user ID. It looks like `user_2abc...`.

2. **Add `userId` to the schema** (`src/db/schema.ts`)
   - Add `userId: text('user_id').notNull()` to the `sightings` table.
   - For the migration to work without breaking existing rows, temporarily allow null: `text('user_id')` (no `.notNull()`). We'll add the constraint after backfill.

3. **Generate and apply the migration**
   ```bash
   bun run db:generate
   bun run db:push
   ```

4. **Write a one-time backfill script** (`scripts/backfill-user-id.ts`)
   - Reads the `DEFAULT_USER_ID` from an env var (set this to your Clerk user ID in `.env.local`).
   - Runs: `UPDATE sightings SET user_id = $userId WHERE user_id IS NULL`.
   - Add `DEFAULT_USER_ID=user_2abc...` to `.env.local` and `.env.example`.
   - Add a script entry in `package.json`: `"db:backfill": "bun run scripts/backfill-user-id.ts"`.

5. **Re-add `.notNull()` to the schema** after confirming backfill ran, regenerate + push again.

6. **Add `userId` to `drizzle.config.ts`** if needed for type correctness.

### Acceptance criteria
- All existing sightings have your Clerk user ID in `user_id`.
- Schema has `user_id text NOT NULL` on `sightings`.
- `bun run db:push` runs clean.

---

## Phase 4 — Authorization: enforce user scoping on write routes

**Goal**: All write operations (create, update, delete sighting; upload photo) check that the authenticated user owns the resource. Add `userId` when creating. Lock down the UI pages that trigger writes.

### Prerequisites
- Phase 3 complete (`userId` column exists and is backfilled).

### Tasks

1. **On `POST /api/sightings`** (`src/app/api/sightings/route.ts`)
   - Call `auth()` from `@clerk/nextjs/server` to get the `userId`.
   - If no `userId`, return 401.
   - Insert `userId` into the new sighting row.

2. **On `PUT /api/sightings/[id]`**
   - Call `auth()` to get `userId`.
   - Fetch the sighting first; if `sighting.userId !== userId`, return 403.
   - Proceed with update only if ownership check passes.

3. **On `DELETE /api/sightings/[id]`**
   - Same ownership check as PUT.

4. **On `POST /api/sightings/[id]/photos`**
   - Same ownership check (verify the parent sighting belongs to the caller).

5. **Protect UI pages** — redirect unauthenticated users to sign-in:
   - `/add` — wrap with a server-side auth check; redirect to `/sign-in` if not signed in.
   - `/sighting/[id]/edit` — same.

6. **Hide UI elements for unauthenticated users**
   - In the sighting detail page (`/sighting/[id]`), hide Edit/Delete buttons if not signed in or not the owner.
   - In the nav, hide the "Add Sighting" link if not signed in.

### Acceptance criteria
- Signed-out user cannot POST/PUT/DELETE via API (returns 401/403).
- Signed-in user can only edit/delete their own sightings.
- Visiting `/add` while signed out redirects to `/sign-in`.
- New sightings are created with the caller's `userId`.

---

## Phase 5 — Docker + production deployment

**Goal**: Package the app as a Docker container with a bind-mounted volume for data, compatible with deployment on a Raspberry Pi behind a Cloudflare tunnel.

### Tasks

1. **Create `Dockerfile`**
   - Multi-stage build: `FROM oven/bun:alpine AS builder`, then a lean runtime stage.
   - Copy `data/` and `uploads/` as volumes (not baked into the image).
   - `EXPOSE 3000`, `CMD ["bun", "run", "start"]`.

2. **Create `docker-compose.yml`**
   - Mount `./data:/app/data` and `./uploads:/app/uploads`.
   - Pass env vars from a `.env` file (use `env_file: .env`).
   - Optionally map port 3000.

3. **Create `.env.production.example`** with all required vars including Clerk production keys.

4. **Cloudflare tunnel config**
   - Document (in this file or a separate `DEPLOY.md`) how to point the tunnel at `localhost:3000`.
   - No code changes needed — the tunnel handles TLS termination.

5. **Database migration on deploy**
   - Add a `db:push` step to the container startup or document running it manually on first deploy.

### Acceptance criteria
- `docker compose up` starts the app and it's accessible.
- Data persists across container restarts via the mounted volume.
- No secrets are baked into the image.

---

## Phase 6 (future) — Per-user URL namespacing

**Goal**: Reorganize routes so data is prefixed by user, e.g. `/user/[userId]/sightings`, `/user/[userId]/trips`.

This phase is deferred — the exact UX and routing strategy is TBD. It depends on whether the app is primarily single-user (one person's bird log, publicly viewable) or truly multi-user (each user has their own private/public profile). Decide and document here before implementing.

Likely tasks when the time comes:
- Add dynamic route segment `src/app/user/[userId]/...` mirroring existing pages.
- Update nav links to include the current user's ID.
- Decide on read visibility (is another user's list publicly visible?).
- Redirect old routes to new prefixed routes for backwards compatibility.

---

## Implementation order summary

| Phase | What | Dependencies |
|-------|------|-------------|
| 1 | Env var infrastructure | — |
| 2 | Clerk auth setup | Phase 1 |
| 3 | DB migration + backfill | Phase 2 (need real Clerk user ID) |
| 4 | Authorization enforcement | Phase 3 |
| 5 | Docker + deployment | Phase 4 |
| 6 | Per-user URL namespacing | Phase 4, TBD design |
