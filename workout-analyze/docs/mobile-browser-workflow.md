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

## Recording simulator

Open <http://localhost:4317/?simulator=1> for the in-memory recording simulator.

This runs the same mobile React UI used in the iOS WKWebView, with an in-memory replacement for the native bridge. Vite provides hot updates while editing the UI.

Exercise permission → start → pause/resume → finish/save → history → saved detail. Simulated permissions, sensors, exports, and build controls do not invoke iOS services. The simulator uses a short fixed route and fixed metrics; it does not provide a continuously advancing ride. Finishing creates a synthetic saved workout. Reloading resets simulator data.

The browser correctly labels native recording/sensor capabilities unavailable; it does not pretend Bun can record iPhone sensors. The installed iPhone bridge remains the authority for recording and its live device archive. Native DuckDB support is not implemented yet, so the installed shell clearly omits workout-library and segment-analysis entry points.

## Actual recorded ride replay

Open <http://localhost:4317/?replay=local> to use the development replay screen. Replay supports play/pause, speed control, and seeking, using the real TypeScript decoder/projector/metrics pipeline against an immutable captured journal.

The server automatically selects a capture when exactly one ZIP exists in `data/local-replays/`. To select another capture explicitly, start the server with:

```sh
WORKOUT_LOCAL_REPLAY_ZIP=/absolute/path/to/ride.zip bun run mobile:dev
```

Restart the server after changing the capture; the development replay endpoint caches its source.

Replay remains an isolated timeline tool. The default local-host history now reads all three recovered workouts directly rather than using the one exported replay bundle.

## Development loop

1. Use the simulator at phone size for layout and navigation.
2. Use local replay for realistic route geometry and metrics playback.
3. Edit the mobile React UI/store and inspect updates in the browser.
4. Verify WKWebView rendering and native behavior on the phone as appropriate.

Phone-size Chromium emulation does not reproduce WebKit, native GPS/BLE, locked-screen recording, SQLite durability, native share sheets, or build installation.

Segment/loop list and detail browsing, workout matches, and explicit analysis rebuild are available through the default local Bun host. Live segment recognition and native Swift DuckDB are not implemented.

## Verification on 2026-09-22

The recovered archive endpoint returned all three finished sessions with 5,113/111/12 normalized observations and 5,240/118/0 raw events. The bounded detail endpoint returned the first 200 of 5,113 observations with a valid continuation cursor. The browser-side database adapter and shared domain queries returned 170 workouts, 47 routes, and route/workout details from the existing 1,134 traversals. Visible browser verification was blocked by the Browser Control relay's draining state; see `browser-control-todo.md`.
