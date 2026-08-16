# TODO

## Next

- Visually verify browser-only crop geometry for landscape, portrait, photo, direct video, and stabilized video playback.
- Support dragging media from the library into the timeline in addition to the existing button and double-click actions.

## Accepted For Now

- Library scanning and proxy generation remain an explicit operation rather than happening on demand.
- Editing begins after media is added to a project; there is no source-level crop, stabilization, or single-clip export workflow.
- The current trim controls are sufficient.
- Hard cuts are the only transition.
- Stabilized previews may use a persistent disposable cache under `derivedRoot`.

## Completed Validation

- Manual browser interaction and playback validation completed.
- Project export preserves source audio and inserts silence for photos or videos without audio.
- Automated tests, typecheck, and production build pass.

## Completed Work

- Crop preview is applied in the browser while the viewer keeps the cropped frame aspect ratio.
- Stabilized previews are cached independently of crop state.
- Existing item crops survive project output dimension changes; incompatible crops are marked in red.
- Items without a stored crop use the same centered framing in preview and export.
