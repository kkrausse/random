---
name: HTML Canvas
description: Experimental alternative to the Excalidraw skill for UI wireframes and screen-flow diagrams — screens are real HTML in <hc-frame>s on a pan/zoom canvas, and arrows are declared by ref (data-to="screen.element") and routed automatically, so the source has no coordinates. Use for app wireframes, click-through flows, or any "boxes of real UI connected by arrows" diagram; keep Excalidraw for freeform architecture sketches.
---

# HTML Canvas (screens + declared flows)

One `.html` file holds every screen as ordinary HTML plus the arrows between
them. Layout is document order and arrows are routed at render time, so you
never write a coordinate or steer an arrow. Open the file directly in a
browser, or serve it for live reload.

`$S` below is this skill's `scripts/` directory. The CLI needs `bun`.

## Workflow

```bash
bun $S/hc.ts init doc/flow.html     # scaffold (if missing) + copy html-canvas.js beside it
bun $S/hc.ts check doc/flow.html    # outline of frames/ids/flows; exits 1 on dangling refs
bun $S/hc.ts shot doc/flow.html     # doc/flow.png of the whole canvas, to look at your work
bun $S/hc.ts shot doc/flow.html --frame nearby   # doc/flow.nearby.png, one frame at ~1:1
bun $S/hc.ts serve doc/flow.html    # http://localhost:4747/flow.html, reloads on save
bun $S/hc.ts bundle doc/flow.html   # doc/flow.bundle.html, runtime inlined, for sharing
```

- **Read with `check` first.** Its outline (rows, frame ids, element ids,
  flows) is the cheap way to learn an existing file; then read only the frames
  you need to change.
- **Always after editing:** run `check`, then `shot` and look at the PNG —
  whole canvas for the flow, `--frame <id>` for any screen you changed.
  `shot` needs a Chromium-family browser (Chrome, Chromium, Brave, Edge; or
  set `CHROME=`). `--size WxH` changes the viewport.
- `html-canvas.js` next to the file is a copy of the runtime; commit it with
  the file. Re-run `init` to refresh it after the skill changes.
- Give the user the `serve` URL (or the file path) when they want to look.
  Run `serve` in the background; it does not exit.

## Format

```html
<!doctype html>
<meta charset="utf-8">
<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>  <!-- optional -->
<script src="html-canvas.js"></script>

<hc-canvas title="Camera Remote" device="phone">
  <hc-row title="Onboarding">
    <hc-frame id="welcome" title="First run">
      <div class="wf-pad wf-grow">
        <div class="wf-title">Connect your camera</div>
        <div class="wf-grow"></div>
        <button class="wf-btn wf-primary" data-to="nearby">Find camera</button>
      </div>
    </hc-frame>
    <hc-frame id="nearby" title="Cameras nearby" to="pair" label="tapped Connect">
      <div class="wf-list"><div data-id="first">ILCE-6700 <span class="wf-btn wf-sm">Connect</span></div></div>
    </hc-frame>
    <hc-note to="nearby.first">Only cameras in pairing mode show up</hc-note>
  </hc-row>
  <hc-flow from="pair" to="welcome" label="cancelled" dashed></hc-flow>
</hc-canvas>
```

**Containers**

| Element | Purpose |
|---|---|
| `<hc-canvas title device>` | Root. `device` is the default for every frame. |
| `<hc-row title>` | Left-to-right group of frames; rows stack top to bottom. |
| `<hc-col>` | Stacks frames vertically inside a row (variants of one screen). |
| `<hc-frame id title device w h>` | One screen. `id` is required and shown on the canvas so the user can refer to it. |
| `<hc-note id to>` | Blue annotation that is not UI; lives in a row like a frame. |
| `<hc-flow from to label dashed>` | An arrow declared on its own, anywhere inside the canvas. |

Devices: `phone` 390x844, `phone-sm` 375x667, `tablet` 820x1180, `desktop`
1280x800, `watch` 198x242, `none` (size to content). `w`/`h` override in px.
A frame's content box is a flex column with `overflow: hidden` and
`position: relative`, so `wf-grow` fills height and absolutely-positioned
sheets/dialogs anchor to the screen.

**Arrows** — a ref is `frameId` or `frameId.elementId`, where `elementId` is a
`data-id` inside that frame (scoped per frame, so `back` can repeat).

- From an element: `data-to="target"` on it, plus optional `data-label` and
  `data-dashed`. The source needs no id. This is the default: the arrow lives
  on the thing you tap and disappears with it.
- From a whole frame or note: `to="target"` (`label`, `dashed`) on the tag.
- Anything else (a second arrow from the same source, grouping non-tap
  transitions together): `<hc-flow>`.
- `data-to`/`to` take a comma-separated list for several targets.
- Only add `data-id` to elements that are arrow *targets* or that the user
  will want to name.

Arrows leave from the side facing the target and curve in; they do not avoid
obstacles. If one crosses something badly, reorder frames/rows so the flow
runs left-to-right or top-to-bottom rather than adding ids or offsets.

**Layout** is only document order: move a tag to move a screen. `offset="dx,dy"`
on a frame or note is a manual nudge the *user* makes by dragging its label
under `serve` (written back into the file); preserve existing offsets, do not
author them.

## Styling screens

Anything that works in HTML works in a frame. Two levels:

- **Low-fi (default):** the built-in `wf-` kit keeps screens terse and
  deliberately sketchy. Prefer it unless asked for fidelity.
- **Higher fidelity:** Tailwind utilities (the scaffold loads the browser
  build) or a `<style>` block in the file; both override the kit.

Kit classes — layout: `wf-pad` (padded column, gap 12) `wf-row` `wf-col`
`wf-grow` `wf-between` `wf-center` `wf-divider`; chrome: `wf-status`
`wf-bar` `wf-tabs` (child `wf-on` = active); text: `wf-title` `wf-h`
`wf-muted`; controls: `wf-btn` (+ `wf-primary` `wf-ghost` `wf-sm`) `wf-input`
`wf-chip` (+ `wf-on`) `wf-seg` (segmented, child `wf-on`) `wf-toggle`
(+ `wf-on`) `wf-circle`; surfaces: `wf-card` `wf-fill` `wf-list` (children
become divided rows) `wf-img` (hatched placeholder) `wf-dark`; overlays:
`wf-scrim` `wf-sheet` `wf-dialog`.

## Conventions

- A different state of a screen (sheet open, recording, error) is its own
  frame, usually in an `hc-col` under or beside the base screen.
- Things that are not UI go in `hc-note`, never inside a frame.
- Keep markup shallow and repeat-free; this file is meant to be read by a
  model for a few hundred tokens per screen.

## In the browser

Scroll pans, pinch or ctrl-scroll zooms, drag pans, `f` fits, `1` is 100%.
Clicking an element or an arrow jumps to its target. Dangling refs show in a
red box at top-left. The hud says `live` under `serve` and `static` on
`file://`, where dragged offsets are not saved.

## Limits (experimental)

No in-browser editing beyond dragging frames/notes; text and structure are
edited in the HTML. No obstacle-avoiding routing. Tailwind's browser build
needs network; the `wf-` kit does not.
