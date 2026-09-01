---
name: Excalidraw
description: Edit .excalidraw diagram files through their compact .excs text sibling — dump/build/check/preview via exc.mjs, with the file-bridge page live-syncing edits onto the canvas. Use for reading, editing, or restructuring Excalidraw scenes without touching raw scene JSON.
---

# Excalidraw (.excs file workflow)

Never read or edit .excalidraw JSON directly — work through the `.excs`
projection: one line per element (~60x smaller), z-order = line order.

All scripts live in this skill's `scripts/` directory (referred to as `$S` below).

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
Folder-opened scenes get the `.excs` sibling automatically; single-file mode
does not. If the user reports edits not appearing, ask them to check the
bridge tab's footer for a `.excs error` message — a parse error leaves the
canvas untouched.

## Legacy

`scripts/scene-{inspect,export,upload}.js` are the old browser-control payload
scripts for driving an excalidraw.com tab. Prefer the file workflow; use these
only when the user explicitly wants to work with a non-bridge tab.
