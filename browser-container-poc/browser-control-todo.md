# Browser-control checks

- [x] 2026-09-05, browser-control 0.7.0, session `amber-walrus-881`: CLI was not on PATH;
  recovered using `bunx --bun @opencode-ai/browser-control`.
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
