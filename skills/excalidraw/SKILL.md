---
name: Excalidraw
description: Edit .excalidraw diagram files through their compact .excs text sibling — dump/build/check/preview via exc.mjs, with the file-bridge page live-syncing edits onto the canvas. Use for reading, editing, or restructuring Excalidraw scenes without touching raw scene JSON.
---

# Excalidraw (.excs file workflow)

Never read or edit .excalidraw JSON directly — work through the `.excs`
projection: one line per element (~60x smaller), z-order = line order.

All scripts live in this skill's `scripts/` directory (referred to as `$S` below).

## New diagrams: write a scene script (diagram.js)

For a diagram you are authoring (architecture figures, flows, anything with structure), do not place elements by
coordinates. Write a scene in JavaScript with `site/diagram.js`; it lays the figure out.

```bash
$S/new-diagram.sh <dir>     # index.html, app.js, diagram.js, excs.js, cli.js + a starter scene.js
```

`<dir>` is a complete static page with no build: `index.html` imports `scene.js` in the browser and shows it in a
read-only, pan-and-zoom Excalidraw (loaded from esm.sh). You only edit `scene.js`; reload to see it. Publish the
folder as it is (`deploy-artifact.sh <dir> <slug>`). `?scene=other.js` shows another scene file in the same folder.

- **Model:** `lanes([...])` gives named columns; `g.row({ lane: node, "a:c": spanning node })` adds a row. Boxes size
  to their text, a lane to its widest cell, a row to its tallest. `box`, `label`, `squares` (token strips), `row` /
  `col` (small groups), `panel`, `plus`; `g.band(r0, r1, { label })` frames rows. `arrow(R(a), L(b), { label, via })`
  connects nodes after layout; `under: true` passes behind filled boxes. End with `export default render(g.node())`.
  The full API with types is the comment block at the top of `site/diagram.js`; `site/scene.js` is a worked example.
- **Detail is cheap:** adding a row or a lane re-lays everything out. Put the detail in the main figure (one lane per
  repeated thing, a spanning box where things meet) instead of side panels.
- **Several figures on one canvas:** `export default [[figA, figB], [figC]]` (rows of figures).
- **Check before showing:** `bunx tsc --noEmit --allowJs --checkJs --target es2022 --module esnext --moduleResolution bundler --strict <dir>/scene.js`
  (the files carry their types in comments; nothing is compiled), then render and look at it:
  `bun <dir>/cli.js > /tmp/x.excalidraw && node $S/export.mjs /tmp/x.excalidraw -o /tmp/x` gives a PNG for your own check.
- `bun <dir>/cli.js > name.excalidraw` also gives the canvas as a normal Excalidraw file (to commit, or to open and edit by hand).

The sections below are for existing `.excalidraw` files and canvases the user edits by hand.

## Read a scene

```bash
node $S/exc.mjs dump scene.excalidraw          # compact text to stdout
```

## Edit a scene

1. If a `.excs` sibling exists and the user has the bridge tab open, edit the
   `.excs` directly with normal file edits. The bridge imports it within ~1s,
   re-measures text with the real engine, writes the `.excalidraw`, and
   rewrites the `.excs` normalized. Done.
2. Otherwise: `dump -o scene.excs`, edit, then
   `node $S/exc.mjs build scene.excs -o scene.excalidraw`.
   Build estimates text sizes; the bridge self-heals them on next load.

**Always after editing**: `node $S/exc.mjs check scene.excalidraw` — validates
binding/backref invariants, box overlaps, and counts arrow crossings.
`node $S/exc.mjs preview scene.excalidraw` renders an approximate wireframe
PNG (macOS qlmanage) to eyeball layout without a browser.

Real export (SVG with embedded fonts + 2x PNG, faithful render):
`node $S/export.mjs scene.excalidraw [-o outBase] [--scale 2]` — needs Chrome
installed; `npm i` in `$S` once for playwright-core.
Keep `scripts/package.json` free of `"type":"module"`: `excs.js` is a classic
script shared with the bridge page, and `exc.mjs` loads it via `require`.

## Rules

- `.excalidraw` is the source of truth; `.excs` is an ephemeral projection the
  bridge regenerates after every sync. Never rebuild from a stale `.excs`.
- The user may edit the canvas concurrently — on conflict the scene file wins.
- Format reference is the header comment in `scripts/excs.js` (grammar, keys,
  flags, elided defaults). Bound text folds into its container's line; images
  and freedraw pass through as `json` lines.
- Layout hygiene: order rows/boxes so arrows fan out without crossing; aim for
  `check` reporting 0 crossings unless the user drew them.

## The bridge page

`excalidraw-file-sync.html` (open via file:// in Chrome, grant a folder once).
When handing the user a link, always include both params:
`?file=<file name>&root=<absolute path of the folder holding it>`. The user
usually grants a parent folder once; the page maps `root` + `file` onto
whichever granted ancestor matches by name, so the link works from any folder
above the file. `root` also seeds the copy-absolute-path button. The folder's
file list is sorted newest first.
Folder-opened scenes get the `.excs` sibling automatically; single-file mode
does not. If the user reports edits not appearing, ask them to check the
bridge tab's footer for a `.excs error` message — a parse error leaves the
canvas untouched.

## Version control

Commit the `.excalidraw` only and gitignore `*.excs` — the sibling is a
deterministic projection the bridge regenerates, and a committed copy can go
stale. Raw JSON diffs are noise (every save regenerates nonces and re-measures
text), so diff through the dumper. Once per repo:

```bash
echo '*.excalidraw diff=excs' >> .gitattributes
echo '*.excs' >> .gitignore
git config diff.excs.textconv "node $S/exc.mjs dump"   # absolute path to $S
```

`git diff`, `git log -p`, and `git show` then print the compact form. These
diffs are read-only and cannot be applied as patches.

## Legacy

`scripts/scene-{inspect,export,upload}.js` are the old browser-control payload
scripts for driving an excalidraw.com tab. Prefer the file workflow; use these
only when the user explicitly wants to work with a non-bridge tab.
