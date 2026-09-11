# Browser Control observations

## September 10 continuation: extension disconnected

- Browser Control CLI/relay 0.7.0, build 2026-09-05T19:03:42.828Z.
- Reproduction: `browser-control execute 'return {url:page.url(),title:await page.title()}'`.
- Actual: `Browser Control extension is not connected.` No session/page was acquired.
- `browser-control doctor` confirms matching, reachable relay, disconnected extension,
  zero targets, and no competing connections. Expected: a connected page and session ID.
- Recovery attempted: normal relay-backed execute followed by doctor; requested user
  enable/reload the extension and click its toolbar button on a normal Chromium tab.
  No relay restart or browser storage reset performed.
- Prepared fresh qualification URL: `http://127.0.0.1:43924/`. Browser acceptance
  remains blocked until reconnection; this is not a grep/glob result.
- After the user reported the page open and extension enabled, retried execute
  (navigate to the prepared harness) and doctor: same disconnected-extension error,
  zero targets, matching relay at `http://127.0.0.1:19989`. No page was acquired.
  Requested extension reload and explicit toolbar attachment in that browser/profile.

## Bounded execution when a guest operation never completes

- Browser Control 0.7.0, build 2026-09-05T19:03:42.828Z; extension 0.0.24.
- Session `tidy-comet-605`, localhost server qualification on port 43920.
- Reproduction: await guest server stop followed by `execution.exited` in one
  `page.evaluate`, while guest shutdown throws on missing `internal/fs/rimraf`.
- Actual: shell deadline expired after 30 seconds with no output; an immediate
  `page.locator('pre').textContent()` also exceeded a 20-second shell deadline.
  `status --json` remained responsive. Later short execute and DOM read recovered
  the original page without relay restart/reset.
- Expected: a bounded evaluation or clear pending-operation/cancellation outcome,
  allowing inspection while the guest exit promise remains unresolved.
- Recovery: bounded guest waits with Promise.race, and asynchronous acceptance
  start with a separately inspectable result. Runtime rimraf fix made graceful
  shutdown exit normally. No shared browser state was reset.
