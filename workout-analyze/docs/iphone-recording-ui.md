# iPhone raw recording UI

Status: implemented React slice; physical recording acceptance depends on the native recorder capabilities.

## Capture-first flow

The web app is the phone UI. Home explicitly requests location permission, then starts a cycling session with `waitForReliableLocation`. Heart rate is optional. Once started, the Live screen makes the native recorder state unmistakable and shows:

- authoritative durable raw journal event count from `journal.read.latestJournalSequence` when that independently advertised capability is available;
- normalized recorder observation count (`session.observationSequence`) kept separate from delivered raw journal input and decoded metrics;
- native storage/recorder status and freshness from diagnostics;
- GPS quality and latest raw fix freshness;
- optional heart-rate connection/quality;
- storage failures as a loud unsafe-persistence error;
- metrics-engine failures separately, because raw persistence may continue;
- direct **Stop & save**, plus Pause.

There is no production recording duration in React. The two-minute Core Location operation is only the explicitly labelled diagnostic probe API. Navigation, HMR, and UI reload unsubscribe the page projection but never call a workout stop command. Native recording remains authoritative.

Finish commits locally before the Saved screen. Saved supports GPX and `workoutBundleV1`; the latter is the lossless raw replay source. When `archive.list` and `archive.detail` are advertised, Home exposes native durable saved workouts, including raw count, pinned engine provenance, bounded trail data, and export. Older recorder shells remain usable without archive browsing.

## State and source boundary

`mobile/src/bridge/client.ts` is the single typed transport boundary. It validates native/simulator replies and events, installs atomic snapshots, detects event-envelope gaps, and resynchronizes. It fails closed if the native bridge is absent; simulator data is available only when explicitly requested.

`mobile/src/store.ts` is the sole React projection. It owns lifecycle commands, request errors, polling, the one raw-observation subscription, cursor catch-up, bounded trail projection, and subscription cleanup. Components use narrow Zustand selectors and do not call the bridge, sensors, or an engine.

Raw journal identity remains native `(sessionId, sequence)`, including delivered location payloads, BLE bytes (also when decoding fails), duplicates/rejections, and host lifecycle events when exposed by the native contract. Derived metrics and pinned engine versions remain separate native snapshot fields. The simulator follows the same contract so later exported-stream replay can replace the injected transport without components branching on live versus replay. No replay runtime or second metrics authority exists in this slice.

## Map

The live map uses a small dependency-free Web Mercator renderer. It requests ordinary OpenStreetMap network tiles with attribution and does no bulk caching. The bounded raw GPS trail and rider marker remain visible over an offline background when tiles fail. Route catalogs, matching, segment labels, and laps are intentionally absent.

## Physical acceptance still required

On an updated native shell advertising all recorder capabilities:

1. Start with no heart-rate monitor and wait for reliable GPS.
2. Confirm durable raw count and storage timestamp advance.
3. Lock the phone and switch apps during a short outdoor ride.
4. Return/reload the UI and confirm the same session ID and advancing sequence.
5. Stop & save, reopen through the native archive API, and export `workoutBundleV1`.
6. Inspect the bundle for every delivered GPS/HR/lifecycle row and use it as the next replay fixture.
7. Inject engine and storage failures: engine failure must leave raw-capture status distinct; storage failure must never imply the workout is safely saved.

Simulator tests establish UI lifecycle, capability gating, command shape, reconnect, and cursor behavior. They do not establish iOS background delivery, lock-screen continuity, BLE restoration, or durable SQLite correctness.
