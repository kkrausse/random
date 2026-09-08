# Browser-only API qualification blocked

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
