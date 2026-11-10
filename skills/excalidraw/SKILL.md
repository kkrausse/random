---
name: excalidraw
description: Draw anything Excalidraw can draw from a small JavaScript script in one HTML file; a published library renders it in regular Excalidraw. Ctrl/Cmd+C on the canvas copies one line per element with ids, for pasting back.
---

# Excalidraw diagram = one HTML file

Write this file, publish it with `deploy-artifact.sh <file>.html <slug>` (put images it uses beside it), give the link:

```html
<!doctype html><meta charset="utf-8"><title>my diagram</title>
<script type="module">
import { draw, box, ellipse, diamond, text, line, pen, image, embed, row, col, at, frame, group, file, arrow }
  from "https://raspberrypi.guineafowl-truck.ts.net/artifacts/excalidraw-lib/x.js";

const layer = (i) => row(40, box(`sa${i}`, `self-attention ${i}`, { bg: "blue" }), box(`ff${i}`, `feed-forward ${i}`, { fill: "hachure", bg: "orange" }));

draw([
  col(50, box("fz", "FROZEN blocks 1 – 12", { bg: "gray", font: "hand" }), layer(1), layer(2)),
  arrow("fz", "sa1", "361 × 1024"), arrow("sa1", "ff1", "", { end: "triangle", round: true }),
]);
</script>
```

Shapes (each sizes itself to its text unless given w, h):
- `box(id, text, style)`, `ellipse(id, text, style)`, `diamond(id, text, style)`, `text(id, s, style)`
- `line(id, [[x, y], ...], style + { closed })`: points relative to the line; `closed` makes a fillable polygon; `round` curves it
- `pen(id, [[x, y], ...], style)`: a freehand stroke
- `image(id, url, { w, h })`: PNG/JPG/SVG/GIF by URL (relative to the page)
- `embed(id, url, { w, h })`: a live web page or video (YouTube, Figma, any https URL)
- `file(url)`: an existing `.excalidraw` file, shown as it is

Layout: `row(gap, ...nodes)`, `col(gap, ...nodes)` (or `row({ gap, align: "start" | "center" | "end" }, ...)`),
`at(x, y, node)` for a fixed position, `frame(id, name, node)` for a named Excalidraw frame, `group(id, node)`.
Top-level items stack down the page. Reuse is plain JS functions.

Arrows: `arrow(from, to, label, style + { start, end, elbow, via, id })`. `from` / `to`: an element id (bound) or
`[x, y]`. Heads `start` / `end`: "arrow" "triangle" "triangle_outline" "bar" "circle" "circle_outline" "diamond"
"diamond_outline" "crowfoot_one" "crowfoot_many" "crowfoot_one_or_many" or null (default: no start, arrow end).
Straight by default; `elbow: true` right angles; `via: [[x, y], ...]` bend points (canvas coordinates); `round` curves.

Style, on everything: `bg` (fill colour), `fill` "solid" | "hachure" | "cross-hatch" | "zigzag", `ink` (stroke and
text colour), `stroke` "solid" | "dashed" | "dotted", `sw` stroke width, `rough` 0 | 1 | 2, `opacity` 0–100,
`angle` degrees, `round` corners on/off, `font` "mono" | "code" | "hand" | "sans" | "virgil" | "helvetica" | "lilita" |
"serif", `fs`, `align`, `valign`, `link`, `locked`, `group`, `w`, `h`. Colours by name (blue green yellow red orange
violet gray pink teal cyan indigo lime white black) or #hex.

Page: `draw(items, { dark, grid, bg })`.

Give every element a meaningful id. Ctrl/Cmd+C on the canvas copies the selection (or everything) as lines like
`fz rectangle 0,0 420x70 #e9ecef "FROZEN blocks 1 – 12"` and `fz>sa1 arrow fz -> sa1 "361 × 1024"`; `*` marks
elements drawn by hand (those persist across reloads). Ctrl/Cmd+Shift+C is Excalidraw's own copy. Find the id in the
script and change it there.

Every feature in one file: `examples/everything.html`. The library is `lib/x.js`; after changing it:
`deploy-artifact.sh lib excalidraw-lib`.
