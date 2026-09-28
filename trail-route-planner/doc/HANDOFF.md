# Trail route planner handoff

## Start here

Project: `/Users/kkrausse/Documents/repos/kkrausse/random/trail-route-planner`

Read `doc/PLAN.md` for the product/architecture direction, `doc/browser/REPORT.md` for browser evidence and limitations, and `doc/organic-maps/REPORT.md` for native build reproduction and retention findings. The user is now trying the prototype and may give route-quality/UI feedback. Do not assume the planned milestones are complete.

## User intent

Personal-use, local-first browser planner for hiking and gravel biking. Generate many distinct outings for a distance range, start point/radius, and adjustable soft preferences. Especially avoid motorcycles, e-bikes/bikes when hiking, and car exposure. Short undesirable connectors are acceptable if visible and proportionally penalized. Physical separation from cars is distinct from legal access or observed traffic.

Split-screen results table and selected route map. Precise numerical distance/percentage statistics, not prose such as “mostly trails.” Attributes overlap; unknown access must stay visible. Add waypoints to regenerate eventually; exact section locking can wait. Initial geography Kings Beach/North Tahoe, later Marin/SF.

Offline regional downloads and local algorithms are foundational. Future personal saved routes/overrides need export/backup beyond browser storage. External map/AI ingestion is deferred. No accounts, social functionality, or turn-by-turn navigation needed.

## Current artifacts

- `615076f`: initial plan.
- `b3eb945`: working browser v0 and custom OSM graph preparation.
- `7da5211`: Organic Maps build/audit, reproduction tooling and companion export experiment.

Browser v0: Bun, TypeScript, React, Effect `4.0.0-rc.117`, Vite, Tailwind, Base UI, Lucide. Real bundled Kings Beach graph: 1,180 OSM ways, 8,829 nodes, 9,042 edges, ~1.1 MB JSON. Source metadata and raw tags retained. SVG linework map, worker-based local loop/out-and-back generation, numeric sortable results, selected-route framing, click-to-change start, and raw segment-tag inspection. Default tests produced 12 loops / 8 out-and-backs. This is a custom adapter, NOT Organic Maps-generated graph consumption.

Reported verification by browser agent: five Bun tests and production build passed; Chromium desktop production preview reloaded offline and generated routes with service worker cache installed. Phone behavior and practical route quality are unverified.

Organic Maps spike: built generator at upstream `98099c37`, produced small Kings Beach `.mwm`, passed `--check_mwm`. Native package includes geometry/search/routing/road-access sections, but no actual A-to-B route was run. Input was small live OSM XML, not a full Tahoe PBF region. Stock road access distinguishes car/pedestrian/bicycle interpretations, not separate motorcycle/e-bike permission. Companion export preserved raw tags and source versions joined to final feature IDs: 2,097 ways mapped to 2,100 features, including split ways. Companion ~371 KB versus ~102 KB MWM, unoptimized. Spike includes a patch fixing empty turn-restriction handling that skipped access serialization. See report for exact evidence and reproduction.

## Run

```sh
cd /Users/kkrausse/Documents/repos/kkrausse/random/trail-route-planner
bun install
bun run build
bunx vite preview --host 127.0.0.1 --port 4173
```

Open `http://127.0.0.1:4173/`. Region is already bundled. A preview was launched in the prior session; do not assume it survives handoff. Check existing listeners before launching another server or changing ports.

For live development: `bun run dev` (use printed URL). For tests: `bun test`. For re-fetching source data: `bun run prepare:region`; consult README/report first because source timestamps/data may change. Development mode is not an offline-installation test.

## Important gaps

- SVG trail linework only: no geographic basemap/terrain/labels. Tiny segment hit targets can overlap; arbitrary clicked starts can land in disconnected fragments.
- Small area, not a useful large regional download. No browser MWM/WASM router proof or settled package architecture.
- No restriction relations, complete barrier/conditional access handling, country-specific defaults, mode-specific oneway exceptions, elevation, or cross-region stitching. E-bike raw tags are retained but not specially interpreted. Gravel currently rejects stairs rather than modeling dismount.
- No region import UI/catalog, atomic update/rollback, package hash verification, saved routes/backups, GPX, GPS display, or phone test.
- Service worker cache version needs updating on package replacement; cache eviction remains possible. Real data does not make generated suggestions validated navigation advice.
- UI uses Base UI and native controls rather than generated shadcn components. Do not describe the prototype as a finished implementation of every stack/product requirement.

## Recommended next work

1. Let the user inspect suggestions; capture specific bad routes, missing statistics, and map usability issues.
2. Reproduce cases using the current data version and deterministic inputs before changing ranking.
3. Improve enough map context/inspection to judge route quality, then tune meaningful diversity and preference exposure.
4. Make an explicit evidence-based architecture decision: extend MWM, export from Organic Maps into a browser graph, or keep a dedicated pipeline. Do not assume the two independent spikes are integrated.
5. Continue the staged plan, prioritizing offline correctness and personal-data durability before depending on saved work.

## Development instructions

- User explicitly authorized SOL subagents. Resolve/use `openai/gpt-6-sol` for delegated implementation. Previous two agents completed; fresh agents are appropriate for independent next tasks.
- Load the Effect skill; use current pinned v4 APIs, domain service contracts and explicit Layers, branded IDs/units, Struct/interface records. Service-oriented means in-process boundaries, not backend microservices.
- Use Bun-backed `browser-control` CLI and its skill for browser testing, never browser MCP.
- Commit owned changes only with explicit file paths. Repo ignores new project files; use targeted `git add -f` where necessary, never broad staging. Other projects may have concurrent work.
- Main Organic Maps code Apache 2.0; OSM data ODbL. Preserve applicable attribution/licenses and inspect third-party dependencies before incorporating code.

Absolute planning/report paths:

- `/Users/kkrausse/Documents/repos/kkrausse/random/trail-route-planner/doc/PLAN.md`
- `/Users/kkrausse/Documents/repos/kkrausse/random/trail-route-planner/doc/browser/REPORT.md`
- `/Users/kkrausse/Documents/repos/kkrausse/random/trail-route-planner/doc/organic-maps/REPORT.md`
