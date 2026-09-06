# Browser verification blocker

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
