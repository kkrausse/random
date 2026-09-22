# iPhone installed-build delivery

The Settings screen defaults to this private tailnet URL:

```text
https://kevins-macbook-pro-2.tail7e28fb.ts.net:8443/__workout/build/manifest.json
```

It is available only while the Mac is online, Tailscale is connected on both devices, and the mobile Vite development server is running on port 4317. Tailscale Serve terminates trusted HTTPS on port 8443 and proxies the whole Vite server, including HMR WebSockets, diagnostics, and installed-build delivery. Port 443 and its existing root handler remain untouched.

Settings offers the same HTTPS origin as an explicit draft action. It does not infer the native source from `window.location`, build identity, or bridge health, and does not switch sources until **Connect** is pressed. Configured, target, loaded, load-state, current-failure, and historical-failure values are projected through the Zustand store from the validated native `webBuild` diagnostics row. Polling initializes the draft from a configured development URL only while the draft is clean. Direct `http://100.86.29.19:4317/` access remains available as the current development source; the Vite client uses that page's own HMR origin rather than redirecting it.

## Publish a build

From `workout-analyze`:

```sh
bun run mobile:build
```

This writes the independently installable artifact to `mobile/dist`. The development-only Vite endpoint reads that directory, serves `manifest.json`, and serves only files declared by the current manifest. It rejects traversal, undeclared files, oversized declarations, and files whose current size differs from the manifest. `mobile/dist` is excluded from Vite's watcher so publishing does not trigger an HMR loop.

The native shell downloads every declared path relative to the manifest URL and independently verifies each exact byte count and SHA-256 hash before activation. In Settings, **Download, activate & reload** performs the complete install flow; no development-source URL is needed for the installed build.

## Tailscale Serve route

Inspect before changing it:

```sh
tailscale serve status --json
```

The intended configuration keeps the existing port-443 `/` handler and adds a separate listener:

```text
https://kevins-macbook-pro-2.tail7e28fb.ts.net:8443/ -> http://127.0.0.1:4317
```

Do not enable Funnel. If Tailscale reports that HTTPS certificates require tailnet-owner approval, approve HTTPS for this tailnet and retry the Serve command; do not fall back to HTTP because the native installed-build contract requires HTTPS.

## Verify

```sh
curl --fail --silent --show-error \
  https://kevins-macbook-pro-2.tail7e28fb.ts.net:8443/__workout/build/manifest.json
```

After publishing a new build, its generated `buildId` must be new. The native shell intentionally refuses to overwrite an already-installed build with the same ID.

## Native DuckDB verification

No phone connection is required to compile or run the simulator tests. The project resolves the pinned `duckdb-swift` 1.1.3 dependency through Swift Package Manager. Before installing, build the current web artifact so the app bundle contains the native-database adapter:

```sh
bun run mobile:build
xcodebuild -project ios/WorkoutAnalyze.xcodeproj -scheme WorkoutAnalyze \
  -sdk iphonesimulator -configuration Debug -arch arm64 \
  CODE_SIGNING_ALLOWED=NO build
```

For a physical-device check, connect and trust the iPhone, enable Developer Mode, select the existing WorkoutAnalyze signing team in Xcode, and run the `WorkoutAnalyze` scheme. Do not change signing credentials for simulator verification. In the app, finish or use an existing saved ride, open **Workout library**, and tap **Import saved iPhone workouts**. Then open **Segments & loops** and tap **Run segment analysis**. These are deliberately separate operations: import normalizes the SQLite recorder archive into native DuckDB, while analysis reads only the normalized DuckDB archive and never imports or contacts the network.

## Transfer existing Mac history to iPhone

Build both updated layers before installing; an older native shell does not have the bounded HTTPS archive-download capability:

```sh
bun run mobile:build
xcodebuild -project ios/WorkoutAnalyze.xcodeproj -scheme WorkoutAnalyze \
  -sdk iphonesimulator -configuration Debug -arch arm64 \
  CODE_SIGNING_ALLOWED=NO build
```

For the actual phone, open `ios/WorkoutAnalyze.xcodeproj` in Xcode, select the existing signing team and connected iPhone, then run the `WorkoutAnalyze` scheme. No phone installation was performed while implementing this workflow.

Direct import from the Mac (preferred):

1. Start `bun run mobile:dev` from `/Users/kkrausse/Documents/repos/kkrausse/random/workout-analyze`. Tailscale Serve continues to expose that unchanged server at `https://kevins-macbook-pro-2.tail7e28fb.ts.net:8443/`.
2. On the iPhone, open **Workout library**. Confirm **Local Mac URL** points at the current development origin (it follows the configured development source until edited), then tap **Import from Mac**.
3. Shared web TypeScript fetches the manifest and both Parquet responses. It forwards bounded opaque byte chunks through `file.create/write/finalize`; native assembles each complete file at a host-owned temporary path. The web view never decodes sample rows. Native performs no archive networking.
4. Leave the app foregrounded through download, validation, and merge. Check inserted/unchanged/conflict counts, then open **Segments & loops** and tap **Run segment analysis** (or **Rebuild segment analysis** after a previous run).

The old manual ZIP flow remains available and is explicitly labelled **Import legacy ZIP from Files**. It is separate from the preferred Mac Parquet path; new Mac imports do not create or transport JSON sample chunks.

Import on the iPhone:

1. Open the newly built Workout Analyze app and open **Workout library**.
2. For a legacy bundle, tap **Import legacy ZIP from Files**, select the transferred ZIP, and leave the app foregrounded through reading, validation, and merge progress.
3. Check the inserted/unchanged/conflict counts. Same-ID conflicts are deliberately skipped, never silently replaced.
4. Return home, open **Segments & loops**, and tap **Run segment analysis**. The bundle deliberately excludes Mac analysis generations, so routes remain empty until this phone-side rebuild completes. The screen reports genuine input loading, candidate discovery/matching, result construction, atomic publication, and final counts/duration; it does not show estimated percentages.
5. Verify the workout count in **Workout library**, open several old Garmin workouts, and verify route/sample maps. Repeat the import once: it should report the imported workouts as unchanged and insert zero.

The Parquet-v1 manifest names `activities.parquet` and `samples.parquet` and records exact sizes and SHA-256 hashes. The Mac creates both files from one DuckDB snapshot and computes deterministic per-workout revisions in SQL. TypeScript owns URL selection, HTTP status handling, stream progress, bounds, and retry by rerunning the action. WKWebView holds only bounded `Uint8Array` chunks and base64-encodes each bridge write; it never parses Parquet. Native verifies ordered offsets, final length, and SHA-256, then retains the completed temporary file until import cleanup. DuckDB 1.1.3 resolves the opaque handle to that trusted path and uses standard seekable `read_parquet(?)` (including its footer); arbitrary network chunks are never treated as independent Parquet files. Shared SQL validates counts, canonical IDs, relationships, and revisions, then atomically inserts only absent IDs, records provenance, skips explicit same-ID conflicts, and invalidates derived analysis only when rows were inserted. Phone recordings and the recorder SQLite journal are never overwritten. The legacy JSON ZIP implementation remains only for explicit Files import.
