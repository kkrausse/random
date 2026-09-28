# Trail Routes — Kings Beach browser v0

Local-first static prototype. **This is a dedicated OSM → JSON graph adapter, not an Organic Maps `.mwm` export or proof of its pipeline reuse.**

```sh
cd /Users/kkrausse/Documents/repos/kkrausse/random/trail-route-planner
bun install
bun test
bun run build
bunx vite preview --host 127.0.0.1 --port 4173
```

Open `http://127.0.0.1:4173/` once online, wait for service worker installation, then reload offline. The production build precaches the app, worker, stylesheet, and bundled Kings Beach region. `bun run dev` is not an offline installation test.

To prepare the same region from current bounded OSM data (the source timestamp/checksum will change):

```sh
bun run prepare:region
# or replay an archived Overpass JSON response:
bun run prepare:region /absolute/path/to/overpass-response.json
```

The script uses a fixed 39.202,-120.075,39.255,-120.005 bbox and prints counts. `public/kings-beach.json` embeds the exact Overpass query, endpoint, upstream OSM-base timestamp, raw response SHA-256, ODbL attribution, way IDs/all tags, node IDs/tags, and each consecutive graph edge. Source ways can extend past the bounding rectangle because Overpass returns complete way geometry; no synthetic geometry is generated. The original API response is not committed; to byte-reproduce this exact snapshot, archive a response whose SHA matches the package metadata.

Detailed scope, evidence, limitations, and browser test: [spikes/browser/REPORT.md](spikes/browser/REPORT.md).
