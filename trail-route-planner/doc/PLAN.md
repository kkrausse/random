# Local-first trail route planner

Status: agreed product direction; implementation choices gated by spikes.
Date: 2026-09-27.
Working name: trail-route-planner.

## 1. Goal and motivation

Generate many useful hiking and gravel-bike outings from a regional trail network, rank them by adjustable preferences, and expose precise segment-level tradeoffs. Think of browsing an AllTrails-like list, except the routes are generated for the current search rather than predefined.

The motivating workflow required switching between CalTopo for manual route construction and Overpass Turbo for motorcycle-access filtering, then manually assembling a loop of the desired length. Combine those activities and let the algorithm do most of the planning.

Initial user: one person. Initial validation area: Kings Beach / North Lake Tahoe, followed by Marin and San Francisco. No accounts, social features, or shared database design up front.

Success means useful, genuinely different route suggestions backed by inspectable data. The primary failure risks are poor route-search heuristics and missing or inaccurate access data.

## 2. Foundational decisions

- Browser-first application with regional downloads and local computation. Rendering, attribute inspection, route generation, ranking, and saved-route access must work offline after installation and download.
- No application backend required for core use. Static hosting can distribute the app and prepared regions; a local build command can prepare regions initially. Direct package import should also work.
- Prepare regional data ahead of time rather than assuming a browser must compile raw OSM. Whether browser-side preparation is worthwhile is a later question.
- TypeScript, Bun tooling, and Effect v4. Pin the exact v4 version and compatible integrations when implementation begins; verify APIs against that version.
- React UI with Tailwind CSS, shadcn/ui using Base UI, and Lucide. Prefer standard components before custom ones.
- Domain-first service contracts and explicit Layer composition, following the service-driven approach in https://www.effect.solutions/services-and-layers.
- Personal data is separate from replaceable regional data. Browser storage alone is not the backup strategy.
- OSM first; preserve an architectural seam for external observations and overrides without implementing AI map ingestion now.

## 3. First milestone: Organic Maps end-to-end spike

Start from a pinned Organic Maps source revision and run its real data pipeline. Prefer a reproducible experimental fork/checkout and a small patch set over copying unexplained source fragments. Do not commit generated regional binaries or large extracts into this repository.

Organic Maps compiles OSM into regional `.mwm` packages containing geometry and information for rendering, spatial lookup, search, and routing. Its routing means finding paths through the network, not generating ranked recreational loops. Its generator is C++, orchestrated with Python. Its native core and format are candidates for reuse, not settled browser dependencies.

### 3.1 Reproduce a regional build

1. Obtain an OSM PBF extract covering Kings Beach and enough surrounding trails for useful loops; include the California/Nevada border area where needed.
2. Record source URL, extraction timestamp, checksum, boundary polygon, upstream revision, commands, and dependency versions.
3. Build the Organic Maps generator and produce a regional `.mwm` using its documented pipeline.
4. Verify the package with compatible tooling/app versions and reproduce basic point-to-point routing.
5. Record build duration, temporary disk use, package size, and the minimal inputs required.

### 3.2 Audit retained information

Trace representative OSM ways, nodes, and relevant relations through preprocessing, encoded sections, and runtime readers. Produce a table with: source tags, transformed representation, accessible runtime value, losses, and relevant source locations.

Audit at least:

- General access, motor vehicles, motorcars, motorcycles, bicycles, pedestrians, and horses.
- E-bike-specific access where present; do not assume a single universally populated tag or equivalence with bicycle access.
- Conditional/directional access, barriers, turn restrictions, and inherited access defaults.
- Highway/path classification, track type, surface, smoothness, width, incline, hiking/MTB difficulty, and steps.
- Cycleway separation attributes where available; distinguish inferred separation from explicit evidence.
- OSM IDs, way-to-segment correspondence, raw tags, and source/version information.
- Connectivity and cross-region routing behavior.

Report preserved, transformed, inferred, and discarded information separately. Lack of an explicit access tag must not silently become a claim of verified permission or prohibition.

### 3.3 Make one real modification

Choose a relevant attribute the audit identifies as missing or inaccessible. Carry it from OSM through generation and read it back on individual segments. If all priority attributes are retained, expose one through the browser adapter instead.

Compare extending an existing section, adding a custom section, and writing a companion attribute file. Test how segments join back to source ways and what happens when a way is split. Keep geometry, graph, and attribute data version-aligned.

### 3.4 Prove browser consumption

Demonstrate reading actual generated regional data in a browser worker and querying geometry, connectivity, and relevant attributes. Investigate the minimum native-to-WebAssembly boundary and demonstrate local point-to-point routing through it if reusing their runtime. If using an exported graph instead, prove the browser can route on that export.

Measure load time, memory, storage size, routing latency, and cancellation behavior. Test at least one desktop browser and the intended phone browser early; document the target devices instead of inventing a performance budget without measurements.

### 3.5 Decision gate

Choose and document one approach with working evidence:

1. Reuse Organic Maps generation and format, extending it as needed.
2. Reuse useful preprocessing but emit a browser-oriented package.
3. Build a smaller dedicated preparation pipeline if adaptation costs exceed the benefit.

Deliverables: reproducible build instructions, retention audit, modification proof, browser proof, benchmark results, license/dependency inventory, and a short architecture decision. A native `.mwm` build alone does not complete this spike.

## 4. Product behavior

### Search inputs

- Hiking or gravel-bike profile, with editable preferences rather than fixed global policy.
- Start point, defaultable to current location, plus a start-radius option.
- Distance range; distance matters more than estimated duration initially.
- Loop, out-and-back, or point-to-point shape preference; destination when needed.
- Optional intermediate waypoints to constrain regeneration.
- Preference weights for car exposure, motorcycle access, bicycle/e-bike access, fire roads versus singletrack, surface, and other retained attributes.

Avoid cars by default, primarily for physical separation rather than merely low traffic. Short road connectors can still appear, visibly annotated. Hiking preferences can avoid bikes/e-bikes; bicycle routing must distinguish the user's own travel access from preferences about other users. Equestrian sharing is generally acceptable. Steepness and other trail qualities matter but are secondary to the initial access concerns.

Most quality preferences are soft and proportional to exposure, not categorical exclusions. A short stair section or car connector should not automatically erase an otherwise useful route. Separately represent travel feasibility, closures/private access, and lawful access for the selected mode; do not turn a preference penalty into permission to traverse an explicitly prohibited segment. For biking, represent legitimate walking/dismount connectors where supported.

### Results and map

- Generate an initial batch targeting at least 20 distinct options where the network supports it. Do not fabricate diversity or pad with duplicates when fewer exist.
- Desktop split view: scrollable, sortable results table plus map.
- Selecting a row centers/fits its route on the map.
- Numeric columns rather than English summaries such as “mostly fire roads.” Include distance, elevation gain when available, and distance/percentage breakdowns of relevant attributes.
- Attribute-driven segment coloring with a legend. Start with one selected attribute at a time so overlapping permissions do not require an unreadable color scheme.
- Selecting a statistic highlights its contributing segments. Clicking a segment shows raw evidence and interpreted values.
- Add waypoints and regenerate. Exact subsection locking and freehand route editing are deferred.
- Flexible-start search begins with an explicit radius. Viewport-driven discovery and trailhead anchoring are later experiments; usable public entrances must eventually be distinguished from arbitrary graph nodes.

### Statistics semantics

- Percentages use total traveled route distance, counting repeated traversal. Also retain unique segment distance for repetition/diversity analysis.
- Separate attributes can overlap: motorcycle and bicycle permission percentages do not form a partition.
- Within one attribute, expose permitted, prohibited, restricted/conditional, and unknown/unresolved coverage as appropriate.
- Distinguish explicit tags, rule-derived interpretations, and unknowns. “0% known motorcycle-permitted” does not mean “100% verified motorcycle-free.”
- Legal permission is not observed traffic. Physical separation is not the same as motor-vehicle prohibition. Store and display these as distinct concepts.
- Preserve measured values internally; use consistent numerical rounding in the UI without implying greater source certainty.

## 5. Domain model

Define schemas and terminology before implementation-specific storage. Use `Schema.Struct` plus interfaces for records, branded constrained scalars for IDs and units, and tagged unions for meaningful states. Avoid general-purpose domain classes; Effect service tags and typed errors are narrow framework exceptions where appropriate.

Suggested concepts:

- `RegionId`, `RegionVersion`, `DatasetId`, `SourceId`, `RouteId`, `SearchId`, `OverlayId`.
- `OsmWayId` / node / relation IDs as distinct validated string identities, not interchangeable arbitrary strings.
- Version-qualified `SegmentId` and `NodeId`; source IDs alone do not uniquely identify split graph edges or guarantee stability across updates.
- `Meters`, `ElevationMeters`, distance fractions, coordinates, and validated geographic bounds. Convert to display units at the UI boundary.
- `RegionManifest`: bounds, source timestamp, schema/format version, component hashes/sizes, attribution, and compatible runtime information.
- `TrailSegment`: directed traversal connectivity, geometry reference, source references, retained attributes, and interpreted mode-specific access.
- `AttributeEvidence`: raw value, source, explicit versus inferred interpretation, and unresolved conditions. Avoid arbitrary confidence scores presented as facts.
- `SearchRequest`: anchors/waypoints, distance range, shape, profile, preferences, candidate budget, and deterministic seed for reproduction.
- `RouteCandidate`: ordered traversals, anchors, metrics, score breakdown, dataset version, and generation parameters.
- `SavedRoute`: preserved geometry and statistics snapshot plus graph/source references and request, so a map update does not silently destroy the saved trip.
- Future `OverlayRecord`: source-backed observation or override, geometric/source linkage, and precedence. Overlays win when deliberately applied; unresolved links/conflicts remain inspectable.

Retain original tags for relevant routable ways and associated nodes/relations where practical, alongside compact normalized search attributes. Quantify the storage cost during the spike. Raw tag retention must not require scanning JSON strings inside the search hot path.

## 6. Service-oriented architecture with Effect v4

Sketch leaf contracts first, then write higher-level orchestration against them with small fixture Layers. Implement production adapters afterward. Services are in-process boundaries, not network microservices.

| Boundary | Responsibility |
| --- | --- |
| `RegionCatalog` | List/import region manifests and report installed versions |
| `RegionStore` | Download/import, verify, activate, and remove regional packages |
| `TrailNetwork` | Query topology, geometry, source attributes, and spatial indexes |
| `AccessInterpreter` | Resolve raw access evidence for a mode/context while retaining uncertainty |
| `RouteSearch` | Generate candidate paths using graph access and a search request |
| `RouteAnalysis` | Compute metrics, preference costs, and diversity measurements |
| `PersonalData` | Save routes, preferences, and eventually overlay records |
| `BackupTransfer` | Versioned export/import of personal data, independent of map downloads |
| `Location` | Scoped browser geolocation subscription and its availability/errors |

Keep deterministic scoring, distance aggregation, and graph algorithms as plain functions where effects provide no benefit. Do not introduce one service per utility. Map rendering is an adapter, with MapLibre or another renderer evaluated against the chosen package rather than assumed compatible with `.mwm`.

Effect conventions:

- `Context.Service` contracts, unique identifiers, `Layer.effect`, `Service.of`, and named `Effect.fn` operations.
- Acquire dependencies in Layers; public service methods should not leak implementation dependency requirements.
- Compose named, explicit Layer graphs at browser, worker, and build-tool entry points. Reuse Layer instances for shared resources.
- Use schemas to validate package manifests, worker messages, imported backups, and persisted records.
- Typed failures for invalid packages, incompatible versions, unavailable regions, quota failures, corrupt personal data, and search failures.
- Scope workers/listeners/resources; interruption must cancel obsolete searches and release resources. Ignore stale results by search identity as well.
- Keep heavy parsing/search in workers. Use coarse-grained/batched graph access so a WASM or worker boundary is not crossed per edge unnecessarily.
- Keep upstream C++/Python tooling behind adapters; using Effect for orchestration does not require rewriting useful native code into TypeScript.
- Follow the service-oriented article's design principles, but check examples against pinned v4 APIs and prefer Struct/interface data models over its class-heavy examples.

## 7. Candidate generation and ranking

Start with explainable algorithms before AI ranking. Preserve the ability to change heuristics without changing the persistence or UI model.

1. Resolve the search area and feasible start anchors.
2. Generate candidates using multiple intermediate anchors, directions, and preference-weight variations. Combine point-to-point searches into loops and out-and-back routes; compare algorithms using the actual local graph.
3. Honor required waypoints and traversal connectivity.
4. Compute distance-weighted attribute exposure and distance-range deviation.
5. Penalize undesirable exposure, unresolved access as configured, gratuitous repetition, and implausible connectors.
6. Deduplicate by edge overlap/geometric similarity, not merely identical geometry strings.
7. Rank with a diversity-aware selection step so twenty minor variants do not crowd out different outings.
8. Return metrics and score components alongside geometry and retain a reproducible request/seed.

Ordinary out-and-back travel is valid. Reject pathological tiny back-and-forth oscillations used to manufacture distance. Search budgets should bound runtime and memory; report fewer candidates honestly when necessary. Incremental result streaming is not required initially.

Use soft distance/quality ranking when reasonable candidates miss a requested range, and expose the actual result values. Keep network validity and supported traversal semantics distinct from these quality preferences.

## 8. Offline packages and personal-data durability

A logical regional package contains whatever the chosen approach needs for map display, graph traversal, spatial indexes, detailed attributes, source/version metadata, and optionally elevation. These may be separate physical files under one manifest.

- Region downloads are large-area downloads, not just route corridors. Start small for development, then measure a useful Tahoe region and larger Northern California coverage.
- Do not promise Organic Maps-like sizes before measuring our retained data and display format.
- Decide cross-region stitching during the format spike. For initial single-region searches, return an explicit coverage limitation instead of silently routing across missing data.
- Use checksums and staged activation so interrupted updates cannot mix graph and attribute versions. Keep the previous valid version until activation succeeds.
- Cache the app shell for offline launch; bundle required styles, fonts, icons, and map assets so rendering does not secretly depend on network requests.
- Evaluate IndexedDB and OPFS for working storage on actual target browsers. Handle storage estimates, quota errors, and persistent-storage requests; persistence permission is not a backup guarantee.
- Keep personal records in a separate store and schema version from regional assets.
- Ship a full personal-data archive export/import with a tested restore path before treating saved routes as durable. GPX export is an interoperability feature, not a complete backup.
- Explore writing backups to a user-selected file/directory where browser support permits. Explicit downloadable backups are the portable baseline; cross-device syncing is deferred.

### Open question: offline basemap source and package

The current MapLibre basemap uses OpenTopoMap's public raster tile service online; only our OSM routing graph is bundled for offline use. Do **not** interpret OpenTopoMap's CC-BY-SA reuse license as blanket permission to bulk-download its hosted tiles. Its [usage notes](https://opentopomap.org/about) caution against mass downloads and provide no service guarantee. The [OSM standard tile policy](https://operations.osmfoundation.org/policies/tiles/) explicitly forbids offline prefetching from `tile.openstreetmap.org`. Provider-hosted tiles, OSM source extracts, and self-generated tiles have different rights and operational constraints.

Preferred experiment: take one versioned OSM extract spanning the CA/NV test area; derive both the routing graph and a MapLibre-compatible vector basemap archive (evaluate PMTiles) from that snapshot. Source elevation/DEM separately if contours or hillshade are needed. Bundle or download the style, fonts, icons, and attributions, not just tile geometry. First prove local serving and a fully offline Kings Beach browser reload, measure bytes/build cost/render quality and retained routing evidence, then decide on downloadable Tahoe packages. Alternative: obtain explicit permission and offline terms from a tile provider rather than self-generating. Evaluate packaging, checksums, browser storage and update behavior against the region manifest above. Organic Maps `.mwm` remains a separate native-format candidate, not a MapLibre tile archive or an integrated browser renderer.

Phone following needs only the highlighted route, current location, and a follow-location toggle. No turn-by-turn navigation, rerouting, or background tracking requirement. Begin as an installable web app; consider a native wrapper only if measured browser limitations justify it.

## 9. Future external data

Keep this seam, but defer ingestion implementation:

- Separate externally sourced observations/overrides from the OSM base.
- Resolve an effective merged view for display and routing, with deliberate overrides taking precedence.
- Retain source and conflict information; most conflict handling can happen during ingestion.
- Re-link or flag overrides on region updates rather than silently applying them to the wrong segment.
- Later accept park PDFs, screenshots, photographed signs, or other maps; AI may help georeference and extract annotations into a documented schema.
- Validate one actual source before designing a universal importer. No Downloads scraping is needed for the initial work.

## 10. Licensing

- Organic Maps' main source license is Apache 2.0: forking/modification and proprietary application use are permitted, subject to applicable license/notice and modification requirements when distributing. Audit bundled dependency licenses separately.
- OSM data is ODbL: preserve attribution and applicable database license/share-alike obligations. Public use/distribution of adapted databases can trigger obligations; a custom graph or binary format does not remove them.
- Keep code licensing and dataset licensing distinct in the package manifest and documentation.
- External maps require appropriate reuse rights; public availability or AI extraction does not supply permission. Separate overlays are useful architecture but do not automatically determine their legal status.
- Personal experimentation does not require publishing private changes. Revisit precise distribution obligations before publishing packages or incorporated third-party data.

## 11. Implementation sequence and acceptance

### M0 — Pipeline and browser feasibility

Complete Section 3 and choose a supported architecture. Include a small representative OSM fixture and source-to-output retention checks. Establish device-specific performance targets from measured results.

### M1 — Domain contracts and offline vertical slice

Define schemas, service interfaces, fixture Layers, and a production region adapter. Import a region, render it, inspect segment evidence, and calculate a local A-to-B path in a worker. Reload offline and repeat. Verify version mismatch, interrupted import, and missing-region handling.

### M2 — Useful automatic route search

Generate and analyze candidates without depending on a polished UI. Validate Kings Beach hiking and gravel requests, then Marin/SF contrast cases. Target 20+ distinct candidates where feasible. Check continuity, waypoint satisfaction, reproducible statistics, non-pathological repetition, and preference sensitivity. Manually review whether the options are actually worth taking.

### M3 — Table/map planning interface

Add editable search controls, sortable numeric results, selected-route map fitting, attribute coloring, segment inspection, and waypoint regeneration. Confirm that each highlighted statistic agrees with the underlying traversals. Evaluate with the original CalTopo/Overpass task.

### M4 — Saved routes, backup, and phone following

Add personal persistence, full archive export/import, GPX export, offline phone launch, location display, and follow-location toggle. Restore an archive into a fresh profile and verify its contents. Confirm saved routes remain viewable after replacing/deleting a regional package.

### M5 — Larger regions and tuning

Measure package size, memory, import/update behavior, and candidate-search latency on broader geography. Address region seams, calibrate ranking/diversity, and validate mobile storage limits. Tune based on observed routes rather than elaborate speculative weights.

Testing focuses on meaningful invariants: access interpretation and unknowns, source preservation, graph connectivity, distance/statistic arithmetic, diversity/repetition, storage restoration, and actual offline operation. Use deterministic seeds and small synthetic graphs for algorithm edge cases, plus real regional benchmarks and human review. Avoid tests that only mirror implementation details.

## 12. Deferred scope and unresolved technical choices

Deferred: accounts/social features, ride history, exact segment locking, full manual drawing, AI route ranking, external-map ingestion, turn-by-turn navigation, background tracking, and synchronized multi-device storage.

Resolve through implementation evidence rather than more preference interviews:

- Organic Maps reuse versus exported/custom format, and the practical WASM boundary.
- Map renderer and offline vector representation.
- Regional storage backend and portable backup UX.
- Which source attributes are sufficiently complete locally, especially e-bike access and physical separation.
- Elevation source and storage/resolution tradeoffs.
- Search algorithm, similarity thresholds, runtime budget, and weight calibration.
- Flexible-start anchor selection beyond an explicit radius.

## References

- Service-driven development: https://www.effect.solutions/services-and-layers
- Organic Maps source: https://github.com/organicmaps/organicmaps
- Generator documentation: https://github.com/organicmaps/organicmaps/blob/master/tools/python/maps_generator/README.md
- Code structure: https://github.com/organicmaps/organicmaps/blob/master/docs/STRUCTURE.md
- Main source license: https://github.com/organicmaps/organicmaps/blob/master/LICENSE
- OSM data license/attribution: https://www.openstreetmap.org/copyright

Upstream links are discovery references. Pin revisions and verify claims during M0; the attribute-retention audit and browser integration have not yet been performed.
