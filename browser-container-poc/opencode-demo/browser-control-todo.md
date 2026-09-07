# Browser Control execution follow-up

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
