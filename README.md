# Personal Atlas

A local-first trip library for workout routes, photos, and videos. TanStack Start provides the UI and server routes, Bun owns SQLite and filesystem access, and MapLibre renders normalized workout tracks with timestamp-positioned media.

## Requirements

- [Bun](https://bun.sh/)
- ExifTool for photo metadata and Sony ARW embedded previews
- FFmpeg and FFprobe for video inspection, posters, and browser-compatible proxies
- LibRaw's `dcraw_emu` for Sony ARW files without a sufficiently large embedded preview

On Debian or Ubuntu:

```bash
sudo apt install ffmpeg exiftool libraw-bin
```

`sharp` is installed as a Bun dependency and generates validated WebP image derivatives.

## Configuration

The local `.env` uses:

```env
DATABASE_PATH=./app_data/app.sqlite
ASSET_ROOT=./app_data/assets
ASSET_TEMP_ROOT=./app_data/assets/.tmp
```

`DATABASE_PATH` and `ASSET_ROOT` are intentionally separate. Keep SQLite on a normal local filesystem. **Do not open the SQLite database over SMB or another network filesystem.** `ASSET_ROOT` may point to a mounted SMB share or another large filesystem.

Temporary assets should remain on the same filesystem as `ASSET_ROOT` so completed originals and derivatives can be moved into place atomically. SQLite stores only validated relative asset paths; server responses never expose absolute local paths.

## Run

```bash
bun install
bun run migrate
bun run dev
```

Open `http://localhost:3000`. Migrations are also applied automatically when the application first opens its database.

## Browser Imports

The media browser accepts multiple photos and videos, creates one import batch, and sends one file per request in selection order. Each original is durably stored and recorded with `processing` before synchronous derivative work begins. A processing failure retains the immutable original, marks the media and import item as failed, and removes incomplete temporary derivatives.

Normal gallery reads include only `ready` media and load the following derivatives:

- Photos: 384 px WebP thumbnail and 2048 px WebP viewer
- Videos: 960 px WebP poster and maximum-1080p H.264/AAC MP4 proxy

The authoritative settings, validation behavior, Sony ARW flow, and processing version are documented in [`media_impl.md`](./media_impl.md).

Workout ZIP uploads preserve the original archive, extract supported Apple Health GPX routes, and store normalized points in SQLite. Workouts remain globally available and unassigned until selected for a trip.

## Backfill

Run a deterministic recursive backfill:

```bash
bun run backfill-media -- \
  --source /path/to/media \
  --recursive
```

Directory backfills default to `hardlink`, which does not duplicate the original file data. Use `--mode copy` or `--mode move` explicitly when linking is not appropriate.

Before importing, the backfill computes a SHA-256 hash of each source and skips content already present in the media library, even when the filename or source path differs. The first run after this feature is installed also hashes existing ready media originals so they participate in duplicate detection; hashes are stored in SQLite and protected by a unique index.

Preview without database or filesystem writes:

```bash
bun run backfill-media -- \
  --source /path/to/media \
  --mode copy \
  --recursive \
  --dry-run \
  --include jpg,jpeg,arw,mp4 \
  --limit 100
```

Resume an existing local backfill import:

```bash
bun run backfill-media -- \
  --source /path/to/media \
  --mode copy \
  --recursive \
  --continue-import <import-id>
```

Storage modes:

- `copy` preserves the source and creates a managed original.
- `move` renames on the same filesystem, or validates a cross-device copy before deleting the source.
- `hardlink` is the default, is local-path-only, and never falls back to copying. Source and asset storage must share a filesystem. Both paths reference the same inode.
- Browser uploads use `upload` and stream into managed temporary storage.

Every managed original is changed to read-only mode (`0444`) before it is placed in permanent storage. The application only reads originals after that point and writes generated files under `media/derived/`. For a hard link, permissions belong to the shared inode, so the source path also becomes read-only. This prevents accidental writes through either name, though a user with ownership or elevated filesystem privileges can deliberately restore write permission.

## Failed Media

Failed media is retained in the `media` table with a sanitized `failure_code` and `failure_message`; its original remains under `media/originals/<media-id>/`. Failed records are intentionally excluded from ordinary gallery and selector queries. There is no retry or deletion UI yet. Inspect failures with SQLite and retry the source through a new browser import or a resumed backfill import.

## Checks

```bash
bun run migrate
bun run test
bunx tsc --noEmit
bun run check
bun run build
```

The map currently uses CARTO Voyager tiles. Map media uses explicit GPS first, then linearly interpolates between surrounding workout samples when the effective capture timestamp falls within a workout and the sample gap is no more than ten minutes.
