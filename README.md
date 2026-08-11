# PicSync

PicSync is an iPhone and iPad app for copying selected Photos originals to an SMB destination you control. It uses direct SMB on a trusted LAN or private network, stages PhotoKit original resources locally, and publishes completed media with a temporary-file-and-rename protocol.

## Current workflow

1. On the home screen, choose **Upload Destination**.
2. Enter the server address, port, user, password, and optional domain/workgroup.
3. Select **Select Share**, then choose a server share.
4. Select **Select Folder**, browse or create folders, and select **Use This Folder**.
5. Select **Save Destination**. The full destination profile is persisted and the app opens photo selection.
6. Choose individual Photos or **Sync an Entire Album**.
7. Review the source and start the sync.

The home screen shows the saved server, share, folder, password-storage status, and the default worker count for new runs.

## Photos behavior

- The app requests Photos read/write authorization and supports limited-library access.
- Individual selection uses the system Photos picker.
- Album selection lists user and smart PhotoKit albums, then snapshots the current asset identifiers when the run is created.
- Export uses `PHAssetResourceManager` with iCloud network access enabled.
- The original-resource policy includes `.photo`, `.video`, `.audio`, `.pairedVideo`, and `.alternatePhoto` resources. It excludes rendered/edit resources such as `.fullSizePhoto`.

## SMB destination behavior

- Connection profiles store host, port, username, optional domain, share, and folder in the local journal.
- Passwords are stored in the iOS Keychain, not in the journal. A saved password is intentionally not rendered back into the form.
- Destination selection is browse-first: the app lists shares, then folders. It does not require manually entering a share or destination path.
- Share and folder selection are separate operations, and folders can be created from the folder browser.
- The SMB implementation is a pinned local snapshot of `kishikawakatsumi/SMBClient` 0.3.1. Vendoring details are in `vendor/SMBClient/VENDORING.md`.
- Xcode resolves that package only from `vendor/SMBClient`; no remote package registry is needed to build.

## Transfers and recovery

- Each asset is staged under Application Support and hashed using streaming SHA-256.
- Uploads use UUID-owned temporary names. PicSync validates the temporary size, renames it to the final media filename, then writes an immutable `.picsync/objects/<prefix>/<fingerprint>.json` content record.
- A missing `.picsync` directory is expected on a fresh destination and is not an error.
- A valid content record skips an already-managed duplicate.
- Filename collisions receive deterministic hash suffixes; existing media is never intentionally overwritten.
- Interrupted and failed runs persist in the local journal. **Resume** requeues failed items in one transaction and resumes from valid local staging where available.
- The run detail view updates completed, skipped-duplicate, and failed counts while a run is active. Error output is collapsed and capped at five inline examples.
- PicSync disables the iOS idle timer while a sync is active, including photo export and upload, then restores normal Auto-Lock behavior when the run pauses, completes, or fails. Manual locking or leaving the app can still suspend it.

## Parallelism

Set **Parallel transfers** on the home screen under **Transfer Settings**. The setting persists across launches, applies to new runs, and supports 1 through 20 workers.

Each active asset worker creates its own SMB session. This avoids interleaving requests through one SMBClient session. Changing the setting does not resize a running pool, but the current setting is applied when a paused or failed run resumes.

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

## Network and security notes

- Use SMB only on a trusted local network, VPN, or private overlay network. The vendored client currently implements SMB2 and does not provide SMB3 encryption.
- Do not expose Samba directly to the public internet.
- Verify the Samba user has read/write access to the chosen share and destination folder.
- iOS may suspend foreground work. PicSync persists the run journal and uses safe remote temporary files so a later Resume can retry safely, but it does not promise guaranteed background completion.

## Current validation status

The project builds for the iOS simulator and device. Core unit tests cover SMB endpoint parsing, safe remote naming, PhotoKit resource selection, and chunked SHA-256 hashing.

Real-device transfer validation remains important: test a small photo first, then verify filenames with spaces and Unicode, Live Photos, iCloud-only originals, interruptions, and the worker settings appropriate for the target Samba server.
