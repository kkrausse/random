# Browser Control follow-up

- [ ] 2026-09-21: Local mobile preview blocked by relay draining (Browser Control 0.7.0).
  - Context: fresh session, intended page `http://localhost:4317/`; no session or page was created. The former simulator query is no longer a user-facing mode.
  - PATH selected the older Node-installed CLI (build `2026-08-23T23:42:36.863Z`), which required `--json` and then reported a mismatch with relay build `2026-09-05T19:03:42.828Z`.
  - Recovery: used the Bun-backed `/Users/kkrausse/.local/bin/browser-control`; doctor confirmed matching CLI/relay builds and connected compatible extension.
  - Reproduction: run that CLI's `execute 'return { url: page.url(), title: await page.title() }'`.
  - Exact error, also repeated on navigation attempt: `Relay is draining for an explicit restart; retry after it completes`.
  - Expected: create a visible page and return a continuation session. Actual: execute exits 1; status reports zero active targets and seven CDP clients. This session did not request a restart or force-stop anything.
  - 2026-09-22 recurrence: two Bun-backed CLI attempts to open the integrated `http://localhost:4317/` workflow at 390 × 844 returned the same draining error. `browser-control doctor` reported matching 0.7.0 builds, compatible connected extension, zero active targets/CDP clients, and 74 disconnected retained sessions. HTTP endpoint and domain-query verification succeeded, but no visible page could be created.
  - 2026-09-22 annotated-history verification: an attempt to open the retired `?simulator=1` URL at 390 × 844 (which should now resolve to the normal local-host home) was rejected by the same draining error before any page/session existed.
  - 2026-09-22 broader layout follow-up: Bun-backed Browser Control 0.7.0 again rejected `execute 'await page.goto("http://localhost:4317/")'` with `Relay is draining for an explicit restart; retry after it completes`. The HTTP local host responds, but no browser page or session was created. The Node-installed 0.5.1 CLI still selects an incompatible build; no relay restart was attempted because this relay is shared. Expected: open the local app for visual inspection; actual: no visible page is available.
