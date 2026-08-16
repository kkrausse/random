# Local Video Editor

## Storage Rules

`video-editor.config.json` defines three non-overlapping storage roots:

- `mediaRoot` is read-only input. The application must never create, modify, or delete files there.
- `derivedRoot` contains generated and reproducible files: metadata, thumbnails, proxies, temporary processing output, and exports.
- `savedProjectsRoot` contains durable user-authored project state and must never be placed inside `derivedRoot`.

`ffmpegPath` pins the FFmpeg toolchain used for both scan/backfill and export. It currently points to the Homebrew build because that build provides the required `libx264` encoder; `FFMPEG_PATH` can deliberately override it. `ffprobe` is resolved beside the selected FFmpeg unless `FFPROBE_PATH` is set.

There is no fallback output under the repository. Generated media must resolve inside `derivedRoot`; saved project files must resolve inside `savedProjectsRoot`.

**The entire `derivedRoot` is disposable and must be safe to wipe at any time.** The application can regenerate scans, thumbnails, and proxies from read-only source media. Temporary work and exports may be lost. No project definition, timeline edit, trim, crop, stabilization choice, photo duration, transition, or other user-authored state may be stored there.

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

Single-clip exports are reusable full-resolution H.264 renders created from Original media, but they remain disposable. Any stabilization is rendered to `.work` first, then the selected normalized crop is applied during the final encode.

The current configured destinations are:

```text
derivedRoot:       /Volumes/Photos/iphone-uploads/video-editor-project/derived
savedProjectsRoot: /Volumes/Photos/iphone-uploads/video-editor-project/projects
```

Before adding a write path, classify its contents first. Reproducible output belongs under `derivedRoot`; durable user intent belongs under `savedProjectsRoot`.
