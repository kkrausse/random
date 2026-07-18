# Routes

A local-first viewer for Apple Health workout routes. The app runs on TanStack Start and Bun, and renders GPX tracks with MapLibre GL JS through `react-map-gl`.

## Run

```bash
bun install
bun run dev
```

Open `http://localhost:3000`. The bundled example is served from `public/export.zip` and is decompressed in the browser. Use **Open another export** to inspect a local Apple Health ZIP without uploading it anywhere.

## What It Reads

- GPX files under `apple_health_export/workout-routes/`
- Route date from each Apple Health GPX filename
- GPS geometry, distance, duration, and point count from the selected GPX file

The large `export.xml` file remains inside the archive and is intentionally not read yet. It will be the source for activity types and richer workout metadata in the next iteration.

## Stack

- TypeScript, Bun, TanStack Start, React 19
- Tailwind CSS v4, shadcn/ui structure, Base UI primitives, Lucide icons
- MapLibre GL JS with `react-map-gl/maplibre`
- CARTO Voyager vector tiles during prototyping

The map style is isolated in `src/components/route-map.tsx`; switching to regional PMTiles later only requires replacing that map style/source configuration.

## Checks

```bash
bun run check
bun run build
```
