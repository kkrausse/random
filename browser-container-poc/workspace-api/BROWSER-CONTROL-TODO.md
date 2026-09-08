# Browser-only API qualification — connection blocker resolved

2026-09-07: CLI 0.7.0 session `tidy-raven-945` connected successfully. Contract
and search now pass; see `INTEGRATION-HANDOFF.md` and demo browser receipt.

One initial awaited `window.contract.run()` returned `evaluate: Execution context
was destroyed, most likely because of a navigation` with pageClosed=false,
urlChanged=false and mainFrameNavigations=0. Short follow-up still read the same
contract page; reload plus starting the promise in-page and reading its result
recovered observation. Boot then exposed an application asset relocation defect,
fixed in the authored Vite config. Later awaited contract/search calls succeeded.
No relay restart, alternate driver or storage clearing was used.

The Browser Control overlay also adds a role=status; use `p#status` or the chat
region's status instead of an unscoped strict getByRole("status") locator.

## Historical disconnected attempt

September 7, 2026, browser-control **v0.7.0**: `browser-control execute
'return {url:page.url(),title:await page.title()}'` failed before creating a page:
“Browser Control extension is not connected. Load extension/dist in Chromium;
it reconnects automatically after relay or browser startup.” No relay restart,
profile reset, alternate browser driver or storage clearing was attempted.

Expected: a session-owned page usable for the explicit fresh contract origin.
Actual: extension disconnected (also reported by both parallel consumer agents).
Next: connect the extension and use the CLI exclusively to visit the contract
server; run `window.contract.run()` then `window.contract.search()` from page
evaluation. Record returned results and actual distribution version. Browser-only
OPFS failure/reload/lease contention, SW routing and Vite same-document HMR remain
unverified until then. Headless worker proofs are recorded separately.
