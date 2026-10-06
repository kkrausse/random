# Browser verification notes

## 2026-09-14: PDF artifact navigation timeout

- Context: session `lucky-comet-038`, public `/artifacts/tree-rings-9-11-26/` page.
- Browser Control version: `0.7.0`.
- Reproduction: navigate to the artifact, then wait for `#page-1` while deployment has accidentally preserved mktemp's private directory permissions.
- Actual: CLI shell timed out after 20 seconds; follow-up inspection returned title `403 Forbidden`.
- Expected: article loads and the page selector becomes visible.
- Recovery: follow-up execute worked. HTTP inspection identified 403; fixed publish wrapper to set readable/traversable output permissions before rsync. No relay restart needed.
- This was a deployment failure rather than a demonstrated Browser Control defect.
- Verified after republishing: 26 pages, 10 linked contents entries, no mobile horizontal overflow, and successful navigation to page 19.

## 2026-09-20: Relay draining during artifact verification

- Context: attempted a new read-only visual verification of public `/artifacts/tree-rings-9-18-26/` after deployment.
- Browser Control version: `0.7.0`.
- Reproduction: run a bare `browser-control execute --json` that sets a mobile viewport and navigates to the public artifact.
- Actual: command was rejected immediately with `Relay is draining for an explicit restart; retry after it completes`.
- Expected: a session-owned page opens and returns the page title, figure count, and broken-image count.
- Recovery: no forced restart or polling; verified the deployed article and 34-page content through direct HTTP instead. A later visual comparison should retry after the already-requested restart completes.

## 2026-10-06: Tab stayed protected-ui after 1Password inline menu was dismissed

- Context: session `tidy-panda-515`, relay-owned tab on `developer.apple.com/enroll/duns-lookup/`, filling the D-U-N-S lookup form.
- Browser Control version: `0.8.2`.
- Reproduction: `locator.fill()` on the Street Address / Postal Code inputs; 1Password's inline address menu opens on focus.
- Actual: every later execute on that tab failed with `Execution context was destroyed` and `target/cross-extension-page`; `status` kept showing `protected-ui=true` after the user dismissed the menu, including for a no-focus `page.evaluate`.
- Expected: automation resumes once the inline menu is dismissed.
- Recovery: opened a second page with `context.newPage()` and set values via `page.evaluate` plus `input`/`change` events without focusing any field, which never opens the menu. Captured as `scripts/duns-lookup-fill.sh`.
