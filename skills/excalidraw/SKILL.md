---
name: excalidraw
description: Draw anything Excalidraw can draw from a small JavaScript file; a shell page in this skill renders it in regular Excalidraw and live-updates when the file changes (file:// or hosted). Ctrl/Cmd+C on the canvas copies one line per element with ids, for pasting back.
---

# Excalidraw diagram = one .js file

Write `diagram.js` (one `draw()` call; helpers inside the function, so the file can run again):

```js
draw(() => {
  const layer = (i) => row(40, box(`sa${i}`, `self-attention ${i}`, { bg: "blue" }), box(`ff${i}`, `feed-forward ${i}`, { bg: "orange", fill: "hachure" }));
  return [
    col(50, box("fz", "FROZEN blocks 1 – 12", { bg: "gray", font: "hand" }), layer(1), layer(2)),
    arrow("fz", "sa1", "361 × 1024"), arrow("sa1", "ff1", "", { end: "triangle", round: true }),
  ];
}, { title: "my diagram" });
```

Show it with the shell `index.html` in this skill, `?s=` = the diagram (relative to the shell, or a full URL):
- local: `file://<this skill dir>/index.html?s=file:///abs/path/diagram.js`
- hosted: `deploy-artifact.sh <folder with diagram.js and its images> <slug>`, then give
  `https://raspberrypi.guineafowl-truck.ts.net/artifacts/excalidraw-lib/?s=../<slug>/diagram.js`

Live: the page re-runs the file every 5 s and on tab focus and redraws in place when the result changed (view, zoom
and hand-drawn shapes stay); top right shows "updated <time>" or the error. Editing the file (or republishing it) is
all it takes.

Shapes (each sizes itself to its text unless given w, h):
- `box(id, text, style)`, `ellipse(id, text, style)`, `diamond(id, text, style)`, `text(id, s, style)`
- `line(id, [[x, y], ...], style + { closed })`: points relative to the line; `closed` = fillable polygon; `round` curves it
- `pen(id, [[x, y], ...], style)`: a freehand stroke
- `image(id, url, { w, h })`: PNG/JPG/SVG/GIF, path relative to the diagram file (works on file:// too)
- `embed(id, url, { w, h })`: a live web page or video (YouTube, Figma, any https URL)
- `file(url)`: an existing `.excalidraw` file, shown as it is (hosted only: file:// pages cannot read it)

Layout: `row(gap, ...nodes)`, `col(gap, ...nodes)` (or `row({ gap, align: "start" | "center" | "end" }, ...)`),
`at(x, y, node)` fixed position, `frame(id, name, node)` named Excalidraw frame, `group(id, node)`.
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

Page: `draw(fn, { title, dark, grid, bg })`. `fn` may be async (it is awaited), e.g. to run a layout engine such as
ELK (`await import("https://esm.sh/elkjs@0.11.0/lib/elk.bundled.js")`) before returning the items.

Give every element a meaningful id. Ctrl/Cmd+C on the canvas copies the selection (or everything) as lines like
`fz rectangle 0,0 420x70 #e9ecef "FROZEN blocks 1 – 12"` and `fz>sa1 arrow fz -> sa1 "361 × 1024"`; `*` marks
elements drawn by hand (those persist across reloads). Ctrl/Cmd+Shift+C is Excalidraw's own copy. Find the id in the
script and change it there.

Examples: `examples/everything.js` (every feature), `examples/flamingo.js`. The library is `lib/x.js` (a classic
script, so it loads from file://; `x.js` at the root re-exports it for older HTML diagrams that `import` it). After
changing it or the shell, publish this whole skill folder:
`deploy-artifact.sh <this skill dir> excalidraw-lib`.
