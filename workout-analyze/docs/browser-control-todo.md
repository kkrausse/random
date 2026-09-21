# Browser Control follow-up

- [ ] 2026-09-21: Local mobile preview blocked by relay draining (Browser Control 0.7.0).
  - Context: fresh session, intended page `http://localhost:4317/?simulator=1`; no session or page was created.
  - PATH selected the older Node-installed CLI (build `2026-08-23T23:42:36.863Z`), which required `--json` and then reported a mismatch with relay build `2026-09-05T19:03:42.828Z`.
  - Recovery: used the Bun-backed `/Users/kkrausse/.local/bin/browser-control`; doctor confirmed matching CLI/relay builds and connected compatible extension.
  - Reproduction: run that CLI's `execute 'return { url: page.url(), title: await page.title() }'`.
  - Exact error, also repeated on navigation attempt: `Relay is draining for an explicit restart; retry after it completes`.
  - Expected: create a visible page and return a continuation session. Actual: execute exits 1; status reports zero active targets and seven CDP clients. This session did not request a restart or force-stop anything.
