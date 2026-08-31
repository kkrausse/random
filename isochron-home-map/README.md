# From Arguello

A static, responsive isochrone map centered on Arguello Market in San Francisco. It uses MapLibre with OpenFreeMap tiles and Valhalla's public demo routing endpoint for walking, cycling, transit, and driving travel-time contours. Hovering a contour reports its travel time and the straight-line distance from the market; the map can zoom from street level out past all of California.

## Run locally

Serve the directory with any static server, for example:

```sh
python3 -m http.server 4173
```

Then open `http://localhost:4173`. No build step or API key is required.

The public Valhalla endpoint is intended for demos and fair use. For production traffic, self-host Valhalla or replace `API` in `app.js` with a supported routing provider. When the routing endpoint is unavailable, the interface displays clearly labeled estimated reach contours.
