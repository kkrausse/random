# Local Video Editor

## Storage Rules

`video-editor.config.json` defines the only two storage roots:

- `mediaRoot` is read-only input. The application must never create, modify, or delete files there.
- `derivedRoot` is the destination for every file the application creates, including metadata, thumbnails, proxies, temporary processing output, exports, and future project state.

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
```

`proxy.mp4` is the reusable playback cache. Stabilization is performed on demand from either the proxy or original and its `.work` output is deleted after use; stabilized media is not a persistent cache.

Disposable rendered media should remain distinguishable from future persistent project state. Do not assume the entire `derivedRoot` can be deleted once project persistence is implemented.

The current configured destination is:

```text
/Volumes/Photos/iphone-uploads/video-editor-project/derived
```

Before adding a new processing or export path, verify that its output resolves inside `derivedRoot`.
