# Browser-control checks

- [x] 2026-09-24, browser-control CLI/relay 0.8.2, extension 0.0.25, IRS local port 5002, session `irs-workspace-ui-verify`: an initial `execute` selecting a saved-workspace row exceeded the shell's 30-second timeout (`Command exceeded timeout of 30000 ms`). Expected prompt selection within the timeout; a short subsequent snapshot showed the same live tab/dialog and clicking a fresh ref succeeded. No relay restart or tab replacement.
  A later `waitFor` timed out after the app reported `Workspace clear failed while removing /workspace/node_modules: ENOTEMPTY`; a retry timed out because it expected a restored status while the app instead displayed `The editor is not ready to save`. These were app failures and an overly narrow wait predicate, not evidence of a lost browser target. A short DOM read diagnosed the issue; closing the dialog, exiting and reopening the editor reached Ready. Future scripts should wait for success **or** an alert and return the failure immediately.

- [ ] 2026-09-17 UTC, browser-control 0.7.0 (CLI/relay build
  `2026-09-05T19:03:42.828Z`), irs-tools local integration on port 5193:
  `browser-control execute 'return {url:page.url(),title:await page.title()}'`
  failed with `Browser Control extension is not connected`. Expected a fresh
  session page; no page/session was acquired. `doctor` confirmed a reachable,
  matching relay, disconnected extension and zero active targets. Requested that
  the user reconnect the extension; no relay restart or browser state reset.

- [x] 2026-09-17 UTC, browser-control 0.7.0, session `brisk-comet-900`,
  `http://127.0.0.1:19437/`: clicking New chat then immediately filling/clicking
  Send raced asynchronous chat creation. Waiting for the expected assistant
  marker returned `waitFor: Timeout 90000ms exceeded`; a fresh panel read showed
  `ChatError: Chat is not ready to send`, with no new model request. Expected
  a ready new session before send. Recovery: dismissed the application error,
  resent after the session had finished creation, and verified the exact reply
  and `outcome: succeeded`. No relay restart/page replacement; this was an
  application readiness/automation synchronization issue.

- [ ] Same session/version: plain `snapshot()` returned only the host TODO page
  while an open editor panel and conversation were present and interactable.
  Reproduction: inspect with `snapshot()` then compare
  `ariaSnapshot(page.locator(".oc-editor-panel"))` and locator `innerText()`.
  Expected compact snapshot to include the editor's controls; actual omitted
  the panel. Recovery: used the targeted aria snapshot and stable role locators.
  No relay reset or page replacement. Investigate compact snapshot visibility
  filtering for this full-viewport editor layout.

- [x] 2026-09-09, browser-control 0.7.0, session `amber-wombat-312`, localhost:4317:
  startup wait returned `waitForFunction: Timeout 30000ms exceeded`. The script
  incorrectly passed `{timeout:180000}` as Playwright's second argument (the page
  function argument), leaving the default timeout active. Retried with `undefined`
  as argument two and timeout options as argument three; startup and source loading
  succeeded. Expected an extended wait; actual was a caller-signature mistake.
  No relay/page reset needed.

- [x] 2026-09-09, browser-control 0.7.0, session `amber-wombat-312`, todo demo
  at localhost:4316: Playwright `checkbox.check()` reported `Clicking the checkbox
  did not change its state`. The React-controlled checkbox waits for the backend
  mutation before rendering its new state, so the immediate check assertion raced
  that response. Expected eventual completion; a subsequent status wait and page
  reload verified the checkbox remained checked. Use click followed by an explicit
  application-state wait for this asynchronous control. No relay reset or page
  replacement was necessary; this is a test synchronization issue.

- [x] 2026-09-06, browser-control 0.7.0 / extension 0.0.24, session `amber-walrus-881`,
  localhost workspace: after connecting the new multiplexed shell, typing a terminal probe and waiting for
  `TERMINAL_OK` returned `waitFor: Timeout 90000ms exceeded`. A fresh read showed `Shell error: Error: Failed to open PTY`.
  Expected an interactive shell; the guest image had no `/dev/pts` mount. This was an application prerequisite failure,
  not a Browser Control transport failure. Mounted devpts through Guest command and verified terminal input, Ctrl-C,
  resize, and shell exit/reopen. The helper now mounts devpts automatically; an in-guest probe verified that behavior
  after explicitly unmounting and removing `/dev/pts`. No relay reset was needed.

- [ ] Same follow-up/session: after cold dependency optimization finished, a preview-only reload followed by a
  heading wait returned `waitFor: Timeout 200000ms exceeded`; a subsequent guest-command result wait returned
  `waitFor: Timeout 90000ms exceeded`. Expected rendered preview and responsive guest commands. Actual: blank
  React root despite several HTTP 200 assets, and guest input queued in the browser PTY. Fresh snapshots and
  page evaluations remained responsive; no relay failure or page replacement occurred. Recovery attempted:
  waited for dependency metadata, reloaded only the preview, inspected bridge stats and PTY queue lengths.
  Preserve this as an unresolved guest/runtime stall rather than labeling it a Browser Control defect.

- [x] Profiling continuation, browser-control 0.7.0 / extension 0.0.24, session
  `amber-walrus-881`, localhost workspace: changing only the preview iframe URL
  inside a long `page.evaluate` returned `evaluate: Execution context was destroyed,
  most likely because of a navigation.` Diagnostics reported `mainFrameNavigations=0`,
  `pageClosed=false`, `urlChanged=false`. Expected the parent evaluation to survive
  child navigation. A short subsequent snapshot confirmed the VM and preview still
  present. Recovery: split preview reload into setup evaluation, UI click, readiness
  wait, and fresh result evaluation; no workspace navigation or relay reset.
  Verified recovery: three reloads and the following HTTP/edit phases completed.

- [x] HMR evidence capture, browser-control 0.7.0, same session: the first inline capture had
  `SyntaxError: Parser error`; moving it to `--file` exposed a separate caller error,
  `The "cb" argument must be of type function. Received undefined`, from awaiting callback-based `fs.writeFile`.
  Used `fs.writeFileSync` instead. Evidence JSON and screenshot were saved successfully; no page/session replacement.

- [x] Bridge continuation, same session: dynamic import of `/serial-bridge.js?import` failed with
  `net::ERR_CONNECTION_REFUSED` after the host server stopped. Host curl confirmed port 5173 was down.
  With user permission, restarted host Vite. Its reconnect behavior navigated the tab to
  `chrome-error://chromewebdata/`, discarding the VM despite the full-reload event guard. Reopened the
  same localhost URL and booted again. Keep the host server alive during long guest runs.

- [x] Bridge continuation, browser-control 0.7.0, same localhost session: `click: Timeout 30000ms exceeded`
  on **Connect preview**, with `element is not enabled`. Updating the host entry/public files triggered Vite's full-page
  reload and discarded the ephemeral iframe; the next snapshot correctly showed Start VM. This was an application
  development reload, not a relay failure. Booted again and installed a temporary `vite:beforeFullReload` listener in
  the host page that rejects development reloads while validating the live VM. Guest preview HMR remains enabled.

- [x] Continuation, same 0.7.0 session `amber-walrus-881` at localhost:5173: the installed
  `/Users/kkrausse/.local/bin/browser-control` is on the non-interactive shell PATH and works directly.
  `locator.fill()` on xterm's helper textarea returned successfully but did not send a serial command;
  use `pressSequentially()` followed by `press("Enter")`. A single approximately 2.8 KB base64 paste
  exceeded the guest terminal's line capacity and did not create the destination file. Recovery:
  append base64 in 160-character chunks, decode, and compare host/guest SHA-256. The hashes matched.
  These are terminal input constraints; no relay/session failure occurred in these interactions.

- [x] 2026-09-05, browser-control 0.7.0, session `amber-walrus-881`: CLI was not on PATH;
   recovered using `bunx --bun @opencode-ai/browser-control`.
- [x] Follow-up: user installed `/Users/kkrausse/.local/bin/browser-control`, a wrapper executing the global CLI with
  Bun. Verified `browser-control doctor` and a serial interaction through this wrapper. It reports CLI/relay 0.7.0,
  build `2026-09-05T19:03:42.828Z`, extension 0.0.24. Use `browser-control` directly for continuation.
- [x] Navigating the session-owned page to `http://localhost:5173/` returned
  `goto: net::ERR_CONNECTION_REFUSED`. Expected the workspace shell; the handed-off Vite
  server was no longer listening. Started the requested dev server and repeated the same
  navigation; the workspace heading and Start VM button were verified successfully.
- [ ] 2026-09-05, browser-control 0.7.0 / extension 0.0.24, session `amber-walrus-881`:
  after successful root login and POPCNT regression in the session-owned localhost page, an execute that typed
  `bun run build` and awaited a terminal result returned `Browser Control relay is not reachable at
  http://127.0.0.1:19989`. Doctor immediately reported a healthy matching relay and connected extension.
  A subsequent terminal read timed out after 30 seconds; the next snapshot was empty and the page's only frame was
  `about:blank`. Expected the existing VM and serial output to remain attached; actual session-owned page was lost.
  Recovery: inspect session, navigate back, restart the ephemeral VM, and use short execute calls around long guest work.
- [ ] In the recovered VM, a 120-second terminal wait after Ctrl-C timed out (`waitFor: Timeout 120000ms exceeded`).
  The page and iframe stayed present, but the guest did not produce the expected build-exit marker. This is currently
  a guest/emulator responsiveness diagnosis, not evidence of a browser-control transport fault. Next: retry in a fresh VM
   with JavaScriptCore's JIT disabled. At handoff, navigation back to the workspace shell succeeded and stopped the stalled VM.
- [ ] Follow-up, same CLI/extension and session: corrected `BUN_JSC_useJIT=false` TypeScript run was active and
  inspectable at 22:38:00 UTC. At the next execute the page was already `about:blank`; journal `startUrl` confirms this
  preceded the attempted terminal interaction. CLI shell timeout was 20 seconds, and the journal later recorded
  `pressSequentially: Timeout 30000ms exceeded` waiting for the serial iframe. Doctor reported healthy, with the
  session-owned page at `about:blank`. Expected the background guest process and page to survive between short calls;
  actual VM and ephemeral trace were lost before a result was captured. The trigger is not established. Recovery:
  confirmed blank snapshot, then recreate the VM and keep the test page foregrounded. Do not count the interrupted run
  as a no-JIT success or workload timeout.
