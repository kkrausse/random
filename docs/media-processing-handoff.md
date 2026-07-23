# Remote Media Processing Handoff

Use this procedure when SQLite lives on a server but another machine should
process media stored on a mounted server volume.

## Safety rules

- Keep SQLite on a local filesystem. Never open the database through SMB.
- Stop the server application and all other database writers for the entire
  handoff. The server and processing databases diverge as soon as work starts.
- Run only one `process-media` command at a time.
- Mount asset storage over a stable, high-throughput connection. On the same
  LAN, prefer the server's LAN address for SMB while retaining Tailscale for
  administrative SSH access.
- Keep a server-side backup until the replacement database has passed its
  final integrity check.

The processing host needs ExifTool, FFmpeg, FFprobe, LibRaw's `dcraw_emu`, and
an FFmpeg build with `libx264`:

```bash
ffmpeg -hide_banner -h encoder=libx264
```

## Take a working copy

Set paths appropriate to the server, then confirm no process has the database
open. `fuser` should print no process:

```bash
ssh <server> 'fuser -v /path/to/app.sqlite'
```

Record the source checksum and create both a rollback backup and a consistent
transfer snapshot on the server:

```bash
ssh <server> 'sha256sum /path/to/app.sqlite'
ssh <server> 'cp -p /path/to/app.sqlite /path/to/app.sqlite.pre-processing.bak'
ssh <server> 'sqlite3 /path/to/app.sqlite ".backup /path/to/app.sqlite.processing-snapshot"'
scp <server>:/path/to/app.sqlite.processing-snapshot app_data/processing.sqlite
```

Validate the local snapshot before processing:

```bash
sqlite3 app_data/processing.sqlite 'PRAGMA quick_check; SELECT status, count(*) FROM media GROUP BY status ORDER BY status;'
```

The first result must be `ok`.

## Process media

Point SQLite at the local working copy and both asset paths at the mounted
server volume:

```bash
DATABASE_PATH="$PWD/app_data/processing.sqlite" \
ASSET_ROOT=/Volumes/<share>/app_data/assets \
ASSET_TEMP_ROOT=/Volumes/<share>/app_data/assets/.tmp \
bun run process-media
```

Use `--limit <count>` for a test batch. A stopped processor can be rerun to
continue pending records. Do not start a second processor concurrently.

## Return the database

After processing exits, create a clean snapshot. This avoids copying stale or
uncheckpointed WAL and shared-memory sidecars:

```bash
rm -f app_data/processed-final.sqlite
sqlite3 app_data/processing.sqlite '.backup app_data/processed-final.sqlite'
sqlite3 app_data/processed-final.sqlite 'PRAGMA quick_check; SELECT status, count(*) FROM media GROUP BY status ORDER BY status;'
```

Confirm the server database checksum still matches the value recorded before
processing and that `fuser` still reports no writer. If either check fails, do
not overwrite the server database.

Upload under a temporary name and validate it on the server:

```bash
scp app_data/processed-final.sqlite <server>:/path/to/app.sqlite.pending
ssh <server> 'sqlite3 /path/to/app.sqlite.pending "PRAGMA quick_check; SELECT status, count(*) FROM media GROUP BY status ORDER BY status;"'
```

When the candidate reports `ok`, preserve the current database and atomically
install the candidate on the same filesystem:

```bash
ssh <server> 'cp -p /path/to/app.sqlite /path/to/app.sqlite.pre-install.bak'
ssh <server> 'mv /path/to/app.sqlite.pending /path/to/app.sqlite'
ssh <server> 'sqlite3 /path/to/app.sqlite "PRAGMA quick_check; SELECT status, count(*) FROM media GROUP BY status ORDER BY status;"'
```

Restart the server application only after the final check succeeds.
