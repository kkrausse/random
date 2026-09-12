# Browser verification blocker

- 2026-09-11, Browser Control 0.7.0, session `lucky-comet-321`, disposable
  localhost:3107 mobile-zoom check: after `page.setViewportSize` and raw CDP
  `Emulation.setDeviceMetricsOverride` (390×844, mobile, DPR 3) plus
  `Emulation.setPageScaleFactor` transitions 1 → 1.5 → 1,
  `getByRole("button", {name:"Keyboard", exact:true}).click()` timed out:
  `canvas ... from main#terminal subtree intercepts pointer events`.
  Expected a toolbar click; actual hit testing targeted the canvas. The initial
  desktop CSS viewport was 487.5×1055 for a requested 390×844, suggesting browser
  zoom/emulation coordinate interaction; no tooling root cause was established.
  Recovered by verifying DOM geometry separately, clearing device metrics and
  page scale, and checking toggle logic with DOM clicks (not trusted touch).
  Real phone keyboard verification remains outstanding. No relay restart.

- 2026-09-08, Browser Control 0.7.0, official Ghostty WASM migration:
  `browser-control execute 'return {url:page.url(),title:await page.title()}'`
  exited with `Browser Control extension is not connected. Load extension/dist in Chromium; it reconnects automatically after relay or browser startup.`
  Expected a disposable verification page/session; none was created. Asked the
  user to connect the extension. Engine tests can proceed independently; live
  WebGL/input verification needs the connection restored.
  `browser-control doctor` confirmed matching CLI/relay 0.7.0 builds, extension
  0.0.24 disconnected, and zero active targets. No relay restart was needed.

- 2026-09-06, Browser Control 0.7.0, session `quiet-otter-585`, disposable local
  auth test instance: navigate to `/sessions` (redirects to `/login`), then navigate
  to the startup fragment-bearing sign-in URL. `waitForURL(.../sessions)` timed
  out at 30 seconds. Expected sign-in; actual page remained on `/login` because
  fragment-only navigation does not rerun the page script. Doctor was healthy.
  Fixed the app to handle `hashchange` as well as initial page load; this was an
  application bug, not a Browser Control failure. No sign-in values retained here.
- Same session/version: `locator('#status').innerText()` failed strict mode on the
  sign-in page because Browser Control's shadow-DOM status badge also has that ID.
  Expected the page paragraph; actual two matches. Recovered with the inspected
  `p#status` locator; the app's native `document.getElementById` is unaffected.

- 2026-09-06, Browser Control 0.7.0, session `lucky-panda-617`: navigating to the
  disposable `http://127.0.0.1:13007/sessions` before Bun finished its initial build
  returned `net::ERR_CONNECTION_REFUSED`. Expected the sessions page; actual was
  Chromium's error page. Retried the same navigation once Bun was listening and
  recovered. This was a test startup race, not a relay failure.
- Same session/version: `getByRole("textbox", { name: "Terminal input" }).focus()`
  failed strict mode because Ghostty exposes both the main contenteditable and
  textarea with that name. Expected one input; actual two. Recovered using the
  inspected `#terminal textarea` locator; no Browser Control change needed.

- 2026-09-05: `browser-control execute 'return { url: page.url() }'` failed with `Missing required flag: --json`.
- Retrying with `--json` failed: `Running relay build 2026-09-05T19:03:42.828Z does not match CLI build 2026-08-23T23:42:36.863Z; restart the relay.`
- Expected: a new browser verification session. Actual: no page/session created. Recovery attempted: added required JSON flag. Align the CLI with the newer running relay before retrying terminal drag-selection/clipboard verification.
