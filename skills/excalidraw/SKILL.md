---
name: excalidraw
description: Draw diagrams as a small JavaScript script shown in regular Excalidraw (static page, no build, no server). Use for architecture/flow diagrams; the user's "copy for LLM" button pastes back a condensed line per element with ids.
---

# Excalidraw as a script

Copy `index.html`, `app.js`, `x.js` from this skill's directory into a folder, write `scene.js` next to them,
publish the folder with `deploy-artifact.sh <folder> <slug>` and give the link. Reload = see the new script.
`?s=other.js` loads another scene file from the same folder.

`scene.js` default-exports a list of nodes and arrows (see `scene.js` here):

```js
import { box, text, row, col, arrow } from "x";
const layer = (i) => row(40, box(`sa${i}`, `self-attention ${i}`, { bg: "blue" }), box(`ff${i}`, `feed-forward ${i}`));
export default [
  col(50, box("fz", "FROZEN blocks 1 – 12", { bg: "gray" }), layer(1), layer(2)),
  arrow("fz", "sa1", "361 × 1024"), arrow("sa1", "ff1"),
];
```

- `box(id, text, { bg, ink, dashed, sw, fs, w, h, shape, left })`: sized to its text. `shape`: "ellipse" | "diamond".
- `text(id, s, { fs, ink })`
- `row(gap, ...nodes)`, `col(gap, ...nodes)`; or `row({ gap, align: "start" | "end" }, ...)`.
- `arrow(fromId, toId, label, { ink, dashed, sw, elbow })`: bound to both boxes.
- Colours by name: blue green yellow red orange violet gray pink teal (bg); blue green red orange violet gray (ink).
- Top-level items stack down the page. Abstraction = plain JS functions.

Give every element a meaningful id: the user's "copy for LLM" (button, or Ctrl/Cmd+Shift+C) puts the selection on
the clipboard as `id type x,y wxh [fill] "label"` and `id arrow from -> to "label"`; elements they drew by hand are
marked `*`. Find the id in the script and change it there.

To see your own output: `google-chrome --headless=new --allow-file-access-from-files --virtual-time-budget=15000
--window-size=1400,1000 --screenshot=out.png file:///abs/folder/index.html`, then read out.png.
