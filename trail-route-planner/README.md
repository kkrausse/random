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

The map uses MapLibre for pan, wheel/⌘-scroll zoom, touch gestures, and route inspection. OpenTopoMap terrain/labels are fetched online only; the local OSM graph, routes, controls, and statistics still work offline, but there is no offline terrain basemap yet. Map data © OpenStreetMap contributors, SRTM; map style © OpenTopoMap (CC-BY-SA).

The topo tiles are desaturated behind the highlighted route. Distances default to miles; switch between miles and kilometers beside the distance range. The chosen unit is remembered locally, while search and graph calculations remain in kilometers.

The map's **Color by access** control switches the network and selected route between motorcycle, car (`motorcar`), and bicycle OSM access interpretations. Thick, vivid, white-cased lines mark the selected route; faint, thin lines show the surrounding graph over a muted topo basemap. Green means permitted, red prohibited, amber restricted/conditional, and purple unknown—not verified vehicle-free. Lighter green/red for cars means access was inferred from `highway=*`, not tagged. Mode-specific tags take priority over shared `motor_vehicle`, `vehicle`, and `access` tags. Ordinary street classes (including residential and service) are treated as likely car-accessible; paths, footways, cycleways, bridleways, pedestrian ways, and steps as likely not car-accessible; tracks stay unresolved without access tags. This is a routing heuristic, not verified legal access or observed traffic.

Search has separate car (`motorcar`), motorcycle, and bicycle sliders from −5 to +5. Car and motorcycle settings rank routes by **estimated traffic intensity per traveled meter**, not whether those vehicles are legally allowed. Residential, service and living streets are 1/1; larger streets and highways 1.5/1.5 (car/motorcycle). A motor-prohibited trail is 0/0; a dirt trail tagged `motorcar=no` and `motorcycle=yes` is 0/1. Untagged tracks remain unknown rather than zero; ranking provisionally costs unknown vehicle intensity as 0.75 without representing it as measured. Explicit access and road class can disagree because access is not observed traffic. Bicycle still favors permitted-access distance. The visible initial settings are car −1, motorcycle 0, bicycle 0 (mild car avoidance); all-zero has no road/vehicle ranking bias. A fixed, bounded mix of neutral and vehicle-aware discovery paths is generated independently of slider positions, then distance filtering, deduplication, diversity, and the result cap happen **before** preference scoring. For identical non-slider inputs, sliders can only change scores/order, never which routes are returned—even at ±5. The activity's own explicit access restrictions, barriers, and requested distance range remain hard constraints. If no sampled candidate fits, the list is empty rather than silently relaxing distance.

Sidewalk-like `highway=footway` edges inherit 80% of the nearest street's intensity only when the graph geometry places their midpoint within 20 m of a roughly parallel street segment (absolute directional cosine ≥0.8); crossings are excluded. This includes footways without `footway=sidewalk` that align with a road, avoiding the cheap motor-free sidewalk workaround. An explicitly tagged but isolated sidewalk has **unknown** intensity, not zero; other isolated footways retain their own access-based trail estimate. This geometric heuristic can miss offset/curving sidewalks or confuse parallel paths; it does not estimate vehicle counts, speed, sound, or verify legal access. The results table's CAR × and MOTO × show distance-weighted means over **known** kilometers; route detail gives known/unknown kilometers and sidewalk coverage. CAR + remains permitted-access distance, independent of estimated traffic. A `highway=track` can count as trail distance even when motor vehicles are permitted.

For the bundled region at start node 3007, 3.21868–9.65604 km loop, hiking, seed 3, **all three settings return the same 16 routes**: neutral (all zero) ranks a 6.4229 km route first (2.4798 road km, 3.7604 modeled car-intensity km); the visible default (car −1) and car −5 rank a 6.1105 km route first (1.6127 road km, 2.0106 modeled car-intensity km). The ranked top route may change when preferences change, but result membership and geometry do not. A negative car setting is a relative preference, not a promise of a motor-free route; roads and unknown stretches can still appear.

### Offline basemap decision (open)

The app currently bundles **routing data**, not background tiles. OpenTopoMap's [usage notes](https://opentopomap.org/about) allow attributed use of its CC-BY-SA map but caution against mass downloads from its public server and offer no availability guarantee. Reuse licensing alone is not permission to bulk-prefetch an entire region from that server; do not add such a downloader without explicit provider approval. The [OSM standard tile server policy](https://operations.osmfoundation.org/policies/tiles/) expressly prohibits bulk/offline tile downloads. OSM **raw data extracts** are a different thing: they can be acquired under ODbL and processed into our own tiles.

Preferred prototype: build a small vector basemap archive (e.g. PMTiles) from a versioned OSM extract, render it with MapLibre, and package the style/fonts/icons too. Terrain contours or hillshade require a separately sourced elevation dataset. Generate the routing graph from the same OSM snapshot, then measure archive size, attribution obligations, local serving, and an offline reload before choosing the full Tahoe package. See the [plan's offline-package questions](doc/PLAN.md#8-offline-packages-and-personal-data-durability).

To prepare the same region from current bounded OSM data (the source timestamp/checksum will change):

```sh
bun run prepare:region
# or replay an archived Overpass JSON response:
bun run prepare:region /absolute/path/to/overpass-response.json
```

The script uses a fixed 39.202,-120.075,39.255,-120.005 bbox and prints counts. `public/kings-beach.json` embeds the exact Overpass query, endpoint, upstream OSM-base timestamp, raw response SHA-256, ODbL attribution, way IDs/all tags, node IDs/tags, and each consecutive graph edge. Source ways can extend past the bounding rectangle because Overpass returns complete way geometry; no synthetic geometry is generated. The original API response is not committed; to byte-reproduce this exact snapshot, archive a response whose SHA matches the package metadata.

Documentation: [plan](doc/PLAN.md), [handoff](doc/HANDOFF.md), [browser report](doc/browser/REPORT.md), and [Organic Maps report](doc/organic-maps/REPORT.md).
