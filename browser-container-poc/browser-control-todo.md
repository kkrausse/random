# Browser-control checks

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
