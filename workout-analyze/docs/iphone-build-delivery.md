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

For a physical-device check, connect and trust the iPhone, enable Developer Mode, select the existing WorkoutAnalyze signing team in Xcode, and run the `WorkoutAnalyze` scheme. Do not change signing credentials for simulator verification. In the app, finish or use an existing saved ride, open **Segments & loops**, and tap **Import & rebuild analysis**. The saved recorder archive remains in SQLite; normalized workouts and analysis are written to the separate native DuckDB file.

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
3. The native shell downloads `GET /__workout/portable-archive` over trusted HTTPS with a 128 MiB bound. The endpoint generates the existing version-1 archive using queries only; it does not modify `data/fitness.duckdb`, Garmin source files, or the iPhone recorder journal.
4. Leave the app foregrounded through download, validation, and merge. Check inserted/unchanged/conflict counts, then open **Segments & loops** and tap **Import & rebuild analysis**.

The fallback manual flow remains available: open **Workout library** in the Mac browser, tap **Download archive**, AirDrop the ZIP into Files, then use **Import from Files** on iPhone. Both buttons feed the identical shared TypeScript bundle validation and merge function; same-ID conflicts are skipped and repeat imports are unchanged rather than overwritten.

Import on the iPhone:

1. Open the newly built Workout Analyze app and open **Workout library**.
2. Tap **Import from Files**, select the transferred ZIP, and leave the app foregrounded through reading, validation, and merge progress.
3. Check the inserted/unchanged/conflict counts. Same-ID conflicts are deliberately skipped, never silently replaced.
4. Return home, open **Segments & loops**, and tap **Import & rebuild analysis**. The bundle deliberately excludes Mac analysis generations, so routes remain empty/stale until this phone-side rebuild completes.
5. Verify the workout count in **Workout library**, open several old Garmin workouts, and verify route/sample maps. Repeat the import once: it should report the imported workouts as unchanged and insert zero.

The version-1 archive carries normalized canonical workout rows, samples in 10,000-row JSON chunks, source normalization metadata when available, and deterministic revision hashes inside a compressed ZIP. Limits are 128 MiB compressed and 512 MiB expanded. The current web implementation still materializes the compressed archive and its expanded ZIP entries in memory, so very large future archives may need streaming ZIP support; the current real archive (~193k samples) produces about a 5.6 MiB bundle. Native reads are bounded at 128 KiB per bridge response. Do not copy or replace `analysis.duckdb`: import is a transaction into the phone archive and never touches the separate recorder SQLite journal.
