---
name: excalidraw
description: Draw a diagram as one small HTML file whose script calls a published library that renders it in regular Excalidraw. Use for architecture/flow diagrams; the user's "copy for LLM" pastes back one line per element with ids.
---

# Excalidraw diagram = one HTML file

Write this file, publish it with `deploy-artifact.sh <file>.html <slug>`, give the link:

```html
<!doctype html><meta charset="utf-8"><title>my diagram</title>
<script type="module">
import { draw, box, text, row, col, arrow } from "https://raspberrypi.guineafowl-truck.ts.net/artifacts/excalidraw-lib/x.js";

const layer = (i) => row(40, box(`sa${i}`, `self-attention ${i}`, { bg: "blue" }), box(`ff${i}`, `feed-forward ${i}`));

draw([
  col(50, box("fz", "FROZEN blocks 1 – 12", { bg: "gray" }), layer(1), layer(2)),
  arrow("fz", "sa1", "361 × 1024"), arrow("sa1", "ff1"),
]);
</script>
```

API (all of it):
- `box(id, text, { bg, ink, dashed, sw, fs, w, h, shape, left })`: sized to its text; `shape`: "ellipse" | "diamond".
- `text(id, s, { fs, ink })`
- `row(gap, ...nodes)`, `col(gap, ...nodes)`; or `row({ gap, align: "start" | "end" }, ...)`.
- `arrow(fromId, toId, label, { ink, dashed, sw, elbow })`: bound to both ends.
- `draw(items)`: top-level items stack down the page.
- Colours by name: bg blue green yellow red orange violet gray pink teal; ink blue green red orange violet gray.
- Abstraction is plain JS functions.

Give every element a meaningful id. The user's "copy for LLM" (button, or Ctrl/Cmd+Shift+C) pastes lines like
`fz rectangle 0,0 420x70 #e9ecef "FROZEN blocks 1 – 12"` and `fz>sa1 arrow fz -> sa1 "361 × 1024"`; `*` marks
elements they drew by hand. Find the id in the script and change it there.

See your own output: `google-chrome --headless=new --virtual-time-budget=20000 --window-size=1400,1000
--screenshot=out.png <published link>`, then read out.png.

The library is `lib/x.js` here. After changing it: `deploy-artifact.sh lib excalidraw-lib`.
