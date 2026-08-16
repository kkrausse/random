# Handoff

## Current State

- The read-only source library is configured by `mediaRoot`.
- Reproducible generated media goes under `derivedRoot`; durable project state goes under the separate `savedProjectsRoot`.
- `derivedRoot` is explicitly disposable and must be safe to wipe at any time; see `README.md`.
- All 123 source clips have fresh metadata, thumbnails, and 1080p H.264 proxies.
- The viewer can switch between Proxy and Original playback.
- The library grid supports arrow keys, Home/End, roving focus, and selected-state semantics.
- The viewer provides on-demand Gyroflow previews and normalized crop controls.
- Single clips can be exported from Original media with the active stabilization and crop state.

## Gyroflow

The App Store Gyroflow binary is sandboxed and cannot read the SMB source headlessly. A separate non-sandboxed Homebrew build is installed at:

```text
~/Applications/Gyroflow CLI/Gyroflow.app/Contents/MacOS/gyroflow
```

Override it with `GYROFLOW_PATH` if needed.

Sony metadata is the critical constraint. The FFmpeg proxy does not retain Sony lens, IBIS, and per-frame gyro metadata. The attempted approach of using proxy pixels with the Original passed as `--gyro-file` produced worse stabilization: Gyroflow selected the generic `opencv_fisheye` model and discarded Sony per-frame offsets.

The corrected behavior is:

```text
Proxy preview mode:
Original + complete Sony metadata -> Gyroflow -> temporary 1920x1080 H.264 preview

Original preview mode:
Original + complete Sony metadata -> Gyroflow -> temporary full-resolution H.264 preview
```

Proxy mode therefore describes preview output quality, not Gyroflow input pixels.

Stabilized output is not cached. Jobs write to `<derivedRoot>/.work/<uuid>.mp4`, are served with range support, and are deleted when the UI changes pipeline settings or disables stabilization. The work directory is cleared when the server starts.

The corrected Proxy endpoint has been validated on `C0345.MP4`: it returned a range-streamable 1920x1080 H.264/AAC file. Stabilization quality still needs visual validation on a representative longer clip.

## API

```text
POST /api/media/stabilize
Content-Type: application/json

{"id":"C0345.MP4","source":"proxy"}
```

The response contains `workId` and `url`. Temporary output is available through `GET /api/media/work?id=<workId>` and removed through `DELETE /api/media/work?id=<workId>`.

The POST currently waits for Gyroflow to finish. A future improvement could expose job progress, but do not introduce a persistent stabilized-media cache.

## Crop

Crop is normalized semantic state:

```ts
type NormalizedCrop = {
  x: number;
  y: number;
  width: number;
  height: number;
};
```

The UI overlays the kept rectangle. Dragging moves it and eight edge/corner handles resize it, with a five-percent minimum dimension. It works identically over direct Proxy, direct Original, or stabilized preview output. Crop is applied during export.

## Export

`POST /api/media/export` accepts `{ id, stabilize, crop }`, always reads Original media, and writes a persistent H.264 file under `<derivedRoot>/exports`. If stabilization is active, its full-resolution Gyroflow output is temporary and removed after the final FFmpeg crop/encode. Re-exporting the same source atomically replaces its previous export.

Technical export validation passed on two clips: an unstabilized 50% crop of 3840x2160 `C0356.MP4` produced 1920x1080 H.264/AAC, and a stabilized 80% crop of `C0345.MP4` produced 3072x1728 H.264/AAC with no temporary work file left behind. The current export milestone is accepted.

## Next Milestone: Projects And Timeline

Implement this milestone end-to-end in one run. Do not stop after adding only project CRUD or a static timeline.

### Storage

- Persist project JSON atomically under `savedProjectsRoot`, never under `derivedRoot`.
- Add list/create/read/update/delete project APIs with path containment and input validation.
- Autosave edits and restore them after a server/browser restart.
- Treat everything under `derivedRoot`, including project movie exports, as reproducible and disposable.

### Project Model

Start with a versioned model along these lines and adjust only where implementation requires it:

```ts
type Project = {
  version: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  items: TimelineItem[];
};

type TimelineItem = {
  id: string;
  mediaId: string;
  kind: "video" | "photo";
  sourceIn?: number;
  sourceOut?: number;
  photoDuration?: number;
  stabilize: boolean;
  crop?: NormalizedCrop;
  transitionAfter?: "none" | "crossfade";
};
```

Project state stores source references and user intent, not copied source media or generated files.

### Media And Editing

- Extend the read-only library to discover supported photos as well as videos, with generated thumbnails/metadata under `derivedRoot`.
- Add selected videos or photos from the library to the active project timeline.
- Snapshot or edit crop/stabilization state per timeline item rather than keeping it only as viewer-global state.
- Support ordered timeline items, drag reordering, selection, removal, and duplicate use of the same source.
- Support video in/out trimming with bounded handles and a useful time readout.
- Support configurable still-photo duration.
- Support hard cuts and a simple optional crossfade between adjacent items. Avoid a generalized effects system.

### UI

- Build a functional iMovie-style workspace using the existing visual language: source library, central viewer, and horizontal timeline along the bottom.
- Add new/open/rename/delete project controls without turning the page into a dashboard.
- Keep desktop and mobile usable. Basic styling is sufficient; interaction correctness matters more.
- Timeline selection should drive the viewer. Playback should advance through timeline items in order, respecting trims and photo durations closely enough for editing preview.

### Project Export

- Export the assembled timeline from Original source media, never proxies.
- Apply each item's stabilization, crop, trim, photo duration, ordering, and transition.
- Use temporary intermediates only under `derivedRoot/.work` and clean them on success, failure, or cancellation.
- Write the final movie under `derivedRoot/exports/projects`; saved project JSON must remain valid if all of `derivedRoot` is deleted.
- Reuse the configured Homebrew FFmpeg path and existing Gyroflow constraints.

### Acceptance

Create a project containing at least two trimmed videos and one photo, reorder the items, set a photo duration and one crossfade, reload to prove persistence, preview the sequence, and export a playable H.264/AAC movie. Then run `bun run typecheck` and `bun run build`, update this handoff with exact validation results, and commit the completed milestone.

## Verification

These currently pass:

```text
bun run typecheck
bun run build
```

An unrelated `.video-editor.config.json.swp` may exist in the worktree. Do not add, edit, or delete it.
