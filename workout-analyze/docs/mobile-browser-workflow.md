# Local mobile browser workflow

Target architecture: the browser and iPhone WKWebView run substantially the same application, with local Bun substituting for the Swift host behind a shared contract. The simulator and replay modes below are current stepping stones toward persistent, integrated workflows. See [the architecture north star](architecture-north-star.md) for goals and unresolved decisions.

Run from `/Users/kkrausse/Documents/repos/kkrausse/random/workout-analyze`:

```sh
bun run mobile:dev
```

## App navigation and layout

Open <http://localhost:4317/?simulator=1>. In Chrome/Brave DevTools, enable the device toolbar (macOS: Command–Shift–M with DevTools open) and select an iPhone preset or a responsive 390 × 844 viewport.

This runs the same mobile React UI used in the iOS WKWebView, with an in-memory replacement for the native bridge. Vite provides hot updates while editing the UI.

Exercise permission → start → pause/resume → finish/save → history → saved detail. Simulated permissions, sensors, exports, and build controls do not invoke iOS services. The simulator uses a short fixed route and fixed metrics; it does not provide a continuously advancing ride. Finishing creates a synthetic saved workout. Reloading resets simulator data.

Opening the URL without `?simulator=1` deliberately reports an unavailable native bridge in a desktop browser.

## Actual recorded ride replay

Open <http://localhost:4317/?replay=local> to use the development replay screen. Replay supports play/pause, speed control, and seeking, using the real TypeScript decoder/projector/metrics pipeline against an immutable captured journal.

The server automatically selects a capture when exactly one ZIP exists in `data/local-replays/`. To select another capture explicitly, start the server with:

```sh
WORKOUT_LOCAL_REPLAY_ZIP=/absolute/path/to/ride.zip bun run mobile:dev
```

Restart the server after changing the capture; the development replay endpoint caches its source.

Replay is separate from the simulated recording/history workflow. It does not populate the simulator's saved-workout history or the original web app's archive.

## Development loop

1. Use the simulator at phone size for layout and navigation.
2. Use local replay for realistic route geometry and metrics playback.
3. Edit the mobile React UI/store and inspect updates in the browser.
4. Verify WKWebView rendering and native behavior on the phone as appropriate.

Phone-size Chromium emulation does not reproduce WebKit, native GPS/BLE, locked-screen recording, SQLite durability, native share sheets, or build installation.

As of 2026-09-21, mobile segment browsing, matching, automatic laps, and live comparisons are not implemented. Neither local mode adds those features or imports the desktop analysis dataset.

## Verification on 2026-09-21

The development server served the mobile entry successfully, and the local replay metadata endpoint resolved the existing capture with 5,240 journal events. Visible browser verification was blocked by the Browser Control relay's draining state; see `browser-control-todo.md`.
