# Local Video Editor

## Storage Rules

`video-editor.config.json` defines the only two storage roots:

- `mediaRoot` is read-only input. The application must never create, modify, or delete files there.
- `derivedRoot` is the destination for every file the application creates, including metadata, thumbnails, proxies, temporary processing output, exports, and future project state.

`ffmpegPath` pins the FFmpeg toolchain used for both scan/backfill and export. It currently points to the Homebrew build because that build provides the required `libx264` encoder; `FFMPEG_PATH` can deliberately override it. `ffprobe` is resolved beside the selected FFmpeg unless `FFPROBE_PATH` is set.

There is intentionally no separate project storage root and no fallback output under the repository. Code that creates a file must derive its destination from the configured `derivedRoot`.

Current per-asset layout:

```text
<derivedRoot>/
  <media-id>/
    info.json
    thumbnail.jpg
    proxy.mp4
  .work/
    <temporary-job>.mp4
  exports/
    <media-id-without-extension>-export.mp4
```

`proxy.mp4` is the reusable playback cache. Stabilization is performed on demand from either the proxy or original and its `.work` output is deleted after use; stabilized media is not a persistent cache.

Single-clip exports are persistent full-resolution H.264 renders created from Original media. Any stabilization is rendered to `.work` first, then the selected normalized crop is applied during the final encode.

Disposable rendered media should remain distinguishable from future persistent project state. Do not assume the entire `derivedRoot` can be deleted once project persistence is implemented.

The current configured destination is:

```text
/Volumes/Photos/iphone-uploads/video-editor-project/derived
```

Before adding a new processing or export path, verify that its output resolves inside `derivedRoot`.
