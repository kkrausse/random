# Browser verification blocker — 2026-09-07

- Browser Control CLI/package/relay: 0.7.0, build 2026-09-05T19:03:42.828Z.
- Context: standalone explicit fixture harness at http://localhost:5194; no authenticated page or native OpenCode service involved.
- Reproduction: `browser-control execute 'await page.goto("http://localhost:5194"); return await snapshot();'`
- Actual: `Browser Control extension is not connected. Load extension/dist in Chromium; it reconnects automatically after relay or browser startup.` No session/page was returned.
- Expected: inspect fixture UI, create/select a session, choose fixture model, send/stream/abort, verify history after refresh.
- Recovery/diagnosis: `browser-control doctor` confirms reachable matching relay, disconnected extension, zero active targets, no competing connections. No relay restart or alternate browser driver attempted.
- Follow-up: once the extension is attached, repeat the UI workflow. API fixtures, TypeScript and browser bundle are independently checked; visible browser behavior remains unverified.
