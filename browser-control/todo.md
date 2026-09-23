# Browser Control follow-ups

## 2026-09-23 — click action hangs after dispatch in local workout UI (CLI 0.8.2)

- CLI/relay 0.8.2, build `2026-09-20T05:32:28.650Z`; extension 0.0.25 / protocol 2.
- Context: adopted user-owned `http://localhost:4317/` tab, session `workout-ui-inspect`; desktop-served Workout Analyze mobile UI. Doctor reports healthy relay and one active target.
- Reproduction: inspect the landing snapshot, then `await ref("e2").click(); return {url:page.url(), snapshot:await snapshot()}` with a 20-second CLI deadline. The library screen appeared, but the execute exceeded the deadline. In that library, `page.getByRole("button", {name:"9/19/2026 · cycling 16.31 km · 43:22"}).click()` timed out after 30 seconds at `performing click action`; `ref("e4").click({timeout:10000})` reproduced the same timeout. The target was visible, enabled, stable, and unobstructed by the DOM hit test.
- Expected: a click on the visible button resolves after dispatch and the next page can be inspected.
- Actual: the Playwright click promise remained pending even though the landing click had changed the rendered screen. A subsequent `locator.evaluate(x => x.click())` returned promptly, and a fresh snapshot showed the workout detail. The URL remained `/` because this app switches screens in place.
- Recovery: `doctor`, short follow-up snapshots, DOM hit test, and a narrow DOM click after verifying the target. No relay restart, database operation, or session replacement. Investigate whether the browser/app's main-thread work or click completion semantics cause the pending action.

## 2026-09-22 — relay rejects all executes while indefinitely draining (CLI 0.7.0)

- **Resolved for current verification (2026-09-23):** CLI/relay 0.8.2 (build `2026-09-20T05:32:28.650Z`) with extension 0.0.25/protocol 2 successfully created session `irs-save-restore-verify`, navigated its session-owned tab to `http://localhost:5002/`, read snapshots, and clicked `Edit local copy`. The old drain condition no longer reproduces. The editor test itself is blocked separately by `OPFS already owned by another Vivari kernel` from another live client on the same origin; this is not a Browser Control relay failure.
- CLI/relay build `2026-09-05T19:03:42.828Z`, extension 0.0.24 / protocol 2.
- Context: localhost:5002 editor smoke test; `doctor --json` reports connected extension, zero active targets, and seven CDP clients in `status --json`. Relay process had been running since September 16.
- Reproduction: `browser-control execute --json 'return { url: page.url(), title: await page.title() }'` fails before opening a session-owned tab. `browser-control relay restart` also fails.
- Actual: both commands return `Relay is draining for an explicit restart; retry after it completes`. `status` and `doctor` remain healthy apart from the lack of targets; no `Requested` restart appears in the available lifecycle index after September 8.
- Expected: a fresh execute opens a target, or a managed restart completes/returns a bounded diagnostic instead of leaving the relay permanently unavailable.
- Recovery attempted: doctor/status, one managed restart, and one fresh execute after rebuilding the app; no force stop or browser state deletion. Need inspect the live relay drain state and ownership of the seven CDP clients before recovery.

## 2026-09-17 — custom CDP tracing completion wedges execute (CLI 0.7.0)

- CLI/relay build `2026-09-05T19:03:42.828Z`, extension 0.0.24 / protocol 2.
- Context: session `tidy-walrus-087`, attached local app at localhost:5173/dashboard.
- Reproduction: `context.newCDPSession(page)`, subscribe to `Tracing.dataCollected`,
  start `Tracing.start` with ReportEvents and timeline/V8 categories. In a later
  execute register `once('Tracing.tracingComplete', resolve)`, send `Tracing.end`,
  then await that promise. The code did not put a deadline around that promise.
- Actual: execute exceeded the shell's 150s deadline. Subsequent executes, including
  a state-only read, exceeded 20s; reset returned `Session reset timed out waiting
  for active execute in tidy-walrus-087`. Status remains healthy and state contains
  `traceDone`; no trace file was produced. App independently completed startup.
- Expected: custom-session trace events reach the subscriber; execution should be
  cancellable after its CLI caller exits. Investigate whether browser-scoped trace
  events are routed differently from page-session events.
- Recovery: doctor/status, short read, reset, and user detach/reattach did not release
  the old execute. No relay force-stop used. A fresh CLI session `quiet-raven-407`
  works and opens the authenticated app. Old execute remains unresolved.
- Separate reproducible issue in fresh session: `context.newCDPSession(page)` then
  `send('Profiler.enable')` returns `Protocol error (Profiler.enable):
  {"code":-32601,"message":"'Profiler.enable' wasn't found"}`. Detached that CDP
  session. Check custom CDP target routing/capabilities before further profiling.
- Cleanup from the fresh session: `Tracing.end` returned `Tracing is not started`;
  Chromium is not still recording. The old execute's completion wait remains stuck.
- Next capture must bound event waits and save partial evidence before awaiting
  completion. Wall-time application instrumentation was saved separately; no CPU
  profile is claimed.

## 2026-09-17 — acceptance locator recovery (CLI 0.7.0)

- Context: session `brisk-comet-900`, isolated local TODO candidate on port19437.
- Reproduction: call `page.getByRole('button', {name:'Model', exact:true}).click()`
  after inspecting raw button elements, rather than their accessibility roles.
- Actual: shell execution exceeded 30000ms; a later DOM inspection showed the
  Model element has `role="combobox"` and is disabled. The first attempt also
  targeted a control inside a closed Session & model details section.
- Expected: choose the actual accessible role and check enabled state before
  attempting an action. This was an agent locator mistake, not evidence of a
  Browser Control product defect.
- Recovery: short read-only execute succeeded; opened the details summary and
  inspected role/disabled state. Preserved page, session and relay. Continued via
  New chat and the real composer. No Browser Control code change required.
- Another inspection used ambiguous `locator('aside')`, yielding the normal
  `strict mode violation ... resolved to 2 elements`; narrowed to
  `.oc-editor-panel` and continued successfully.
