# Workout capture recovery and replay handoff

Status: the physical-phone workout is safely recovered locally, the browser replay pipeline is implemented and matches the recovered checkpoint, and the physical-phone HTTPS bridge/dev runner is verified. Do not commit the capture files; they contain private GPS and sensor data.

> Correction (2026-09-20): the browser replay architecture runs its decoder, projector, engine, checkpoint consumer, and replay controller in the WKWebView/browser runtime. This is not a completed migration of every native engine path to one JavaScript runtime: `ios/WorkoutAnalyze/RecordingEngineHost.swift` still imports JavaScriptCore and creates a `JSContext`. Do not undertake that architecture migration as part of replay or bridge follow-up. See `docs/iphone-recording-contract.md#deterministic-journal-consumption-and-replay` for the implemented replay path.

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

Before the native bridge update, another complete Application Support copy was taken at:

```text
/Users/kkrausse/Documents/repos/kkrausse/random/workout-analyze/data/phone-recovery-2026-09-20/pre-native-bridge-update-2026-09-20T1920/application-support/
```

It contains `recording-v1.sqlite`, `recording-v1.sqlite-wal`, `recording-v1.sqlite-shm`, diagnostics, and the pinned engine. The app was installed as an update without uninstalling. A post-install copy and a live `archive.list` both confirmed that all three finished sessions remained intact.

## Verified recording behavior

Uploaded telemetry independently recorded a successful `workout.finish` commit at `2026-09-20T01:51:04Z`, with no storage failure, no engine failure, no queued journal writes, and no processing backlog. The database+WAL agrees.

The database also contains two earlier short finished test workouts. The app UI nevertheless displayed “No saved workouts.” This was confirmed as an archive presentation/query-flow defect or stale web projection, not lost recording data: physical-device `archive.list` returned all three sessions. The newest result reported 5,113 observations and 5,240 raw events for `ride-F97D601D-65D7-4C5C-9438-1C8D4B3FDB69`. History presentation and refresh/error behavior still need product-level verification and improvement.

## HTTPS development connection resolution

Supported origin:

```text
https://kevins-macbook-pro-2.tail7e28fb.ts.net:8443/
```

Tailscale Serve is healthy and proxies that origin to `http://127.0.0.1:4317`. HTTPS is required for the supported remote development/download path and Web Crypto usage. The requirement and Serve configuration are documented in `docs/iphone-build-delivery.md`.

Historical behavior (resolved; do not use this as a current diagnosis):

1. The URL loads the Workout UI in iPhone Safari.
2. Safari correctly reports “Native bridge unavailable” and registers with the dev runner as kind `unavailable`.
3. In the native shell, Native Recovery shows the HTTPS development URL but remains `loading`/`waiting`; “Use development origin now” does not reach `bridge.hello`.
4. It was initially suspected that `WKSecurityOrigin` was being rejected silently.
5. The runner consequently reported no client of kind `native`.

The physical-device investigation found that origin rejection was not the actual failure. The phone was first still configured for the bundled source. After selecting the documented HTTPS source, `/src/start.tsx` returned HTTP 500 because the Vite process had started before the React dependencies were installed and retained stale dependency resolution. The page's startup reporter recorded `Importing a module script failed.`, so application JavaScript never reached `bridge.hello`. Restarting `bun run mobile:dev` changed `/src/start.tsx` to HTTP 200 and resolved startup.

`WebHost` now emits payload-free diagnostics for rejected messages and has a tested fallback that is permitted only for a registered handler on the main frame when the current page URL is same-origin with the configured development URL. On the successful physical-device run, no fallback diagnostic was emitted: WebKit's security origin matched the configured `:8443` origin exactly.

Verified physical-device runner evidence:

- Native client source: `https://kevins-macbook-pro-2.tail7e28fb.ts.net:8443/`
- `bridge.hello`: protocol 1, shell `0.1.0`, all advertised capabilities available
- `archive.list`: three finished sessions, including 5,240 raw events / 5,113 observations for the recovered ride
- Direct JavaScript evaluation: `[1,2,3].map(x => x * 7)` returned `[7,14,21]`
- Runtime identity: `location.href` was the HTTPS development URL and `typeof window.webkit` was `"object"`
- Validated bridge state: phase `ready`, transport label `Native iPhone shell`

## Replay implementation status

The recovered bundle now runs through the shared TypeScript raw-event decoder, projector, recording engine, checkpoint consumer, and replay controller. The development-only local source serves bounded immutable pages, validates session identity and strict sequence continuity, and is excluded from production. The controller supports load, play, pause, speed, and seek with an injected replay clock and isolated namespace. The recovered ride reaches raw sequence 5,240 and restores parity with the 5,113 checkpoint. See `docs/iphone-recording-contract.md` and `bun run mobile:replay:check`.

## Remaining work

1. Keep the private captures untouched and ignored. Work against a copy when transforming/replaying.
2. Improve and verify History loading: refresh on entry, expose archive failures, provide Retry, and distinguish “archive returned zero rows” from “archive read failed/not loaded.”
3. Add a development-only capture retrieval endpoint/CLI that streams bounded native `journal.read` pages into an ignored local directory, validates session identity and strict continuity, and writes atomically. Avoid returning an entire workout through the runner's bounded result payload.
4. Make remote capture retrieval a first-class developer action: select the newest finished workout or an explicit session, include metadata and checksums, report progress, and never mutate or export-as-live the source workout.
5. Connect `createJournalReadRecordingSource` to a native-backed replay flow when needed. The source adapter exists, but the current completed UI replay uses the immutable development bundle adapter.

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
