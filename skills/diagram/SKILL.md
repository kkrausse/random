---
name: diagram
description: Dataflow / architecture diagrams from one small .js file of nodes and edges; the file says where boxes go (rows), lines are routed automatically, a static viewer page live-updates, `bun dg.ts` type-checks, lints and renders a PNG in ~1–3 s. Use for any boxes-and-arrows / architecture / dataflow diagram (replaces the excalidraw skill).
---

# diagram

Spec (what this must do): `SPEC.md`. Example: gaze-lab `doc/arch/x20b/arch.js` (three model architectures).

## Write
A diagram is one plain `.js` file of global calls, with no imports and no coordinates:

```js
title("tiny example: image → gaze");          // the browser tab reads "diagram: <title>"; be specific
diagram("tiny", {
  sub: "one line under the title",
  weights: { enc: "blue", head: "lime" },   // op colour = whose weights; also the legend
  nodes: [
    I("img", "INPUT: image 512 × 176", "blue"),
    O("enc", "encoder", "enc"),
    D("f", "features 361 × 1024", { tok: [[1, "gray", "cls"], [352, "#adb5bd", "patches", 8]] }),
    G("hd", "HEAD", [O("lin", "Linear 1024 → 2", "head"), D("out", "gaze (x, y)", { out: true })]),
  ],
  edges: ["img>enc>f>lin>out", E("f", "lin", "readout row", { ink: "red" })],
  rows: [["img"], ["enc"], ["f"], ["hd"]],     // where the top-level boxes go (G takes rows too)
});
```

- **Data nodes:** `D` is data (dotted border), `I` is a model input (thick dotted border), `P` is a learned tensor.
- **Ops and groups:** `O` is a transformation (solid box, coloured by `weights[w]`). `G` is an outline: `{ deck: true }` draws stacked cards.
- **Edges:** an edge is `E(from, to, label, { ink, sw })` or a chain string `"a>b>c"`.
- **Group style:** `G(id, title, kids, { fill, ink, sw })` tints the background and draws a solid border (e.g. a "context frames" lane).
- **Placement (you decide it):** the diagram and every group take `rows`: ids of their DIRECT contents, rows top to bottom, each row left to right. An array inside a row is a column (stacked, centred); an array inside that is a row again. So `rows: [["a", ["b", "c"], "d"], ["e"]]` puts a, then b over c, then d side by side, and e below. Rows are centred and top-aligned; `gap: [x, y]` sets the spacing (default 50, 70). Without `rows`, contents go one row per step of flow, in file order: fine for a first look, but write rows for anything you show. `dg.ts` names ids that are missing, doubled or not directly inside. Lines are routed afterwards (libavoid), so you never place a line: around boxes and group titles, into and out of a group only through its border, and around groups neither end is in. A box whose tokens receive lines (`"x0@aux"`) draws its squares at the top so the arrows land on them. Put what feeds something above it (otherwise `dg.ts` reports "flows upward").
- **Abstractions (overview, then definitions beside it):** draw a part as one box, `O(id, "TRUNK BLOCK i", "trunk", { def: "TRUNK BLOCK i" })`, and define it as its own `diagram("TRUNK BLOCK i", { titleSize: 70, … })`. In the definition, name every input `I(…, { port: "x" })` and every output `D(…, { out: true, port: "y" })`. Label each edge into the box with an input name (each exactly once) and each edge out with an output name. `dg.ts` checks all of it. The box gets a double border and "⧉ defined in: …".
- **Comparisons:** to show how a part differs from something else (e.g. the original block), draw that something beside it with `{ ref: true }` on its boxes. They are faded and skipped by the input/output and flow checks. Mark each difference with ≠ in the labels.
- **Into tokens (no CONCAT boxes):** an edge can end on part of a data box's token strip: `E(a, "x0@aux")` lands on the segment whose caption starts with "aux", and `"x0@cls..patches"` lands on a span of segments. Use it to show what makes up a sequence instead of drawing a CONCAT / BUILD box.
- **Left / right:** `rows` decides it. Optionally mark parts `side: "left"` / `side: "right"` (on a box, or a G for everything inside) and `dg.ts` reports any marked box placed on the wrong side.
- **Links:** `links: [L(a, b, "SAME WEIGHTS")]` draws a dashed line that carries no data.
- **Several diagrams:** call `diagram` several times to put them side by side.
- **Title:** one `title("…")` per file names the page (browser tab `diagram: …`). Say specifically what it shows; `dg.ts` flags a missing one.
- **Types:** everything is typed in `dg.d.ts`.

## Check (run after every edit)
`bun ~/devfs/repos/kkrausse/random/skills/diagram/dg.ts <file.js> [--only <title>] [--focus <id>] [--scale s] [--pub <slug>]`

It prints the type errors and lint, then writes a PNG and prints its path; Read the PNG to look at it.
- `--focus <id>` renders an 1800 × 1300 crop at 1:1.
- **Lint:** unknown or duplicate ids, ops with no input edge, data from nowhere, dead ends (mark real outputs `{ out: true }`), rows problems, lines through boxes, two lines sharing a track, overlaps, upward flow (receiver wholly above sender), lines over 90 chars.
- `--pub <slug>` publishes the file's folder and prints the viewer link, `…/artifacts/diagram/?s=../<slug>/<file.js>`.
- `bun dg.ts --lib` republishes the viewer itself. Do this after changing `index.html` or `core.js`. `--lib <slug>` publishes a trial viewer elsewhere; `--pub <slug> --viewer <that slug>` links a diagram to it.
- `avoid.js` is libavoid-js (the line router) as a classic script with its wasm inlined, so the viewer works on file://. Rebuild it with `bun build-avoid.ts` after updating the package.

## View
`index.html?s=<diagram.js>` (file:// or hosted). It re-runs the file every 2 s and redraws on change. It also reloads itself when `core.js` is republished (hosted), so open pages never run old viewer code.
- **Navigate:** wheel pans, Ctrl+wheel zooms, F fits.
- **Select:** click or drag to select, Shift adds. ⌘C copies `id kind "label" ← inputs → outputs` lines.
- **Feedback:** dragging a box or group moves it, and N adds a note. "copy feedback" gives the agent lines like `move k.cp by (+900, −300): wanted right of k.tb`, which the agent turns into `rows` changes.

## Changing the viewer (index.html / core.js)
Run `node test/viewer.mjs "file://$PWD/index.html?s=file:///home/kkrausse/devfs/repos/kkrausse/gaze-lab-merge/doc/arch/x20b/arch.js&only=x9b"`
and get every check passing before `bun dg.ts --lib`. It covers bugs the user hit: lines following boxes,
nested and multi-select moves, the selection outline, empty group insides, text highlight and reset.
