# Multi-User Migration Checklist

Migration from the existing single-user-feeling layout (`docs/site-layout.md`, current section) to the proposed multi-user layout (`docs/site-layout.md`, "Proposed layout (multi-user)" section).

Each item is a discrete, AI-agent-sized task. Do them roughly top-to-bottom — the schema/API foundation has to land before the UI can consume it.

---

## 1. Database & user identity

- [x] Add a `users` table to `src/db/schema.ts` with: `id` (text, PK — Clerk user id), `username` (text, unique, not null), `displayName` (text, not null), `createdAt` (text, ISO).
- [x] Run `bun run db:generate` to create the migration for the new `users` table, then `bun run db:push`.
- [x] Add a foreign key from `sightings.userId` referencing `users.id` (update schema + generate migration). Decide on `onDelete` behavior (cascade vs set null) and document.
- [x] Write a one-time backfill script `scripts/backfill-users.ts` that inserts a row into `users` for every distinct `userId` currently in `sightings`. Use Clerk's backend SDK (`clerkClient.users.getUser(id)`) to fetch each user's username/displayName; fall back to a derived placeholder if Clerk has no record. Add a `db:backfill-users` script entry to `package.json`.
- [ ] Add a Clerk webhook handler at `src/app/api/webhooks/clerk/route.ts` that listens for `user.created` and `user.updated` events and upserts into the `users` table. Document the webhook URL + signing secret env var (`CLERK_WEBHOOK_SECRET`) in `.env.example`.
- [ ] Add a `src/lib/users.ts` helper exporting `getUserByUsername(username)`, `getUserById(id)`, and `resolveUserParam(param)` (accepts either a username or Clerk id and returns the row). Used by all `/user/[id]` routes.
- [ ] Decide URL identifier strategy: recommend `/user/[username]` (friendlier). Document the choice in a short comment at the top of `src/lib/users.ts`.

## 2. API: add user-scoping query params

- [ ] `GET /api/sightings` (`src/app/api/sightings/route.ts`): accept an optional `userId` query param and add a `WHERE user_id = ?` filter when present.
- [ ] `GET /api/trips` (`src/app/api/trips/route.ts`): accept an optional `userId` query param and filter sightings before passing to `computeTrips`.
- [ ] `GET /api/search` (`src/app/api/search/route.ts`): accept an optional `userId` query param and add the filter. Default remains site-wide.
- [ ] Add a new `GET /api/users/[username]` route returning `{ id, username, displayName, lifeListCount, tripCount, sightingCount }`. Computes counts via SQL.
- [ ] Add a new `GET /api/users` route returning a list of users with basic stats (powers the optional `/users` directory page). Sort by recent activity by default.

## 3. Routing — new pages

- [ ] Create `src/app/user/[username]/page.tsx` — User Home. Fetch the user, render header (display name, lifer count, trip count, edit-profile link if viewer is the user), then a `PhotoGrid` filtered to that user's sightings.
- [ ] Create `src/app/user/[username]/trips/page.tsx` — User Trips. Mirrors current `src/app/trips/page.tsx` but filters trips by `userId`.
- [ ] Create `src/app/user/[username]/trips/[tripId]/page.tsx` — User Trip Detail. Mirrors current `src/app/trips/[id]/page.tsx` but scoped to user.
- [ ] Create `src/app/user/[username]/checklist/page.tsx` — Personal Checklist. Mirrors current `src/app/checklist/page.tsx` but `seenCodes` is built from that user's sightings only. Add a "Switch to site-wide list" link → `/checklist`.
- [ ] Create `src/app/user/[username]/species/[speciesCode]/page.tsx` — Per-User Species Detail. Shows the user's sightings of one species, lifer date, photos. Link "View all sightings on the site" → `/species/[code]`. Link "Back to my checklist" → `/user/[username]/checklist`.
- [ ] (Optional, low priority) Create `src/app/users/page.tsx` — Birder Directory. Lists users from `GET /api/users`, sortable by lifer count / recent activity.

## 4. Routing — modify existing pages

- [ ] Update `src/app/page.tsx` (Home → Explore): keep behavior (global photo grid) but rename in comments / heading copy if any to reflect "Explore". `PhotoGridLoader` already pulls every user's sightings, so likely no fetching change needed.
- [ ] Update `src/components/PhotoGridLoader.tsx` to accept an optional `userId` prop and pass it through to the DB query (`where(eq(sightings.userId, userId))` when set). Used by the user-scoped photo grid.
- [ ] Update `src/app/checklist/page.tsx` (Site-Wide Checklist): keep current behavior (counts species seen by *anyone*). Add a "Switch to my list" link → `/user/[me]/checklist` when signed in.
- [ ] Update `src/app/species/[speciesCode]/page.tsx` (Site-Wide Species Detail): when viewer is signed in and has logged this species, render a "View my sightings" link → `/user/[me]/species/[speciesCode]`.
- [ ] Update `src/app/trips/page.tsx` to redirect: signed-in → `/user/[me]/trips`; signed-out → `/` (Explore). Or remove this route entirely once the redirect is in place.
- [ ] Update `src/app/trips/[id]/page.tsx` similarly — redirect to the new user-scoped trip URL, OR remove and let users land on user-scoped trips only.
- [ ] Update `src/app/sighting/[id]/page.tsx` (Sighting Detail): add a "by @username" link near the title that points to `/user/[username]`. Update the back-link target to `/` (Explore) instead of staying as Home.
- [ ] Update `src/app/sighting/[id]/edit/EditForm.tsx`: change the "Back" link to `/sighting/[id]` (per the new diagram, edit returns to detail rather than Home).
- [ ] Update post-save / post-delete redirect targets in `SightingForm.tsx` (and any caller): after save → `/sighting/[id]` or `/user/[me]`; after delete → `/user/[me]`.

## 5. Nav

- [ ] Update `src/components/Nav.tsx` to render the new link sets:
  - Signed out: **Explore · Checklist · Search · Sign In**
  - Signed in: **Explore · My Profile · My Trips · My Checklist · Search · Add**
- [ ] In the signed-in nav, resolve "My Profile / My Trips / My Checklist" hrefs against the current user's username. Fetch username via a small client hook that calls `/api/users/me` (new endpoint) or via Clerk's `useUser()` + a `username` value mirrored from Clerk.
- [ ] Add `GET /api/users/me` returning the signed-in user's row from the `users` table (404/401 if not signed in or not yet provisioned).

## 6. Components — surface usernames

- [ ] Update `PhotoGrid` (`src/components/PhotoGrid.tsx`): include `username` in the `PhotoItem` shape and render an `@username` overlay on each tile that links to `/user/[username]`. Update `PhotoGridLoader` to join sightings → users so the username is available.
- [ ] Update `SightingCard` (`src/components/SightingCard.tsx`): show `@username` under the species line, linked to `/user/[username]`. Hide the Edit/Delete actions unless the viewer owns the sighting (currently always shown).
- [ ] Update `TripCard` (`src/components/TripCard.tsx`): if rendered on the global Explore context, show `@username` for the trip owner. Skip on user-scoped trips pages.
- [ ] Update the shape returned by `/api/sightings`, `/api/trips`, `/api/search` to include `username` and `displayName` (join against `users` on `userId`). Update TS interfaces in callers.

## 7. Profile management

- [ ] Add an "Edit Profile" page at `src/app/user/[username]/edit/page.tsx` (only accessible to the user themselves) — form for `displayName` and `username`. POSTs to `PUT /api/users/me`.
- [ ] Add `PUT /api/users/me` API route that updates `displayName` and `username` (validate uniqueness on `username`).
- [ ] On signup completion (Clerk webhook `user.created`), auto-pick a username from `clerkUser.username || clerkUser.firstName || 'birder' + shortId` and ensure uniqueness.
- [ ] After sign-up redirect: send users to `/user/[me]` instead of `/` (configurable via Clerk's `afterSignUpUrl` or a router push in the sign-up page).

## 8. Authorization & ownership checks

- [ ] Confirm `PUT /api/sightings/[id]` and `DELETE /api/sightings/[id]` still enforce ownership (already do — verify nothing was broken by the user-table join changes).
- [ ] Lock `PUT /api/users/me` and the profile edit page behind auth; reject attempts to edit a different user.
- [ ] Add a guard helper `assertOwnUser(usernameParam)` used by `/user/[username]/edit` to redirect to the public profile if a non-owner hits the edit URL.

## 9. Backfill & data integrity

- [ ] Run `db:backfill-users` against the existing local DB and verify every row in `sightings` has a matching row in `users`.
- [ ] Add a unique index on `users.username` (case-insensitive if possible, otherwise normalize on write).
- [ ] Sanity-check production / Pi deployment plan: webhook endpoint must be reachable through the Cloudflare tunnel, and `CLERK_WEBHOOK_SECRET` must be set in the production `.env`.

## 10. Cleanup

- [ ] Remove the old `/trips` and `/trips/[id]` page files once the user-scoped versions and redirects are stable.
- [ ] Update `docs/site-layout.md` to delete the old "current" diagram/table and promote "Proposed layout (multi-user)" to be the only documented layout.
- [ ] Update `README.md` (and `AGENTS.md` if it references routes) to reflect the new URL structure.
- [ ] Audit hardcoded `href="/"` usages — most should become `/user/[me]` or `/sighting/[id]` per the updated diagram in `docs/site-layout.md`.

---

## Suggested order of execution

1. Section 1 (schema + users table + backfill) — nothing else can land safely without this.
2. Section 2 (API filters) — unblocks the new pages.
3. Sections 3 & 4 in parallel (new pages and modified pages).
4. Section 5 (nav) — small, do once routes exist.
5. Section 6 (components show usernames) — touches multiple pages, do after routes settle.
6. Sections 7, 8 — profile management + auth tightening.
7. Sections 9, 10 — backfill verification and cleanup.
