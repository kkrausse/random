# TODO

## Next

- Preview crop entirely in the browser while keeping the viewer at the project frame aspect ratio. Crop edits must not render or invalidate stabilized media.
- Cache stabilized previews by source, playback quality, source freshness, and stabilization settings. Stabilization is the expensive reusable result.
- Support dragging media from the library into the timeline in addition to the existing button and double-click actions.
- Preserve existing item crops when project output dimensions change. Mark incompatible crops in red and let the user reset or reframe them explicitly.
- Make preview framing match export framing when an item has no stored crop.

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
