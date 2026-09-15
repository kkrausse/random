# PicSync

PicSync is an iPhone and iPad app for copying selected Photos originals to an SMB destination you control. It uses direct SMB on a trusted LAN or private network, stages PhotoKit original resources locally, and publishes completed media with a temporary-file-and-rename protocol.

## Current workflow

1. On the home screen, choose **Upload Destination**, then select a saved destination or add one.
2. Enter the server address, port, user, password, and optional domain/workgroup for a new destination.
3. Select **Select Share**, choose a server share, and save the destination.
4. Choose individual Photos or **Sync an Entire Album**.
5. In the sync review, browse or create folders and select **Use This Folder**.
6. Start the sync.

The home screen shows the saved server, share, password-storage status, and the default worker count for new runs.

## Photos behavior

- The app requests Photos read/write authorization and supports limited-library access.
- Individual selection uses the system Photos picker.
- Album selection lists user and smart PhotoKit albums, then snapshots the current asset identifiers when the run is created.
- Export streams `PHAssetResourceManager` chunks to disk with iCloud network access enabled, enforcing the staging budget before each write.
- The original-resource policy includes `.photo`, `.video`, `.audio`, `.pairedVideo`, and `.alternatePhoto` resources. It excludes rendered/edit resources such as `.fullSizePhoto`.
- This is an original-media archive. It does not preserve Photos edits, album membership, favorites, captions, or other library-only metadata. Original embedded metadata is retained.
- iCloud Shared Albums are marked as reduced-copy sources and cannot be synced as originals. Apple limits their photos to about 2048 pixels and videos to 720p; full-quality files must come from a personal or shared Photos library instead.

## SMB destination behavior

- Multiple connection profiles can be saved and selected. Profiles store host, port, username, optional domain, and share in the local SQLite database.
- Passwords are stored in the iOS Keychain, not in the journal. A saved password is intentionally not rendered back into the form.
- Destination selection is browse-first and does not require manually entering a share or path.
- Shares belong to saved destinations. The upload folder is selected separately for each sync and folders can be created from the folder browser.
- The SMB implementation is a pinned local snapshot of `kishikawakatsumi/SMBClient` 0.3.1. Vendoring details are in `vendor/SMBClient/VENDORING.md`.
- Xcode resolves that package only from `vendor/SMBClient`; no remote package registry is needed to build.

## Transfers and recovery

- Each asset is staged under Application Support and hashed using streaming SHA-256.
- Uploads use UUID-owned temporary names. PicSync validates the temporary size, renames it to the final media filename, then writes an immutable `.picsync/objects/<prefix>/<fingerprint>.json` content record.
- A missing `.picsync` directory is expected on a fresh destination and is not an error.
- A valid content record skips an already-managed duplicate.
- Deduplication is share-wide: choosing another folder on the same share does not create another copy of content already managed elsewhere on that share.
- Filename collisions receive deterministic hash suffixes; existing media is never intentionally overwritten.
- Work intent, transfer checkpoints, and progress counters live **on the iPhone** in `Application Support/PicSync/journal.sqlite`. The Pi retains per-object JSON manifests; it does not need the phone database to verify finished media.
- Existing `journal.json` data migrates automatically in a transaction. The original JSON is retained untouched; a committed migration marker prevents re-importing deleted or updated runs. Keep the SQLite database, WAL, and SHM together when copying a live app container.
- Transfers are claimed with indexed SQLite queries, and counters update atomically with each transfer. The UI reads small run summaries and at most five failure examples instead of scanning the library every second.
- Interrupted and failed runs persist locally. **Resume** recovers unfinished claims and requeues failures in bounded transactions. Staged resources are checked lazily as workers claim them, rather than hashing all staging during startup.
- Owned partial uploads resume at their current length only after the entire existing remote prefix matches the local SHA-256 prefix. Corrupt partials restart; an existing final file is accepted during recovery only after its full hash matches. Unrelated final files are preserved and a new collision-safe name is chosen.
- Ordinary copies are size-checked; they are **not yet checksum-verified on the Pi**. Use the verifier below for end-to-end integrity validation. Deduplication lookups also use manifest/size validation, not a fresh full-file hash.
- Transient connection/transfer failures retry with bounded exponential backoff (up to three retries). SMB requests time out after 30 seconds. Disk-full, permissions, persistent SMB errors, and unavailable destinations pause the run without marking the entire queue failed.
- Staging defaults to an **8 GiB** budget, configurable from 2–128 GiB. PicSync preserves a separate **2 GiB** free-space reserve. One asset exports at a time while other workers upload; export waits for active uploads to free space, or pauses if no upload can free enough. An individual asset larger than the budget requires increasing the budget. Failed/paused runs count toward it, and abandoned completed staging is cleaned on the next run. Staging is excluded from device backup.
- The run detail view updates completed, skipped-duplicate, and failed counts while a run is active. Error output is collapsed and capped at five inline examples.
- The run detail also shows active filenames/phases, per-file byte progress, upload throughput, and the reason for an automatic pause. Discovered bytes are explicitly not a precomputed full-library size or ETA.
- PicSync disables the iOS idle timer while a sync is active, including photo export and upload, then restores normal Auto-Lock behavior when the run pauses, completes, or fails. Manual locking or leaving the app can still suspend it.

## Parallelism

Set **Parallel transfers** on the home screen under **Transfer Settings**. The setting persists across launches, applies to new runs, and supports 1 through 20 workers.

Each active asset worker creates its own SMB session. This avoids interleaving requests through one SMBClient session. Changing the setting does not resize a running pool, but the current setting is applied when a paused or failed run resumes.

Start with 2 workers on a Raspberry Pi, then compare 4 with the same representative workload. More workers can increase contention rather than throughput. Export is serialized independently of the upload worker count to avoid staging-space deadlocks.

## Verify the archive on the Pi

Copy `scripts/verify.ts` to the Pi and run it with Bun on a supported 64-bit Linux installation. Pass the **filesystem path of the Samba share root**, which contains `.picsync`, not just the selected photo folder:

```sh
bun verify.ts /srv/photos
```

The verifier streams local media through SHA-256, validates content-record fingerprints, and reports missing, modified, or incorrectly sized resources. It does not send a terabyte back to the phone. It writes separate timestamped JSONL reports under `.picsync/verification-reports/`, with per-object `verified`/`failed` results and a final summary; it never rewrites original media or commit manifests. Exit codes are 0 for success, 1 for failed objects, and 2 for an incomplete/invalid invocation. A report without its final `finished` summary is incomplete. Reports describe content at verification time, not a permanent integrity guarantee.

Run verification after pausing or completing the transfer so the set of manifests is stable. The phone's UI continues to label these files as copied; verification results currently live in the Pi-side report.

## Before a full-library transfer

Use a 500–1,000-asset pilot containing iCloud-only originals, Live Photos, RAW companions, Unicode/repeated filenames, and large videos. Check:

1. Pause/resume and force-quit/relaunch preserve the queue and partial uploads.
2. Disconnecting Wi-Fi and restarting Samba recover or leave a resumable pause.
3. A quota-limited test destination pauses cleanly when full without staging the entire queue.
4. The Pi-side verifier reports zero failed objects and each selected asset is copied or explicitly skipped/failed.
5. Compare sustained throughput with 2 and 4 workers. Keep the phone plugged in and PicSync in the foreground.

At sustained end-to-end 10 MB/s, 1 TB takes about 28 hours; iCloud downloads and interruptions add time. A wired Pi with suitable USB storage is preferable for the initial archive.

## Building

Open `picsync.xcodeproj` in Xcode 16.2 or later, select a signing team, and run on an iPhone or iPad running iOS 18.2 or later.

Simulator build:

```sh
xcodebuild -project picsync.xcodeproj -scheme picsync \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' build
```

Unit tests:

```sh
xcodebuild -project picsync.xcodeproj -scheme picsync \
  -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 16 Pro' \
  -only-testing:picsyncTests test
```

## Deploying to a connected iPhone

Keep the iPhone unlocked, connected, paired with Xcode, and enabled for Developer Mode. First obtain both identifiers; Xcode and `devicectl` may report different IDs for the same phone:

```sh
xcrun devicectl list devices
xcodebuild -project picsync.xcodeproj -scheme picsync -showdestinations
```

Build a signed Debug app for the phone using the `platform:iOS` destination ID from `-showdestinations`:

```sh
xcodebuild -project picsync.xcodeproj -scheme picsync \
  -configuration Debug -destination 'id=<XCODE_DESTINATION_ID>' \
  -derivedDataPath /tmp/picsync-derived-data build
```

Install and launch it using the CoreDevice identifier from `devicectl list devices`:

```sh
xcrun devicectl device install app --device '<COREDEVICE_ID>' \
  /tmp/picsync-derived-data/Build/Products/Debug-iphoneos/picsync.app
xcrun devicectl device process launch --device '<COREDEVICE_ID>' \
  com.example.picsync
```

Last verified on July 19, 2026 with Xcode destination `<device-id>` and CoreDevice `<core-device-id>` (`device owner`, iPhone 16 Pro Max). Automatic signing used team `<team-id>`; build, install, and launch all succeeded.

Core tests can also run on macOS without device signing:

```sh
bash scripts/test-core.sh
bun test scripts/verify.test.ts
```

`PICSYNC_XCODE_DIR` can select a different Xcode developer directory. These tests exercise the same Swift transfer/storage sources; they do not replace the signed iPhone build, installation, and live transfer pilot.

## Network and security notes

- Use SMB only on a trusted local network, VPN, or private overlay network. The vendored client currently implements SMB2 and does not provide SMB3 encryption.
- Do not expose Samba directly to the public internet.
- Verify the Samba user has read/write access to the chosen share and destination folder.
- iOS may suspend foreground work. PicSync persists the run journal and uses safe remote temporary files so a later Resume can retry safely, but it does not promise guaranteed background completion.

## Current validation status

The SQLite/recovery update has macOS core tests for migration and rollback, concurrent claims, transactional counters, all interrupted checkpoint states, same-size collisions, partial resume/corruption, Live Photo commit recovery, destination-full handling, connection failure isolation, pause/resume, staging limits/backpressure, share-wide deduplication, and a synthetic 60,000-asset journal. Verifier tests cover success, corruption, missing/malformed records, and paths escaping the share.

The full iOS Swift source has also been type-checked directly against the iOS 18.2 SDK. A signed build/install/launch of this update is currently blocked on this development machine: Xcode's CoreDevice loader fails because the Mercury framework is missing `_XPCTypeBool`. The updated app has **not** been deployed or validated against the physical iPhone/Pi yet. Repair the Xcode/device-toolchain installation, deploy using the commands above, and run the pilot before starting the full library.
