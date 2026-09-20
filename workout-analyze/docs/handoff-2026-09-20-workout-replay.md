# Workout capture recovery and replay handoff

Status: the physical-phone workout is safely recovered locally. Do not commit the capture files; they contain private GPS and sensor data.

## Recovered capture

Physical device: `Kevin Krausse`, UDID `00008140-000A31A03E80801C`, bundle ID `com.kkrausse.workoutanalyze`.

The full Application Support directory was copied before any app update or installation:

```text
/Users/kkrausse/Documents/repos/kkrausse/random/workout-analyze/data/phone-recovery-2026-09-20/application-support/
```

This directory includes the SQLite database, its WAL/SHM files, the diagnostic logs, and the pinned recording engine. The WAL is essential: reading a copy of only `recording-v1.sqlite` showed the long ride as still recording with 5,238 events, while opening the complete database+WAL showed the committed finish and 5,240 events.

Latest workout:

- Session: `ride-F97D601D-65D7-4C5C-9438-1C8D4B3FDB69`
- Started: `2026-09-20T01:07:42Z`
- Finished: `2026-09-20T01:51:04Z`
- Raw journal: 5,240 contiguous events, sequences 1–5,240
- Normalized observations: 5,113
- Engine checkpoint: 5,113
- Engine: `recording-engine-v1` / `ride-metrics-v1`
- Pinned engine SHA-256: `fc50e0f784b1146d00a72395b7a4c9ad73c3b7bd95e3e8f61ad4ceb3d6702e26`

A standalone SQLite backup, canonical raw-event JSON/JSONL, normalized observations, host events, issues, metrics, checksums, and ZIP were generated at:

```text
/Users/kkrausse/Documents/repos/kkrausse/random/workout-analyze/data/local-replays/ride-F97D601D-65D7-4C5C-9438-1C8D4B3FDB69/
/Users/kkrausse/Documents/repos/kkrausse/random/workout-analyze/data/local-replays/ride-F97D601D-65D7-4C5C-9438-1C8D4B3FDB69.zip
```

ZIP SHA-256:

```text
6b70d9eca78ed35891d618f8fd1a88bc9d4fecca54d6c59d2c6a26ad91550796
```

Both `data/phone-recovery-*` and `data/local-replays` are ignored by git.

## Verified recording behavior

Uploaded telemetry independently recorded a successful `workout.finish` commit at `2026-09-20T01:51:04Z`, with no storage failure, no engine failure, no queued journal writes, and no processing backlog. The database+WAL agrees.

The database also contains two earlier short finished test workouts. The app UI nevertheless displayed “No saved workouts.” This is an archive presentation/query-flow defect or stale web projection, not lost recording data. Directly invoke `archive.list` through the physical-device runner once HTTPS bridge startup works, then compare its reply with the three `sessions` rows in SQLite. The History screen currently hides archive request errors and renders an empty state, so add visible failure/retry handling and reload archive data when entering History.

## HTTPS development connection failure

Supported origin:

```text
https://kevins-macbook-pro-2.tail7e28fb.ts.net:8443/
```

Tailscale Serve is healthy and proxies that origin to `http://127.0.0.1:4317`. HTTPS is required for the supported remote development/download path and Web Crypto usage. The requirement and Serve configuration are documented in `docs/iphone-build-delivery.md`.

Observed behavior:

1. The URL loads the Workout UI in iPhone Safari.
2. Safari correctly reports “Native bridge unavailable” and registers with the dev runner as kind `unavailable`.
3. In the native shell, Native Recovery shows the HTTPS development URL but remains `loading`/`waiting`; “Use development origin now” does not reach `bridge.hello`.
4. Therefore network, DNS, TLS, Vite, and the JavaScript bundle are good. The failure is specific to WKWebView/native bridge startup or native origin acceptance.
5. The runner consequently reports no client of kind `native`, so read-only scripts cannot currently call `archive.list` or `journal.read`.

The installed app was not changed after recovery. A speculative `WebHost` fallback was deliberately not retained.

## Next-session plan

1. Keep the private captures untouched and ignored. Work against a copy when transforming/replaying.
2. Add explicit diagnostics when `WebHost.userContentController` rejects a script message. Log the actual `WKSecurityOrigin` protocol/host/port, current main-page URL, expected origin, and message handler name without logging command payloads.
3. Add a narrowly scoped, tested origin helper. If `WKSecurityOrigin` differs unexpectedly on Tailscale HTTPS port 8443, permit fallback only when all are true: main frame, current `WKWebView.url` is same-origin with the configured development URL, and the message arrives through the registered handler. Do not broadly relax origin checks.
4. Build/test the native shell, then install it as an update without uninstalling the app. Before installation, take another complete app-container copy. Confirm the database+WAL still has all three sessions afterward.
5. Launch the app on the HTTPS origin and confirm a runner client of kind `native` appears at `GET /__workout/run`.
6. Run read-only `archive.list` and paged `journal.read` against the latest session. Add a development-only server ingestion endpoint/CLI that streams bounded pages directly into an ignored local capture directory, validates sequence continuity and session identity, and writes atomically. Avoid returning the entire workout through the runner's bounded result payload.
7. Make remote capture retrieval a first-class developer action: select newest finished workout (or explicit session), stream raw pages, include metadata/checksums, report progress, and never mutate/export-as-live the source workout.
8. Build a browser-only `RecordingSource` adapter over the recovered bundle. Feed raw events through the same decoder/projector/store path as native input, with an injected replay clock and isolated namespace. Start with load/play/pause/speed/seek; do not create a parallel metrics implementation.
9. Improve History loading: refresh on entry, expose request errors, provide Retry, and distinguish “archive returned zero rows” from “archive read failed/not loaded.”

## Useful commands

Start the expected dev server:

```sh
cd /Users/kkrausse/Documents/repos/kkrausse/random/workout-analyze
bun run mobile:dev
```

Inspect runner clients:

```sh
curl --fail --silent \
  https://kevins-macbook-pro-2.tail7e28fb.ts.net:8443/__workout/run | jq .
```

Verify the recovered SQLite+WAL copy:

```sh
sqlite3 -readonly \
  /Users/kkrausse/Documents/repos/kkrausse/random/workout-analyze/data/phone-recovery-2026-09-20/application-support/recording-v1.sqlite \
  'SELECT id,state,started_at,finished_at,observation_sequence,checkpoint_sequence FROM sessions ORDER BY started_at DESC;'
```

Copy the full phone Application Support directory again (phone must be connected and unlocked):

```sh
xcrun devicectl device copy from \
  --device 00008140-000A31A03E80801C \
  --domain-type appDataContainer \
  --domain-identifier com.kkrausse.workoutanalyze \
  --source 'Library/Application Support' \
  --destination /absolute/private/backup/destination \
  --timeout 60
```
