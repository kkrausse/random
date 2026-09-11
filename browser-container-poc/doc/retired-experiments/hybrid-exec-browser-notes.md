# Retired hybrid execution: historical Browser Control qualification note

- Session `cosmic-wombat-621`, isolated public local page `http://127.0.0.1:5221`.
- One boot wait failed with `waitForFunction: Timeout 30000ms exceeded`.
- Cause: harness script passed `{timeout:180000}` as Playwright's second
  argument (evaluation argument), rather than the third options argument.
- Recovery: inspect unchanged page, use `(predicate, null, {timeout:180000})`.
- Expected: bounded long guest boot wait. Actual: ordinary default 30s timeout.
  No relay reset, browser replacement, or runtime defect inferred.
- Browser Control version: `0.7.0`.

Second observed timeout: `accept-browser.js` waited 180000ms for shell status 23,
but the application returned status 1 after its worker-side native deadline.
Recovery: inspect retained page/logs and run a single binary native call with
native-event tracing. Expected Browser Control behavior is to report the failed
assertion; no Browser Control bug or relay recovery is indicated. This is tracked
here to distinguish application failures from browser tooling failures.
