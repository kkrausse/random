# Handoff

## Current State

- The read-only source library is configured by `mediaRoot`.
- Reproducible generated media goes under `derivedRoot`; durable project state goes under the separate `savedProjectsRoot`.
- `derivedRoot` is explicitly disposable and must be safe to wipe at any time; see `README.md`.
- All 123 source clips have fresh metadata, thumbnails, and 1080p H.264 proxies.
- The library also discovers 849 Sony `.ARW` photos and has fresh metadata/JPEG thumbnails for them without modifying the RAW originals.
- The viewer can switch between Proxy and Original playback.
- The library grid supports arrow keys, Home/End, roving focus, and selected-state semantics.
- The viewer provides on-demand Gyroflow previews and normalized crop controls.
- Single clips can be exported from Original media with the active stabilization and crop state.
- Versioned projects persist atomically under `savedProjectsRoot` with revision-safe autosave.
- Projects have durable output width, height, and FPS settings; item crops are locked to the project frame aspect ratio.
- The timeline supports duplicate source use, selection, removal, drag/button reordering, per-item crop/stabilization, video trim, and photo duration.
- Selected videos show a yellow source-duration trim window over the viewer with draggable in/out handles, buffered extent, and a live playhead.
- Whole-timeline preview sequences trimmed videos and timed photos with hard cuts.
- Project export renders Original videos and photos to normalized H.264/yuv420p output under `derivedRoot/exports/projects`.

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

The UI overlays the kept rectangle. Timeline-item crops drag to move and use four corner handles to resize while staying locked to the project frame aspect ratio, with a five-percent minimum dimension. It works identically over direct Proxy, direct Original, or stabilized preview output. Crop is applied during export.

## Export

`POST /api/media/export` accepts `{ id, stabilize, crop }`, always reads Original media, and writes a persistent H.264 file under `<derivedRoot>/exports`. If stabilization is active, its full-resolution Gyroflow output is temporary and removed after the final FFmpeg crop/encode. Re-exporting the same source atomically replaces its previous export.

Technical export validation passed on two clips: an unstabilized 50% crop of 3840x2160 `C0356.MP4` produced 1920x1080 H.264/AAC, and a stabilized 80% crop of `C0345.MP4` produced 3072x1728 H.264/AAC with no temporary work file left behind. The current export milestone is accepted.

## Projects And Timeline

The implemented project model is:

```ts
type Project = {
  version: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  settings: {
    width: number;
    height: number;
    fps: number;
  };
  items: TimelineItem[];
};

type VideoTimelineItem = {
  id: string;
  mediaId: string;
  kind: "video";
  sourceIn: number;
  sourceOut: number;
  stabilize: boolean;
  crop?: NormalizedCrop;
};

type PhotoTimelineItem = {
  id: string;
  mediaId: string;
  kind: "photo";
  photoDuration: number;
  stabilize: boolean; // Currently ignored for photos; the UI stores false.
  crop?: NormalizedCrop;
};

type TimelineItem = VideoTimelineItem | PhotoTimelineItem;
```

Project state stores source references and user intent, not copied source media or generated files.

### Current Scope

- Timeline playback and export use hard cuts only. Crossfades are deliberately deferred.
- Project movie exports preserve trimmed source audio as stereo 48 kHz AAC. Photos and source videos without audio receive frame-aligned silence so all normalized segments concatenate coherently.
- Stabilized timeline previews wait for their temporary Gyroflow result instead of first playing and restarting the direct source.
- Startup retains `.work` itself and retries removal of stale children because removing the open SMB directory can fail with `EBUSY`.

### Validation

A separate `Milestone Validation` project (`909ef024-d12a-4ef1-a027-42497a48070c`) was created without modifying the existing user project. It contains trimmed `C0339.MP4`, `KEV05154.ARW` at 1.5 seconds, and trimmed `C0337.MP4` in reordered sequence. Reading revision 2 back through the API exactly matched the saved project.

Project export completed from Original media with coherent audio. FFprobe reported H.264 at 1920x1080, 30 fps, with duration 4.033333 seconds, plus stereo AAC at 48 kHz with duration 4.054667 seconds (the AAC frame boundary accounts for the small overrun). FFmpeg detected 1.565896 seconds of silence across the 1.5-second photo interval and non-silent source audio on both sides. The 4,412,820-byte export was served with `X-Video-Editor-Audio: aac`, and its job directory was removed after atomic publication.

The scan-version-5 library backfill completed across all 972 assets: 972 generated, 0 metadata-only updates, 0 already fresh, and 0 failures.

Browser interaction still needs a final human visual pass for the yellow trim handles, crop manipulation, photo timing, sequence preview, and responsive layout.

## Next Steps

1. Perform that browser interaction pass and fix any interaction-specific issues found.
2. Include audio in the final human playback pass and confirm cut synchronization by ear.
3. Add optional crossfades only after hard-cut editing and audio behavior are accepted.

## Verification

These currently pass:

```text
bun test (12 tests)
bun run typecheck
bun run build
```

An unrelated `.video-editor.config.json.swp` may exist in the worktree. Do not add, edit, or delete it.
