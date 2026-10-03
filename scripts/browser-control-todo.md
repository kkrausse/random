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
