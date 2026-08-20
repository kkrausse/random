# Workout Ledger

Local-first Garmin activity archive, DuckDB pipeline, and TanStack Start browser.

## Run

```bash
bun install
bun run garmin:login
bun run garmin:sync
bun run build:data
bun run dev
```

The Garmin adapter is TypeScript and invokes the third-party `garmin-connect` CLI. On first use, the small shell launcher installs the pinned CLI into the project-local `.venv`; no application code is Python. Authentication tokens stay outside the repository under `~/.config/garmin-connect-cli`, and credentials are prompted interactively.

`garmin:sync` only acquires original files into `data/raw/garmin`. `build:data` never contacts Garmin and atomically rebuilds `data/fitness.duckdb` from that archive. `build` runs both the data build and application build; use `build:app` when only the web bundle is needed.

Garmin Connect is accessed through an unofficial client and may occasionally require re-authentication.
