# Local mobile browser workflow

The browser and iPhone WKWebView run the same mobile application. In the default browser workflow, local Bun provides read-only access to the recovered iPhone recording archive and a primitive DuckDB host for the normalized workout library and analysis. See [the architecture north star](architecture-north-star.md) for the remaining native-host work.

Run from `/Users/kkrausse/Documents/repos/kkrausse/random/workout-analyze`:

```sh
bun run mobile:dev
```

## App navigation and layout

Open **<http://localhost:4317/>**. This is the integrated local-host application, not a fixture screen. It exposes:

- the three finished workouts in the already-recovered iPhone storage at `data/phone-recovery-2026-09-20/application-support/recording-v1.sqlite` (including its essential WAL and SHM),
- the normalized DuckDB workout library, and
- detected segments and loops with effort detail.

The Bun host copies the complete recovered SQLite trio to a temporary working directory before opening it. The recovered files are never written. DuckDB is accessed through generic query/execute/bulk/transaction primitives; workout and analysis SQL and the rebuild orchestration remain shared TypeScript. In Chrome/Brave DevTools, enable the device toolbar (macOS: Command–Shift–M with DevTools open) and select an iPhone preset or a responsive 390 × 844 viewport.

Set `WORKOUT_RECOVERED_ARCHIVE=/absolute/path/to/recording-v1.sqlite` to use another complete recovered archive. Keep its sibling `-wal` and `-shm` files beside it.

The browser correctly labels native recording/sensor capabilities unavailable; it does not pretend Bun can record iPhone sensors. The installed iPhone bridge remains the authority for recording and its live device archive. Native DuckDB support is not implemented yet, so the installed shell clearly omits workout-library and segment-analysis entry points. The old `?simulator=1` and `?fault=…` query parameters are intentionally ignored and open this normal local-host application. Synthetic transports remain test helpers only.

## Actual recorded ride replay

Open <http://localhost:4317/?replay=local> to use the development replay screen. Replay supports play/pause, speed control, and seeking, using the real TypeScript decoder/projector/metrics pipeline against an immutable captured journal.

The server automatically selects a capture when exactly one ZIP exists in `data/local-replays/`. To select another capture explicitly, start the server with:

```sh
WORKOUT_LOCAL_REPLAY_ZIP=/absolute/path/to/ride.zip bun run mobile:dev
```

Restart the server after changing the capture; the development replay endpoint caches its source.

Replay remains an isolated timeline tool. The default local-host history now reads all three recovered workouts directly rather than using the one exported replay bundle.

## Development loop

1. Use the local Bun host at phone size for layout, archive, and analysis navigation.
2. Use local replay for realistic route geometry and metrics playback.
3. Edit the mobile React UI/store and inspect updates in the browser.
4. Verify WKWebView rendering and native behavior on the phone as appropriate.

Phone-size Chromium emulation does not reproduce WebKit, native GPS/BLE, locked-screen recording, SQLite durability, native share sheets, or build installation.

Segment/loop list and detail browsing, annotated normalized-workout maps, effort selection, and workout navigation are available through the default local Bun host. **Import & rebuild analysis** first imports new or changed recovered iPhone workouts from durable saved observations, then rebuilds route analysis over the unified archive. Repeating it is idempotent. Saved iPhone history opens the corresponding normalized `iphone:<session-id>` workout and displays matched overlays automatically when matches exist. The originals remain unchanged. Live segment recognition and native Swift DuckDB are not implemented.

## Verification on 2026-09-22

The recovered archive endpoint returned all three finished sessions with 5,113/111/12 normalized observations and 5,240/118/0 raw events. Ingestion produced 2,602/109/8 canonical GPS samples and retained all 170 Garmin activities, for 173 activities total. Shared analysis produced 31 routes and 1,313 traversals. It found zero route traversals for each of the three iPhone activities; the UI reports that result rather than promising an overlay. A second ingestion imported zero and marked all three unchanged. A temporary-copy `build:data` verification retained all three iPhone rows. Visible browser verification was blocked by the Browser Control relay's draining state; see `browser-control-todo.md`.
