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
    <temporary-preview>.mp4
    <project-export-job-id>/
      <temporary segments and final>
  .preview-cache/
    <stabilized-preview-hash>.mp4
  exports/
    <media-id-without-extension>-export.mp4
    projects/
      <project-id>.mp4
```

`proxy.mp4` is the reusable playback cache. Stabilization is performed on demand from the original so Sony metadata remains available, then cached at proxy or original output quality under `.preview-cache`. Crop is applied in the browser and does not invalidate or duplicate stabilized media.

The library discovers videos and still photos. Sony `.ARW` dimensions and JPEG thumbnails are generated with macOS `sips`; RAW originals remain untouched and are converted only into disposable job-local JPEGs when rendering a project.

Single-clip exports are reusable full-resolution H.264 renders created from Original media, but they remain disposable. Any stabilization is rendered to `.work` first, then the selected normalized crop is applied during the final encode.

Project exports are created with `POST /api/projects/:id/export` and served with `GET` or `HEAD` on the same URL. They use Original media, hard cuts, project dimensions/fps, H.264/yuv420p, and stereo 48 kHz AAC. Trimmed source audio is preserved, while photos and source videos without audio receive matching silence so every normalized segment can be concatenated coherently. Export job directories are always removed, and only the atomically published `exports/projects/<project-id>.mp4` remains.

Project JSON is versioned and stores ordered timeline items plus project-wide output width, height, and FPS. Each item owns its trim or photo duration, stabilization choice, and normalized crop. The editor locks item crops to the project frame aspect ratio and autosaves project revisions under `savedProjectsRoot`.

The current configured destinations are:

```text
derivedRoot:       /Volumes/Photos/iphone-uploads/video-editor-project/derived
savedProjectsRoot: /Volumes/Photos/iphone-uploads/video-editor-project/projects
```

Before adding a write path, classify its contents first. Reproducible output belongs under `derivedRoot`; durable user intent belongs under `savedProjectsRoot`.
