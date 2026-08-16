# Handoff

## Current State

- The read-only source library is configured by `mediaRoot`.
- Every created file goes under the configured `derivedRoot`; see `README.md`.
- All 123 source clips have fresh metadata, thumbnails, and 1080p H.264 proxies.
- The viewer can switch between Proxy and Original playback.
- The library grid supports arrow keys, Home/End, roving focus, and selected-state semantics.
- The viewer provides on-demand Gyroflow previews and normalized crop controls.

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

The UI overlays the kept rectangle. Dragging moves it and eight edge/corner handles resize it, with a five-percent minimum dimension. It works identically over direct Proxy, direct Original, or stabilized preview output. Crop is not yet applied to an export.

## Next Steps

1. Visually validate corrected stabilization on a representative longer Sony clip in both Proxy and Original output modes.
2. Fix any Gyroflow default smoothing or zoom settings based on that validation.
3. Implement full-resolution single-clip export from Original using the same stabilization and crop state.
4. Keep generated output inside `derivedRoot`; never write beside Original media.

## Verification

These currently pass:

```text
bun run typecheck
bun run build
```

An unrelated `.video-editor.config.json.swp` may exist in the worktree. Do not add, edit, or delete it.
