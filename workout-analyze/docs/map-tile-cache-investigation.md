# Map tiles for repeat and offline viewing (2026-09-22)

## Current behavior and permission boundary

The web and mobile maps currently request Esri World Topographic raster tiles directly from `server.arcgisonline.com`. Normal browser/WKWebView HTTP caching can help repeated views; we have not yet measured its hit rate on the phone. The shared route projection retains a surrounding viewport for interactive panning. Static mobile route cards now render only tiles intersecting their initial 320 × 190 viewport instead of fetching that entire surrounding region.

Do **not** build a persistent Esri tile cache or prefetch ride corridors from that URL. [ArcGIS Online's offline documentation](https://doc.arcgis.com/en/arcgis-online/manage-data/take-maps-offline.htm#ESRI_SECTION1_C0331D55CAE14D4FAB1B54354A9246F2) permits taking ArcGIS tiles offline with supporting Esri software, but explicitly prohibits systematically requesting tiles for offline use through other apps/services. Its offline map-area workflow is not a grant to scrape the public raster endpoint from this WKWebView app. [OSMF's tile policy](https://operations.osmfoundation.org/policies/tiles/) requires HTTP-header-compliant caching of tiles actually viewed but expressly forbids offline packs/prefetch from `tile.openstreetmap.org`; that endpoint was also serving blocked images during this investigation.

## Bounded implementation path

1. First instrument a real repeated workout/segment browse on iPhone: count tile URLs, response/cache status and bytes for cold and warm opens, plus device storage use. Do not count every SVG `<image>` as a network miss. Measure the actual 31-route archive and a few long rides.
2. For **repeat viewing**, retain ordinary WebKit HTTP caching under the provider's response headers; if it is insufficient, choose a provider whose written terms permit a disk-backed on-demand cache. Cache only tiles the user actually viewed, key by provider/style/z/x/y, obey freshness/ETag and attribution, cap at e.g. 100 MiB with LRU eviction, and expose usage/clear controls. The quota is a starting budget, not a measured requirement.
3. For **offline**, choose a separately licensed or self-hosted OSM-derived tile source with explicit offline packaging rights (or generate our own from appropriately licensed source data). Offer an explicit ride/region and zoom-range selection, estimate tile count and byte cost before download, enforce a small per-pack and total device quota, allow removal/update, and provide an offline fallback when a tile is absent. Preserve attribution and any data/style licenses. Never copy Esri/OSMF public raster tiles into that pack.
4. Keep tiles in a separate evictable cache/container, never in `analysis.duckdb`, `analysis-native.duckdb`, or the recorder SQLite journal. Validate airplane-mode rendering and a warm repeat on the physical phone before claiming offline support.

This is a provider/licensing and measurement decision, not an implemented offline feature.
