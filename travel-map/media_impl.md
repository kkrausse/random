# Media Pipeline Implementation Plan

## 1. Goal

Implement a simple, synchronous media pipeline for a proof-of-concept web application that imports, stores, derives, and serves photos and videos.

The application should:

- Preserve every uploaded original byte-for-byte.
- Generate lightweight browser-friendly derivatives during media insertion.
- Avoid decoding original RAW photos or camera-original videos during normal reads.
- Support Sony a6700 photo and video files.
- Store only the derivative sizes needed for the initial product:
  - Small image thumbnail
  - Medium image viewer
  - Video poster image
  - Browser-compatible video proxy
- Leave room for a large photo derivative to be generated later on demand.
- Keep processing inline and synchronous for now.
- Expose a small set of TypeScript functions for media insertion and media reads.

This document intentionally does not define queueing, distributed processing, cloud object storage, or deployment architecture.

---

## 2. Core Design

Each logical media item has:

1. One immutable original file
2. Extracted metadata stored in the database
3. One or more replaceable derived files

The original is authoritative.

Derived files are caches that may be deleted and regenerated later.

Normal browsing must never depend on decoding the original file.

---

## 3. Initial Derivative Set

### Photos

Generate two WebP derivatives during insert:

| Kind | Longest edge | Format | Suggested quality | Primary use |
|---|---:|---|---:|---|
| Thumbnail | 384 px | WebP | 74 | Grids, map popovers, timelines |
| Viewer | 2048 px | WebP | 82 | Full-screen viewing and normal browsing |

Do not generate a large photo derivative initially.

Reserve a future derivative:

| Kind | Longest edge | Format | Suggested quality | Primary use |
|---|---:|---|---:|---|
| Large | 4096 px | WebP | 84 | Zooming and high-resolution viewing |

The future large derivative may be generated on first request and then cached.

### Videos

Generate:

| Kind | Format | Suggested settings | Primary use |
|---|---|---|---|
| Poster | WebP | 960 px longest edge, quality 78 | Grid and video preview |
| Proxy | MP4 | H.264, AAC, max 1080p, fast-start | Browser playback |

The original camera file must also be retained.

---

## 4. Filesystem Layout

Use separate roots for originals and derived files.

Example:

```text
media/
├── originals/
│   └── <media-id>/
│       └── original.<ext>
└── derived/
    └── <media-id>/
        ├── thumbnail.webp
        ├── viewer.webp
        ├── poster.webp
        └── proxy.mp4
```

Only files relevant to the media type should exist.

Photo example:

```text
media/
├── originals/
│   └── 018f.../
│       └── original.ARW
└── derived/
    └── 018f.../
        ├── thumbnail.webp
        └── viewer.webp
```

Video example:

```text
media/
├── originals/
│   └── 0190.../
│       └── original.MP4
└── derived/
    └── 0190.../
        ├── poster.webp
        └── proxy.mp4
```

The database should store paths or relative object keys, not file contents.

---

## 5. Recommended Tooling

### Runtime and orchestration

Use:

- Bun
- TypeScript
- `Bun.spawn` for native media tools
- `sharp` for resizing and WebP encoding

### Image processing

Use:

- `sharp`
  - Resize normal decoded images
  - Encode WebP derivatives
  - Normalize orientation
  - Convert output to sRGB
- ExifTool
  - Extract metadata
  - Read dimensions and orientation
  - Extract embedded JPEG previews from Sony ARW files
- LibRaw tooling
  - Optional fallback for ARW files that do not contain a usable embedded preview
  - Future source for full-resolution 4096 px derivatives

Suggested system packages:

```bash
sudo apt install ffmpeg exiftool libraw-bin
```

Suggested Bun dependency:

```bash
bun add sharp
```

### Video processing

Use:

- `ffprobe`
  - Inspect container, codec, pixel format, dimensions, duration, frame rate, and audio streams
- `ffmpeg`
  - Generate poster frames
  - Transcode browser-compatible H.264 MP4 proxies
  - Normalize pixel format to `yuv420p`
  - Add `faststart` metadata for progressive playback

Do not rely on JavaScript media decoding libraries for Sony camera video.

---

## 6. Supported Input Categories

The pipeline should classify inputs into at least these categories:

```ts
type MediaKind = "photo" | "video";
```

Recommended photo inputs:

- `.arw`
- `.jpg`
- `.jpeg`
- `.png`
- `.heic`
- `.heif`
- `.webp`
- `.tif`
- `.tiff`

Recommended video inputs:

- `.mp4`
- `.mov`
- `.m4v`

File extension may assist classification, but MIME type and `ffprobe` or image metadata should be authoritative where possible.

Sony a6700 camera videos may be stored in MP4 containers while using browser-hostile codecs or pixel formats, including HEVC/H.265, 10-bit color, or 4:2:2 chroma subsampling. These must be converted to the standard video proxy.

---

## 7. Database Record Shape

The database details may remain implementation-specific, but the media pipeline should produce enough information to populate a record similar to:

```ts
type MediaRecord = {
  id: string;
  kind: "photo" | "video";

  originalFilename: string;
  originalRelativePath: string;
  originalMimeType: string | null;
  originalByteSize: number;

  width: number | null;
  height: number | null;
  durationMs: number | null;

  capturedAt: Date | null;
  latitude: number | null;
  longitude: number | null;

  thumbnailRelativePath: string | null;
  viewerRelativePath: string | null;
  posterRelativePath: string | null;
  proxyRelativePath: string | null;

  processingVersion: string;
};
```

Recommended initial processing version:

```text
media-v1
```

Increment this value when derivative dimensions, encoding quality, color handling, or video settings change.

---

## 8. Public TypeScript API

Implement a small API around insert and read operations.

### Insert

```ts
async function insertMedia(input: InsertMediaInput): Promise<MediaRecord>;
```

Suggested input:

```ts
type InsertMediaInput = {
  sourcePath: string;
  originalFilename?: string;
};
```

Responsibilities:

1. Validate that the source exists and is a regular file.
2. Generate a stable media ID.
3. Classify the file as photo or video.
4. Create the original and derived directories.
5. Copy the original file into its final immutable location.
6. Extract metadata.
7. Generate all required derivatives synchronously.
8. Persist the database record.
9. Return the completed record.
10. Clean up incomplete files if processing fails.

The database record should not be committed as fully available until all required derivatives have been created successfully.

### Read metadata

```ts
async function getMedia(id: string): Promise<MediaRecord | null>;
```

This reads only the database record.

It must not inspect or decode the original media file during normal operation.

### Resolve derivative paths

```ts
function getPhotoThumbnailPath(record: MediaRecord): string;
function getPhotoViewerPath(record: MediaRecord): string;
function getVideoPosterPath(record: MediaRecord): string;
function getVideoProxyPath(record: MediaRecord): string;
function getOriginalPath(record: MediaRecord): string;
```

These functions should validate that the requested representation is appropriate for the media type.

### Future large-photo read

Reserve an API such as:

```ts
async function getOrCreateLargePhoto(id: string): Promise<string>;
```

This is not required for the first implementation.

Future behavior:

1. Return `large.webp` immediately if it exists.
2. Otherwise decode the original.
3. Generate a 4096 px WebP.
4. Write it atomically.
5. Return the resulting path.

---

## 9. Insert Pipeline

## 9.1 Shared steps

For both photos and videos:

```text
Receive source file
    ↓
Validate input
    ↓
Generate media ID
    ↓
Create temporary working directory
    ↓
Classify media
    ↓
Copy original to temporary destination
    ↓
Extract metadata
    ↓
Generate required derivatives
    ↓
Atomically move completed files into final locations
    ↓
Insert database record
    ↓
Return completed record
```

Use a temporary directory to prevent partially generated files from appearing as completed media.

Example:

```text
media/.tmp/<media-id>/
```

On success, move or rename files into:

```text
media/originals/<media-id>/
media/derived/<media-id>/
```

Prefer atomic renames when source and destination are on the same filesystem.

---

## 9.2 Photo insert pipeline

### Step 1: Store the original

Copy the source byte-for-byte:

```text
sourcePath
    →
media/originals/<media-id>/original.<original-extension>
```

Do not recompress, rewrite, rotate, or alter the original.

### Step 2: Extract metadata

Use ExifTool with JSON output.

Extract at least:

- MIME type
- Width
- Height
- Orientation
- Capture timestamp
- GPS latitude
- GPS longitude
- Camera make
- Camera model
- Lens model, when available

Example command shape:

```bash
exiftool -json -n -MIMEType -ImageWidth -ImageHeight \
  -Orientation -DateTimeOriginal -CreateDate \
  -GPSLatitude -GPSLongitude -Make -Model -LensModel \
  input.ARW
```

`-n` requests numeric values for fields such as GPS coordinates.

### Step 3: Obtain a decodable source image

For standard image files, pass the original directly to `sharp`.

For `.ARW`:

1. Attempt to extract the embedded preview with ExifTool.
2. Inspect the preview dimensions.
3. Use the embedded preview when it is large enough for the 2048 px viewer.
4. Fall back to LibRaw when no usable preview exists.

Suggested preview extraction attempts:

```bash
exiftool -b -PreviewImage input.ARW
```

If that returns no usable data, optionally try:

```bash
exiftool -b -JpgFromRaw input.ARW
```

The implementation should validate that the extracted bytes are a decodable image rather than assuming success from command exit status alone.

A preview is considered usable when:

- It decodes successfully.
- Its longest edge is at least 2048 px.

If it is smaller than 2048 px:

- It may still be used for the thumbnail.
- Use LibRaw for the viewer derivative.

### Step 4: Generate WebP derivatives

Use `sharp`.

Required behavior:

- Apply EXIF orientation with `.rotate()`.
- Resize while preserving aspect ratio.
- Never enlarge beyond source dimensions.
- Convert to sRGB.
- Strip unnecessary metadata from the derivative.
- Write WebP.

Thumbnail settings:

```ts
{
  longestEdge: 384,
  quality: 74
}
```

Viewer settings:

```ts
{
  longestEdge: 2048,
  quality: 82
}
```

Suggested `sharp` shape:

```ts
await sharp(source)
  .rotate()
  .toColourspace("srgb")
  .resize({
    width: maxEdge,
    height: maxEdge,
    fit: "inside",
    withoutEnlargement: true,
  })
  .webp({
    quality,
    effort: 4,
  })
  .toFile(outputPath);
```

Generate both derivatives from the same decoded source where practical.

### Step 5: Validate outputs

For each generated image:

- Confirm the file exists.
- Confirm file size is greater than zero.
- Read metadata with `sharp().metadata()`.
- Confirm the output format is WebP.
- Confirm neither dimension exceeds the configured maximum.
- Confirm width and height are both positive.

---

## 9.3 Video insert pipeline

### Step 1: Store the original

Copy the input byte-for-byte:

```text
sourcePath
    →
media/originals/<media-id>/original.<original-extension>
```

### Step 2: Inspect with ffprobe

Run:

```bash
ffprobe \
  -v error \
  -show_streams \
  -show_format \
  -of json \
  input.mp4
```

Extract at least:

- Container format
- Video codec
- Video profile
- Pixel format
- Width
- Height
- Duration
- Frame rate
- Rotation metadata
- Audio codec
- Audio channel count
- Creation timestamp, when present

Store the original characteristics in the database if useful, even though the browser will normally use the proxy.

### Step 3: Generate poster

Choose a frame near the beginning while avoiding an all-black first frame.

Suggested default timestamp:

```text
min(1 second, 10% of duration)
```

For a 10-second video, this produces a poster around 1 second.

Suggested command shape:

```bash
ffmpeg \
  -ss 1 \
  -i input.mp4 \
  -frames:v 1 \
  -vf "scale='min(960,iw)':-2" \
  -an \
  poster.png
```

Then pass the extracted frame through `sharp`:

```ts
await sharp("poster.png")
  .rotate()
  .toColourspace("srgb")
  .webp({ quality: 78, effort: 4 })
  .toFile("poster.webp");
```

The intermediate PNG should remain temporary and should be deleted after the WebP is written.

An implementation may also have FFmpeg write WebP directly, but using `sharp` keeps image output settings consistent with photo derivatives.

### Step 4: Generate browser proxy

Create a maximum-1080p H.264 MP4.

Required characteristics:

- H.264 video
- AAC audio when audio exists
- `yuv420p` pixel format
- Maximum output height of 1080 px
- Preserve aspect ratio
- Do not upscale smaller sources
- Place MP4 metadata at the beginning with `+faststart`

Suggested command:

```bash
ffmpeg \
  -i input.mp4 \
  -map 0:v:0 \
  -map 0:a? \
  -vf "scale='if(gt(iw,1920),1920,iw)':'if(gt(ih,1080),-2,ih)',format=yuv420p" \
  -c:v libx264 \
  -preset medium \
  -crf 21 \
  -c:a aac \
  -b:a 160k \
  -movflags +faststart \
  proxy.mp4
```

The implementation may use a simpler aspect-ratio-safe scale expression if needed. The key requirements are:

- Fit within 1920×1080.
- Preserve aspect ratio.
- Do not upscale.
- Produce even-numbered dimensions where required by H.264.

A robust alternative filter is:

```text
scale=w='min(1920,iw)':h=-2
```

For portrait media, instead constrain both dimensions using a force-original-aspect-ratio expression:

```text
scale=1920:1080:force_original_aspect_ratio=decrease
```

Then ensure even dimensions:

```text
scale=trunc(iw/2)*2:trunc(ih/2)*2
```

The implementing agent should test both landscape and portrait clips.

### Step 5: Validate outputs

Poster validation:

- File exists
- Nonzero byte size
- Decodes as WebP
- Longest edge is no more than 960 px

Proxy validation:

- File exists
- Nonzero byte size
- `ffprobe` reports H.264 video
- Pixel format is `yuv420p`
- Dimensions fit within 1920×1080
- Duration is close to the original
- Audio is AAC when audio is present
- MP4 is seekable and starts playback without full download

---

## 10. Read Pipeline

Normal reads should be extremely simple.

## 10.1 Gallery reads

A gallery query should read database rows and return:

```ts
type GalleryMediaItem = {
  id: string;
  kind: "photo" | "video";
  width: number | null;
  height: number | null;
  durationMs: number | null;
  capturedAt: Date | null;
  thumbnailUrl: string;
};
```

For photos:

```text
thumbnailUrl → thumbnail.webp
```

For videos:

```text
thumbnailUrl → poster.webp
```

Do not inspect original files during gallery reads.

## 10.2 Single-photo reads

Return:

- Metadata
- `viewer.webp`
- `thumbnail.webp`
- Original download URL, when needed

The frontend should use the 2048 px viewer for normal full-screen display.

## 10.3 Single-video reads

Return:

- Metadata
- `poster.webp`
- `proxy.mp4`
- Original download URL, when needed

The frontend should not attempt to play the camera original by default.

## 10.4 Original downloads

Original files should be served only when explicitly requested.

Suggested route behavior:

```text
GET /media/:id/original
```

Set:

- Correct MIME type
- Content-Length
- Content-Disposition with the original filename
- Byte-range support for videos where practical

---

## 11. Error Handling

Create explicit error types:

```ts
class UnsupportedMediaError extends Error {}
class MediaInspectionError extends Error {}
class MediaProcessingError extends Error {}
class MediaValidationError extends Error {}
class MediaNotFoundError extends Error {}
```

On any insert failure:

1. Do not create a completed database record.
2. Remove temporary derivatives.
3. Remove the temporary original copy.
4. Preserve the caller's source file.
5. Include the failed command and sanitized stderr in logs.
6. Avoid returning raw command output or local absolute paths to API clients.

Store enough diagnostic information to distinguish:

- Unsupported format
- Corrupt file
- Missing external binary
- Metadata extraction failure
- RAW preview extraction failure
- RAW decode failure
- FFmpeg decode failure
- Disk-full condition
- Output validation failure

---

## 12. Atomicity and Partial Failure

Because processing is inline, insertion should behave transactionally from the caller's perspective.

A media item is either:

- Fully inserted, with all required derivatives available, or
- Not inserted

Recommended sequence:

1. Generate all files in a temporary media directory.
2. Validate all files.
3. Begin database transaction.
4. Move the original directory into its final location.
5. Move the derived directory into its final location.
6. Insert database record.
7. Commit database transaction.

Filesystem operations and database transactions cannot be perfectly atomic together. For the proof of concept:

- Prefer final renames before database commit.
- If database insertion fails, remove the renamed files.
- Add a later startup cleanup pass for orphaned directories if necessary.

---

## 13. Idempotency and Duplicate Handling

The first implementation may use a generated UUID per insert.

Recommended future enhancement:

- Calculate SHA-256 while copying the original.
- Store the hash in the database.
- Reject or reuse exact duplicate uploads.

This is optional for the proof of concept.

Do not use the original filename as the media ID.

---

## 14. Command Execution Helper

Create one shared helper around `Bun.spawn`.

Suggested interface:

```ts
type RunCommandOptions = {
  cwd?: string;
  timeoutMs?: number;
  stdout?: "pipe" | "ignore";
};

type RunCommandResult = {
  stdout: Uint8Array;
  stderr: string;
  exitCode: number;
};

async function runCommand(
  argv: string[],
  options?: RunCommandOptions,
): Promise<RunCommandResult>;
```

Requirements:

- No shell interpolation.
- Pass commands as argument arrays.
- Capture stderr.
- Throw on nonzero exit.
- Support a timeout.
- Kill timed-out child processes.
- Include the executable and argument list in internal errors.
- Avoid including user-controlled paths in public error messages.

Example:

```ts
const process = Bun.spawn(argv, {
  cwd: options.cwd,
  stdout: options.stdout ?? "pipe",
  stderr: "pipe",
});

const [stdout, stderr, exitCode] = await Promise.all([
  process.stdout
    ? new Response(process.stdout).bytes()
    : Promise.resolve(new Uint8Array()),
  new Response(process.stderr).text(),
  process.exited,
]);
```

---

## 15. Suggested Module Layout

```text
src/media/
├── types.ts
├── paths.ts
├── insert-media.ts
├── read-media.ts
├── classify-media.ts
├── inspect-photo.ts
├── inspect-video.ts
├── process-photo.ts
├── process-video.ts
├── validate-derivative.ts
├── run-command.ts
└── errors.ts
```

Suggested responsibilities:

### `types.ts`

Shared media, derivative, metadata, and API types.

### `paths.ts`

Construct and validate original, derived, and temporary paths.

### `classify-media.ts`

Determine whether the input is a supported photo or video.

### `inspect-photo.ts`

ExifTool metadata extraction and normalization.

### `inspect-video.ts`

`ffprobe` execution and JSON normalization.

### `process-photo.ts`

ARW preview extraction, LibRaw fallback, thumbnail generation, and viewer generation.

### `process-video.ts`

Poster extraction and proxy transcoding.

### `insert-media.ts`

Coordinates the complete synchronous insert transaction.

### `read-media.ts`

Database lookup and derivative path resolution.

### `validate-derivative.ts`

Checks generated images and videos before commit.

### `run-command.ts`

Safe external process execution.

### `errors.ts`

Typed media-pipeline errors.

---

## 16. Suggested Function Signatures

```ts
type PhotoMetadata = {
  mimeType: string | null;
  width: number;
  height: number;
  capturedAt: Date | null;
  latitude: number | null;
  longitude: number | null;
  make: string | null;
  model: string | null;
  lensModel: string | null;
};

type VideoMetadata = {
  mimeType: string | null;
  width: number;
  height: number;
  durationMs: number;
  videoCodec: string;
  pixelFormat: string | null;
  audioCodec: string | null;
  capturedAt: Date | null;
};

async function classifyMedia(
  sourcePath: string,
): Promise<"photo" | "video">;

async function inspectPhoto(
  originalPath: string,
): Promise<PhotoMetadata>;

async function inspectVideo(
  originalPath: string,
): Promise<VideoMetadata>;

async function generatePhotoDerivatives(input: {
  originalPath: string;
  derivedDirectory: string;
}): Promise<{
  thumbnailPath: string;
  viewerPath: string;
}>;

async function generateVideoDerivatives(input: {
  originalPath: string;
  derivedDirectory: string;
  durationMs: number;
}): Promise<{
  posterPath: string;
  proxyPath: string;
}>;

async function validatePhotoDerivative(
  path: string,
  maxLongestEdge: number,
): Promise<void>;

async function validateVideoProxy(path: string): Promise<void>;
```

---

## 17. Performance Expectations

This proof of concept processes one inserted media item inline.

That means:

- Standard image imports should generally complete quickly.
- ARW imports may take longer when LibRaw fallback is needed.
- Video imports may take substantially longer than clip duration, depending on machine speed and encoding settings.
- The HTTP or application caller must be prepared for a long-running request.

No queue is required initially.

However, keep the processing functions independent from the transport layer so they can later be moved behind a job queue without rewriting media logic.

Do not embed request- or framework-specific objects inside the image and video processors.

---

## 18. Testing Plan

## 18.1 Photo fixtures

Include at least:

- Sony a6700 ARW with a large embedded preview
- Sony a6700 ARW with orientation metadata
- JPEG landscape
- JPEG portrait
- HEIC photo
- Corrupt image
- Unsupported file renamed with a valid extension

Verify:

- Original bytes are preserved.
- Orientation is correct.
- Thumbnail fits within 384 px.
- Viewer fits within 2048 px.
- Both outputs are WebP.
- GPS and timestamps are normalized.
- Failed inserts leave no completed database row.

## 18.2 Video fixtures

Include at least:

- Sony XAVC S 4K clip
- Sony XAVC HS / HEVC clip
- 10-bit clip
- Portrait clip
- Clip with no audio
- Very short clip under one second
- Corrupt MP4
- Regular phone H.264 MP4

Verify:

- Original bytes are preserved.
- Poster is generated.
- Proxy is H.264/AAC MP4.
- Proxy pixel format is `yuv420p`.
- Proxy fits inside 1920×1080.
- Portrait orientation is retained.
- Duration remains close to the original.
- Proxy begins playback before full download.
- Failed inserts clean temporary files.

---

## 19. Acceptance Criteria

The implementation is complete when:

1. A supported photo can be inserted synchronously.
2. Its original file is preserved unchanged.
3. A 384 px WebP thumbnail is generated.
4. A 2048 px WebP viewer is generated.
5. Sony ARW files use an embedded preview when possible.
6. ARW files have a LibRaw fallback.
7. A supported video can be inserted synchronously.
8. Its original file is preserved unchanged.
9. A WebP poster is generated.
10. A maximum-1080p H.264 MP4 proxy is generated.
11. Normal reads return only database metadata and derivative paths.
12. Normal reads do not decode original media.
13. Failures do not leave a completed database record.
14. Partially generated files are removed.
15. The processing implementation is independent of the web framework.
16. The code leaves a clear extension point for on-demand 4096 px photo generation.

---

## 20. Explicit Non-Goals

Do not implement the following in the initial version:

- Background queues
- Distributed workers
- Cloud object storage
- CDN integration
- HLS or DASH video streaming
- Multiple video bitrate ladders
- AVIF derivatives
- Large photo generation during initial insert
- Browser-side RAW decoding
- Image editing
- RAW development controls
- Arbitrary image resize parameters
- User-configurable codec settings
- Automatic duplicate detection
- Multi-node locking
- Complex retry orchestration

---

## 21. Final Implementation Summary

Use this initial media contract:

```text
PHOTO INSERT
Original file
    ↓ preserve unchanged
ExifTool metadata
    ↓
ARW embedded JPEG preview or LibRaw fallback
    ↓
384 px WebP thumbnail
2048 px WebP viewer

VIDEO INSERT
Original file
    ↓ preserve unchanged
ffprobe metadata
    ↓
FFmpeg poster frame
    ↓ sharp
960 px WebP poster
    ↓
FFmpeg
1080p H.264/AAC MP4 proxy
```

Use this normal read contract:

```text
Gallery:
  photo → thumbnail.webp
  video → poster.webp

Photo viewer:
  viewer.webp

Video viewer:
  proxy.mp4

Explicit download:
  original file
```

The original files remain authoritative, while every derivative is replaceable and may be regenerated later.
