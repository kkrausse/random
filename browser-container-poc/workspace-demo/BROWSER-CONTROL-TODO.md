# Browser Control verification follow-up

Integration recheck 2026-09-07: bare CLI execute still fails with the same exact
extension-disconnected error below. Doctor confirms matching 0.7.0 relay, zero
targets, no competing connections. No session/page was acquired. Real demo is now
4311; contract is 43917. Run the contract first after reconnect, then follow
`../workspace-api/INTEGRATION-HANDOFF.md`. No relay restart or alternate driver.

- Date: 2026-09-07.
- CLI/package/relay: `@opencode-ai/browser-control` 0.7.0,
  build `2026-09-05T19:03:42.828Z`; relay and CLI match.
- Safe page context: local demo `http://127.0.0.1:4310/`; no browser session or
  page was acquired and no form data was used.
- Reproduction:
  `browser-control execute 'await page.goto("http://127.0.0.1:4310"); return await snapshot()'`
- Exact error: `Browser Control extension is not connected. Load extension/dist
  in Chromium; it reconnects automatically after relay or browser startup.`
- Expected: demo page opens and returns an inspectable snapshot.
- Actual: command exits 1 before page access.
- Recovery attempted: `browser-control doctor` confirms reachable matching relay,
  disconnected extension, zero active targets, and no competing connections.
  No relay restart or alternate browser driver was used.
- Follow-up: reconnect the installed Browser Control extension and verify the
  README fixture walkthrough, mock chat session/send, filesystem access after
  runtime stop, explicit snapshot/reopen, and honest real-mode missing-manifest
  failure. Use one returned CLI session ID for subsequent inspect/act/verify calls.
