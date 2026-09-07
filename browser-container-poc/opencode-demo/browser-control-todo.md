# Browser Control execution follow-up

- [ ] 2026-09-07 continuation, v0.7.0 `rapid-raven-074`, :5217: after
  interruption the session page was about:blank and host :5217 stopped. Restarted
  only that host. A replacement page encountered OPFS ownership conflict; early
  onLog correctly captured it (evidence/recovery-boot.json). The other attached
  :5217 page was responsive at Launching OpenCode, holding the original lease.
  Navigated replacement to about:blank, adopted the sole :5217 target, reloaded.
  Browser Control then warned “session default page was closed; created a new
  page” despite successful reload/OPFS restore. No storage reset or relay restart.
  Subsequent reload succeeded. Inspect session/target identity before continuing.
  Latest fixed-short profile had unexpected trusted input events and stale PIDs;
  do not treat it as qualified comparative evidence. Need exclusive typing window.

- [ ] Profiling follow-up, Browser Control v0.7.0, `rapid-raven-074`, :5216:
  inspecting the second same-origin tab with `evaluate` returned `Target crashed`;
  navigating that crashed tab returned `goto: Page crashed`. The selected demo
  still evaluated normally. Closing only the crashed duplicate succeeded; reload
  of the selected tab still encountered unavailable guest persistence. No storage
  reset. Investigate the stale origin owner separately from keyboard latency.
- [ ] Worker CDP profiling: `Target.attachToTarget` followed by
  `Target.sendMessageToTarget` on the returned non-flattened session failed with
  `No session with given id`. Expected routing to that worker. Recovery: use
  Playwright `page.workers()` evaluation for worker counters; main-page CDP works.
  Same version/session/origin as above; no relay restart.

- [ ] TUI profiling harness stall on :5217, same version/session: shell profile
  completed (96 keys), then Launch OpenCode rendered Muse Spark. `profile.js`
  TUI execution exceeded its 240-second outer shell timeout without a receipt;
  a subsequent simple page evaluation also exceeded 15 seconds. Do not count
  this as measured keyboard latency: the blocked stage was not recorded.
  `session reset rapid-raven-074` released the owned tab. Two minimal execute
  retries then failed `connectOverCDP: Timeout 15000ms exceeded` after WS connect.
  Doctor showed compatible CLI/relay/extension and eight preexisting crashed
  user targets. User explicitly authorized a relay restart (other connected
  session `tidy-walrus-391`); restart succeeded. Subsequent execute twice reported
  `Browser Control extension is not connected`. Need extension reconnection
  before further browser profiling. Do not restart/close unrelated user tabs.

- [x] V2 model-response wait, Browser Control v0.7.0, `rapid-raven-074`, :5216:
  `waitForFunction: Timeout 90000ms exceeded`. Reproduction: launch a prefilled
  prompt and press Enter as soon as its text first renders, then wait for a
  terminal row whose trimmed text exactly equals the response marker. First
  readback showed the prompt still in the input; focusing the terminal and
  pressing Enter submitted it. A second exact-row wait timed out because the
  successful response row also contained sidebar context text. Readback confirmed
  the actual model response and completion timing. Use settled input and match
  terminal columns/content rather than whole-row equality. No Browser Control
  malfunction or relay recovery was needed.

- [ ] Browser Control v0.7.0 overlay ID collision, session `rapid-raven-074`,
  `http://127.0.0.1:5216/`: `page.locator('#status').innerText()` fails with
  `strict mode violation` because Playwright finds both the demo status and the
  Browser Control overlay's open-shadow-root `id="status"`. Expected one app
  status; actual two matches. Reproduce by reading that locator during execute.
  Recovery passed using `page.evaluate(() => window.demo.phase)`; no reload or
  relay restart. Consider namespacing overlay IDs to avoid app-selector collisions.

- [x] Investigate `waitForFunction: Timeout 30000ms exceeded` with Browser Control
  v0.7.0, session `rapid-raven-074`, isolated `http://127.0.0.1:5216/`.
  Reproduction: boot demo, directly spawn the real CLI via `vm.spawn('bun', ...)`,
  type a provider search, press Control+C, await the CLI process exit status.
  Expected: process exits and Start re-enables. Actual: renderer cleared but
  exit promise did not settle; Browser Control's wait correctly timed out.
  Readback confirmed the page remained responsive, and the search screenshot
  confirmed keyboard input. Recovery: Stop, reload only the owned tab, use guest
  interactive `sh` to own foreground signals. Final `accept.js` passes input,
  Control+C, relaunch, reload, and forced Stop/recovery. No relay restart or
  browser storage reset was needed. No remaining Browser Control defect inferred.
