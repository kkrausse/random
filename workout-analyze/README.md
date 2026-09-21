# Workout Ledger

Local-first Garmin activity archive, DuckDB pipeline, and TanStack Start browser.

## Architecture north star

Target the same React / TypeScript application in the browser and iPhone WKWebView, backed by a shared host contract implemented by local Bun on Mac and native Swift on iPhone. The phone should independently record, recover, browse, and analyze local workouts without a required server or sync. The working direction is a durable host journal, foreground shared TypeScript consumers, and native DuckDB behind a primitive host interface. See [architecture goals and open decisions](docs/architecture-north-star.md).

## iPhone app proposal

See [the technical proposal](docs/iphone-workout-proposal.md) for the native WebKit recorder, GPS/Bluetooth bridge, live laps, and segment comparisons. [Excalidraw wireframes](docs/iphone-workout-wireframes.excalidraw) sketch the proposed screens; this is a design proposal, not an implemented iOS app.

## Debug the mobile web runtime

The development build includes a [physical-iPhone development runner](docs/iphone-dev-runner.md). Use it whenever you need to inspect or execute code in the actual foregrounded WKWebView JavaScript runtime. The page polls the dev server, receives a snippet, and evaluates it as an async function in TypeScript's browser environment; Swift does not execute runner jobs.

```sh
bun run mobile:dev
bun scripts/mobile/dev-runner/run.ts \
  --server https://kevins-macbook-pro-2.tail7e28fb.ts.net:8443 \
  --code 'return inspect.appState()'
```

The runner starts in Vite development mode even when the native bridge is unavailable. Such a page appears as client kind `unavailable` rather than `native`; pass `--kind unavailable` (and optionally `--client <id>`) to execute page-runtime diagnostics there. Native operations exposed through `bridge.request(...)` naturally require a functioning native bridge. Prefer `app.actions` for real UI workflows, `inspect` for read-only state, and `bridge.request` only for lower-level protocol diagnostics. The runner is intentionally absent from production bundles.

## Run

```bash
bun install
bun run garmin:login
bun run garmin:sync
bun run build:data
bun run build:analysis
bun run dev
```

The Garmin adapter is TypeScript and invokes the third-party `garmin-connect` CLI. On first use, the small shell launcher installs the pinned CLI into the project-local `.venv`; no application code is Python. Authentication tokens stay outside the repository under `~/.config/garmin-connect-cli`, and credentials are prompted interactively.

`garmin:sync` only acquires original files into `data/raw/garmin`. `build:data` never contacts Garmin and atomically rebuilds normalized workout data. `build:analysis` is a separate derived-data pass that detects repeated segments and loops from the normalized samples. `build` runs both data passes and the application build; use `build:app` when only the web bundle is needed.

Garmin Connect is accessed through an unofficial client and may occasionally require re-authentication.

## Analysis defaults

Route detection currently resamples GPS tracks at 40 m, accepts up to 30 m route deviation, requires a 500 m segment or a 200-3000 m closed loop, treats endpoints within 40 m as closed, and requires matches in at least three distinct workouts. Candidate lookup uses 120 m spatial cells. Qualified segments are rebuilt as median consensus centerlines and retain per-workout partial coverage, which drives the support profile on route details. By default nested popular cores are folded into the longest qualifying route; the nested segment Jaccard setting can retain support-distinct cores as separate routes. The complete named tuning surface is exported as `DETECTION_DEFAULTS` in `src/services/SegmentDetector.ts` and can be adjusted from the Detection settings section on `/analysis`.

Use `bun run analysis:experiment --label <name>` to run detection without replacing the application analysis tables. Reports are saved under ignored `data/analysis-experiments/`; pass `--baseline <name>` to compare geometry and workout support against an earlier run, and `--config '{"maxRouteDeviationM":40}'` to test overrides.
