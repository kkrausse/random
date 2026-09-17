# Browser Control follow-up: GitHub package authentication

Browser Control v0.7.0, Bun-backed CLI. Session `amber-sparrow-394` used the
authenticated GitHub profile to verify public package settings and attempt a
GitHub CLI `read:packages` scope refresh. No credentials or device codes retained
in this report.

- Snapshot labeled an input submit button `commit`, but
  `getByRole('button', {name:'commit', exact:true})` timed out. Clicking its snapshot
  ref succeeded. Expected: snapshot labels usable through refs (working) and a
  clearer distinction from actual accessible names. Prefer refs for this control.
- Calling snapshot immediately after the consent Continue navigation returned
  `Page navigated while snapshot() was capturing; call snapshot() again`.
  A fresh snapshot succeeded. Wait for destination readiness before capture.
- On `/login/device/confirmation`, the requested additional permission was read
  access to GitHub Packages. `Authorize github` remained disabled. Normal clicks
  timed out after 30 seconds and, after bringing the page to the foreground,
  15 seconds. Expected: normal consent control becomes usable; actual: disabled
  state persisted, with no visible explanation in main content. Cause is unknown;
  no permission/disabled-control bypass was attempted. The terminal scope-refresh
  session was stopped. Retry interactively when local package access is needed.

Source publication, package publication, and CI registry installation succeeded;
this follow-up concerns local OAuth/browser interaction only.
