# Local Video Editor — Design / Implementation Spec

## 1. Goal

Build a **local-first, simplified iMovie-like video editor** with one major constraint:

> Original media stays where it already lives, including on a mounted SMB share. The editor references originals in place and never requires importing/copying the entire media library.

The app should eventually support:

- Browse a configured media library
- Preview clips using downsampled proxies
- Gyroflow stabilization
- Crop/reframe clips
- Drag clips into a project timeline
- Trim clips
- Rearrange clips
- Preview the complete movie
- Export the complete movie from the **original full-resolution sources**

Audio tracks are explicitly deferred until after the basic editor works.

---

## 2. Core architecture

Everything runs locally on the Mac.

```text
Browser UI
   │
   │ localhost
   ▼
Bun / TypeScript server
   │
   ├── filesystem access
   ├── ffprobe
   ├── FFmpeg
   ├── Gyroflow CLI
   ├── proxy/cache generation
   ├── project persistence
   └── final rendering
   │
   ▼
Mounted filesystem
   ├── originals, probably SMB
   └── derived data, local or SMB
```

The browser does not access SMB directly.

The Bun server sees the SMB mount as a normal filesystem path such as:

```text
/Volumes/Videos
```

---

## 3. Technology

Single package. No monorepo/package separation.

```text
video-editor/
  package.json
  tsconfig.json

  frontend/
    routes/
    components/
    editor/

  server/
    media/
    ffmpeg/
    gyroflow/
    export/
    persistence/

  lib/
    config.ts
    types.ts
    paths.ts
    media.ts
```

Stack:

- **Bun**
- **TypeScript everywhere**
- **React**
- **Vite**
- **TanStack Start / TanStack Router**
  - mainly for routing and typed client/server functions
- **Tailwind CSS**
- **shadcn/ui**
- **FFmpeg / ffprobe**
- **Gyroflow CLI**
- Filesystem + JSON persistence initially
- **No database initially**

---

## 4. Fundamental data model

There are three distinct concepts:

```text
MediaAsset
ProjectClip
Project
```

### MediaAsset

A physical source video.

```ts
type MediaAsset = {
  id: string
  filename: string
  relativePath: string

  metadata?: {
    width: number
    height: number
    fps: number
    duration: number
    codec?: string
    mtimeMs: number
  }
}
```

For now:

```ts
id = filename
```

That's sufficient for the first version.

We can migrate later to:

- relative path
- path + size
- partial hash
- content hash
- camera metadata

No need to solve that now.

### ProjectClip

An editable **instance** of a MediaAsset.

```ts
type ProjectClip = {
  id: string
  mediaId: string

  sourceIn?: number
  sourceOut?: number

  stabilization: StabilizationSettings
  crop?: NormalizedCrop
}
```

This distinction matters because the same source can appear multiple times in one project with different edits.

### Crop

Use normalized coordinates rather than pixels:

```ts
type NormalizedCrop = {
  x: number
  y: number
  width: number
  height: number
}
```

All values are `0..1`.

Example:

```ts
{
  x: 0.1,
  y: 0.05,
  width: 0.8,
  height: 0.9
}
```

This makes the crop independent of whether we're viewing a 1080p proxy or rendering a 4K original.

### Stabilization

Initially:

```ts
type StabilizationSettings = {
  enabled: boolean
}
```

Later:

```ts
type StabilizationSettings = {
  enabled: boolean
  smoothness?: number
  horizonLock?: boolean
  cropMode?: string
}
```

V0 should use fixed Gyroflow defaults.

### Project

Initially the timeline can simply be an ordered array.

```ts
type Project = {
  id: string
  name: string
  clips: ProjectClip[]
  createdAt: string
  updatedAt: string
}
```

`project.clips` order is timeline order.

No tracks or complicated graph yet.

---

## 5. Configuration

Initially hardcoded or a simple config file.

```ts
type AppConfig = {
  mediaRoot: string
  derivedRoot: string
  projectRoot: string

  proxy: {
    maxHeight: number
    codec: "h264"
    crf: number
    audioCodec: "aac"
  }

  export: {
    codec: "h264"
    quality: number
  }
}
```

Example:

```ts
{
  mediaRoot: "/Volumes/Videos",
  derivedRoot: "/Volumes/VideoDerived",
  projectRoot: "./projects",

  proxy: {
    maxHeight: 1080,
    codec: "h264",
    crf: 22,
    audioCodec: "aac"
  },

  export: {
    codec: "h264",
    quality: 18
  }
}
```

Both originals **and derived files may live on SMB**.

We should not assume derived data needs to be on the Mac SSD.

---

## 6. Filesystem model

Originals:

```text
/Volumes/Videos/
  A001.MP4
  A002.MP4
  A003.MP4
```

Derived:

```text
/Volumes/VideoDerived/
  A001.MP4/
    info.json
    proxy.mp4
    thumbnail.jpg

    stabilized/
      <settings-hash>.mp4

  A002.MP4/
    info.json
    proxy.mp4
    thumbnail.jpg
```

Everything under `derivedRoot` is disposable.

Deleting it should be equivalent to regenerating cache, not losing project data.

---

## 7. Rendering model

A clip is effectively a recipe.

```text
source video
   ↓
select time range
   ↓
Gyro stabilization
   ↓
crop / reframe
   ↓
output scaling / FPS normalization if needed
   ↓
encode
```

The project stores the recipe.

It does **not** store rendered videos as canonical state.

---

## 8. Preview vs final render

The same semantic edit is executed in two modes.

```text
                 ProjectClip
                      │
         ┌────────────┴────────────┐
         │                         │
      PREVIEW                    EXPORT
         │                         │
      proxy                     original
      1080p                     full res
      fast                      high quality
         │                         │
         └──── same settings ──────┘
```

Example:

```ts
renderClip(clip, {
  mode: "preview"
})
```

versus:

```ts
renderClip(clip, {
  mode: "final"
})
```

This distinction should exist conceptually even if implementation initially uses separate FFmpeg/Gyroflow commands.

---

## 9. Proxy strategy

Default proxy:

```text
H.264
1080p max height
same source FPS
AAC audio
```

Never upscale.

Example:

```text
3840 × 2160 HEVC 10-bit
        ↓
1920 × 1080 H.264 proxy
```

If source is 1280 × 720, leave it at 720p.

Proxy generation should preserve source FPS:

```text
23.976 → 23.976
24     → 24
29.97  → 29.97
59.94  → 59.94
```

We don't need a concept of **project FPS** until multiple clips are being combined.

---

## 10. Milestones

### Milestone 0 — Source discovery

This should be extremely small.

#### Features

Server:

- Reads `mediaRoot`
- Finds supported video files
- Returns filenames
- Optionally runs `ffprobe` lazily

UI:

```text
Library

A001.MP4
A002.MP4
A003.MP4
A004.MP4
```

#### Explicitly not included

- proxy
- video player
- thumbnail
- stabilization
- crop
- project
- timeline
- export

#### Acceptance criteria

Opening the application shows videos that physically exist in `mediaRoot`.

No video data is copied.

---

### Milestone 1 — Proxy + viewer

Click a source video.

```text
Library
──────────────────

A001.MP4
A002.MP4  ← selected
A003.MP4

Viewer
──────────────────

┌─────────────────────────┐
│                         │
│         VIDEO           │
│                         │
└─────────────────────────┘

▶  00:04 / 00:32
```

Server checks:

```text
derived/A002.MP4/proxy.mp4
```

If missing or stale:

```text
original
   ↓
FFmpeg
   ↓
proxy.mp4
```

Then serve proxy to browser.

Also generate `info.json`.

Example:

```json
{
  "source": "A002.MP4",
  "sourceMtimeMs": 1786838823234,
  "width": 3840,
  "height": 2160,
  "fps": 23.976,
  "duration": 32.17
}
```

#### Acceptance criteria

A large 4K source residing only on SMB can:

1. be discovered
2. generate a proxy
3. play smoothly in the browser

This proves:

```text
SMB source → server → derived cache → browser
```

---

### Milestone 2 — Gyroflow stabilization

Add:

```text
[ ] Stabilize
```

When enabled:

```text
source/proxy
   ↓
Gyroflow CLI
   ↓
stabilized proxy
```

Cache result:

```text
derived/A001.MP4/
  stabilized/
    <settings-hash>.mp4
```

For the first implementation, use fixed stabilization settings.

No sliders needed yet.

#### Important

Stabilization is represented as data:

```ts
{
  enabled: true
}
```

The stabilized video is merely a cache.

#### Acceptance criteria

Toggling stabilization causes the viewer to show a visibly stabilized version of the same clip.

---

### Milestone 3 — Crop / reframe

Add crop interaction.

```text
┌────────────────────────────────┐
│                                │
│      ┌──────────────────┐      │
│      │                  │      │
│      │    kept area     │      │
│      │                  │      │
│      └──────────────────┘      │
│                                │
└────────────────────────────────┘
```

State:

```ts
{
  crop: {
    x: 0.1,
    y: 0.1,
    width: 0.8,
    height: 0.8
  }
}
```

Do **not** generate a cropped proxy every time the user moves the rectangle.

Just display the crop/reframe in the browser.

The actual render will apply the crop later.

---

### Milestone 4 — Full-resolution single-clip export

This is the first major architecture validation.

UI:

```text
[ Export Full Resolution ]
```

Given:

```ts
{
  mediaId: "A001.MP4",

  stabilization: {
    enabled: true
  },

  crop: {
    x: 0.12,
    y: 0.06,
    width: 0.76,
    height: 0.86
  }
}
```

Server does:

```text
ORIGINAL A001.MP4
       ↓
Gyroflow
       ↓
crop
       ↓
high-quality encode
       ↓
A001-export.mp4
```

The proxy is **not** used as final source material.

#### Acceptance criteria

The exported full-resolution file:

- is stabilized like the preview
- matches the selected framing
- comes from the original media
- does not require copying the original into the app

At this point the basic media pipeline is proven.

---

### Milestone 5 — Projects

Now introduce project persistence.

```text
projects/
  my-trip.json
```

Example:

```json
{
  "id": "my-trip",
  "name": "My Trip",
  "clips": []
}
```

The application evolves into:

```text
┌─────────────────────────────────────────┐
│ Library                                 │
│                                         │
│ [A001] [A002] [A003] [A004]            │
├─────────────────────────────────────────┤
│                                         │
│               Viewer                    │
│                                         │
├─────────────────────────────────────────┤
│ Timeline                                │
│                                         │
│                                         │
└─────────────────────────────────────────┘
```

Allow dragging a library clip into the timeline.

Each insertion creates a **new ProjectClip**.

---

### Milestone 6 — Per-project clip editing

Selecting a timeline clip lets the existing viewer edit that specific `ProjectClip`.

Crop and stabilization now belong to the project clip instance, not the source asset.

The same source can appear twice with different edits.

---

### Milestone 7 — Trimming

Add:

```ts
sourceIn: number
sourceOut: number
```

Timeline UI can initially be simple:

```text
       <────────────>
───────[============]────────
        ^          ^
       IN         OUT
```

Dragging ends changes:

```ts
clip.sourceIn
clip.sourceOut
```

Nothing gets rendered merely because the trim changed.

No razor tool needed.

---

### Milestone 8 — Reordering

Timeline is just an ordered array.

```ts
project.clips
```

Dragging:

```text
[A][B][C]
```

into:

```text
[C][A][B]
```

simply changes the array order.

No media needs regeneration.

---

### Milestone 9 — Whole-movie preview

Pressing Play should preview the complete timeline in order, respecting:

- trim
- crop
- stabilization
- ordering

Hard cuts only.

No transitions yet.

Implementation options:

#### Option A — browser sequencing

Play proxy segment A, then B, then C.

#### Option B — generated preview movie

Server renders/caches:

```text
project-preview.mp4
```

Any relevant project edit invalidates it.

#### Option C — server-side segmented preview

More sophisticated later.

The **Project model must not depend on which preview implementation we choose**.

Start simple and switch if playback feels bad.

---

## 11. Project settings

Once we're combining heterogeneous clips, add:

```ts
type ProjectSettings = {
  width: number
  height: number
  fps: number
}
```

Example:

```ts
{
  width: 3840,
  height: 2160,
  fps: 29.97
}
```

Then 24fps, 60fps, and 29.97fps source clips all render onto the project timebase.

This does **not** need to exist during the single-source milestones.

---

### Milestone 10 — Full movie export

The renderer traverses:

```ts
project.clips
```

For each clip:

```text
resolve original
   ↓
seek / trim source
   ↓
stabilization
   ↓
crop/reframe
   ↓
normalize resolution/FPS
   ↓
render segment
```

Then:

```text
segment 1
segment 2
segment 3
segment 4
   ↓
concatenate
   ↓
final movie.mp4
```

For the first implementation, temporary intermediates are completely acceptable:

```text
/tmp/export-123/
  001.mp4
  002.mp4
  003.mp4
```

Then concatenate.

Optimize into a more clever FFmpeg graph only if there's an actual performance reason.

---

## 12. Final basic UI

Target approximately:

```text
┌───────────────────────────────────────────────────────┐
│ Library                                               │
│                                                       │
│ [A001] [A002] [A003] [A004] [A005]                  │
├───────────────────────────────────────────────────────┤
│                                                       │
│                       VIDEO                           │
│                                                       │
│                                                       │
│  Stabilize [x]                    Crop / Reframe      │
│                                                       │
├───────────────────────────────────────────────────────┤
│ Timeline                                              │
│                                                       │
│ [ A003 ][       A001       ][ A006 ][     A002     ] │
│                         ▲                             │
│                      playhead                         │
└───────────────────────────────────────────────────────┘
```

The timeline should initially just be normal React DOM.

Conceptually:

```ts
clipWidth = clipDuration * pixelsPerSecond
```

No special timeline framework required.

---

## 13. Cache rules

### Changing crop

Should **not** regenerate the source proxy.

Should **not** regenerate the stabilized proxy.

Crop is `ProjectClip` state and cheap to preview.

### Changing stabilization

Should invalidate/rebuild the stabilized proxy, but not the source proxy.

### Changing trim

Regenerates nothing immediately.

It's just:

```ts
sourceIn
sourceOut
```

### Reordering clips

Regenerates nothing at asset level.

It may invalidate `project-preview.mp4` if we use a rendered project preview.

### Deleting derivedRoot

Should be safe.

The app should simply regenerate proxies, thumbnails, stabilized previews, and later waveforms.

---

## 14. Server responsibilities

The server owns:

- Scan `mediaRoot`
- Resolve source paths
- Run ffprobe
- Generate proxies
- Generate thumbnails
- Run Gyroflow CLI
- Cache derived media
- Serve video with HTTP range support
- Read/write project JSON
- Render project previews
- Export full-resolution clips
- Export full-resolution movies

---

## 15. Frontend responsibilities

Frontend owns:

- Library browsing
- Source selection
- Video viewer
- Crop UI
- Stabilization controls
- Project creation
- Drag source → timeline
- Timeline selection
- Trim handles
- Reordering
- Playhead
- Preview controls
- Processing status / errors

It should generally **describe desired edits**, not perform canonical rendering.

---

## 16. Important implementation rule

Do **not** make FFmpeg commands the project representation.

Bad:

```json
{
  "filterGraph": "crop=...,scale=...,concat=..."
}
```

Good:

```json
{
  "mediaId": "A001.MP4",
  "sourceIn": 4.2,
  "sourceOut": 8.7,
  "crop": {},
  "stabilization": {}
}
```

Then:

```text
semantic project model
      ↓
renderer
      ↓
FFmpeg / Gyroflow commands
```

That gives us freedom to change the rendering implementation later.

---

## 17. Initial non-goals

Do not build these yet:

- Database
- User accounts
- Cloud storage
- Collaboration
- Multiple video tracks
- Audio/music tracks
- Titles
- Transitions
- Color grading
- Plugins
- Keyframes
- Masks
- Effects framework
- Media deduplication
- Robust media relocation
- Fancy asset indexing
- Razor editing
- Background rendering infrastructure
- Distributed workers

---

## 18. After the basic editor: audio

Once this works:

```text
Library
  ↓
Timeline
  ↓
crop
trim
reorder
stabilize
  ↓
full movie preview
  ↓
full movie export
```

then add audio.

Likely next model:

```ts
type Project = {
  clips: ProjectClip[]
  audioTracks: AudioTrack[]
}
```

Features:

- music files
- waveform cache
- positioning
- trimming
- volume
- fade in/out
- original clip audio enable/disable
- eventual mixing during export

But none of this should complicate the initial video model.

---

## 19. Product invariants

These should remain true throughout development:

1. **Original media is never modified.**
2. **Original media is never implicitly copied into the application.**
3. Project state is small.
4. Derived media is disposable.
5. Preview may use proxies; final output uses originals.
6. The same source may appear multiple times with different edits.
7. Filesystem paths are the media library.
8. Project JSON describes edits semantically.
9. FFmpeg and Gyroflow are implementation details beneath the project model.
10. Deleting the entire derived cache should not lose anything important.

---

## 20. Definition of the first complete product

The basic application is complete when the user can:

1. Configure:
   - library location
   - derived-data location
2. Browse videos without importing them.
3. Preview videos via generated proxies.
4. Drag a video from the library into a project timeline.
5. Add multiple clips.
6. Select a clip and:
   - crop it
   - trim it
   - stabilize it
7. Rearrange clips by dragging.
8. Preview the entire movie.
9. Close/reopen the application and retain the project.
10. Export the complete movie at high quality using the original full-resolution source media.

At that point we have the desired **small, sane iMovie replacement**, and audio becomes the next feature family rather than something we need to account for during the initial implementation.
