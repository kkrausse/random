# BirdMog

BirdMog is a multi-user bird sighting log built with Next.js, Clerk, Drizzle, and SQLite/libSQL. The public homepage is an Explore feed of everyone's sightings, while each birder has their own profile, trips, checklist, and species-history pages under `/user/[username]`.

## Routes

- `/` - Explore, the global photo grid.
- `/user/[username]` - a birder's public profile and photo grid.
- `/user/[username]/trips` and `/user/[username]/trips/[tripId]` - user-scoped trips.
- `/user/[username]/checklist` - the user's personal life list.
- `/user/[username]/species/[speciesCode]` - that user's sightings for one species.
- `/checklist` and `/species/[speciesCode]` - site-wide checklist and species pages.
- `/users` - birder directory.
- `/sighting/[id]` and `/sighting/[id]/edit` - sighting detail and owner-only edit flow.
- `/add` - signed-in sighting creation.

See `docs/site-layout.md` for the full route diagram and source-file map.

## Getting Started

Use bun for all package and runtime commands.

```bash
bun install
bun run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Common Commands

```bash
bun run tsc
bun run build
bun run db:generate
bun run db:push
bun run db:backfill-users
```

Prefer `bun run tsc` for quick compile-time validation while developing.
