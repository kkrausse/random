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

### Local development with remote assets

A useful development setup is to keep a point-in-time copy of the server's
SQLite database on the development machine while leaving the much larger asset
library on a mounted server volume. For example, with the Raspberry Pi share
mounted at `/Volumes/TravelMapApp`:

```env
DATABASE_PATH=./app_data/app.sqlite
ASSET_ROOT=/Volumes/TravelMapApp/app_data/assets
ASSET_TEMP_ROOT=/Volumes/TravelMapApp/app_data/assets/.tmp
```

Create the local database with SQLite's `.backup` command while the server
application is stopped, then transfer that snapshot. Do not copy an active
database file or point `DATABASE_PATH` at the mounted volume. Local database
changes do not automatically sync back to the server, and writes to the shared
asset directory can leave the two databases inconsistent. Treat this as a
read-oriented development setup unless performing the controlled
[remote media processing handoff](./docs/media-processing-handoff.md).

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

For a fast, two-stage import, store the immutable originals first and process derivatives later:

```bash
bun run backfill-media -- \
  --source /path/to/media \
  --recursive \
  --store-only \
  --concurrency 4

bun run process-media
```

`--store-only` records each original as `processing` but does not run ExifTool, FFmpeg, Sharp, or LibRaw. `process-media` processes every stored pending item; use `--import <import-id>` to limit it to one backfill, or `--limit <count>` to process a batch. A stopped processor can be rerun to continue processing remaining items.

To process server assets on another machine without opening SQLite over SMB,
follow the [remote media processing handoff](./docs/media-processing-handoff.md).

Store-only backfills hash files concurrently before linking them into the library. They use four workers by default; pass `--concurrency <count>` to tune that for the storage device.

To pause a running backfill after its active workers finish, send `SIGUSR1` to the `bun run scripts/backfill-media.ts` process from another terminal. It exits with the import still resumable:

```bash
kill -USR1 <pid>
```

Resume that storage import with:

```bash
bun run backfill-media -- \
  --source /path/to/media \
  --recursive \
  --store-only \
  --continue-import <import-id>
```

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
