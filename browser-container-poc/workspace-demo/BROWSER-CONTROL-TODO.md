# Browser Control verification follow-up

## Sample UX follow-up (2026-09-07)

After the vanilla one-click flow passed, user requested a React host/provider.
Before reloading into that implementation, both explicit sessions
`tidy-badger-184` (localhost:4311) and `brisk-wombat-706` (127.0.0.1:4311)
failed with “Browser Control extension is not connected. Load extension/dist
in Chromium; it reconnects automatically after relay or browser startup.”
Doctor: matching 0.7.0 relay reachable, extension disconnected, zero targets,
zero connected sessions, no competing connection. Expected stop/flush/close via
the existing UI; calls failed before page access. No workspace was reset and no
relay restart attempted. User was asked to reattach the local tab. React-host
browser acceptance needs a fresh pass; prior vanilla results do not prove it.

CLI/relay 0.7.0, build 2026-09-05T19:03:42.828Z; session `brisk-wombat-706`,
user-owned local demo 4311. A one-shot `--target-url 4311` execute inspected the
correct tab; the next execute without that selector read the session's blank
default and timed out looking for Activity log. Adoption subsequently warned
“The session default page was closed; created a new page” despite returning the
user page's content. Expected stable adopted target. Recovery: consistently pass
both `--session brisk-wombat-706 --target-url 4311`; no relay restart or user-tab
closure. Also use DOM-scoped IDs: unscoped Playwright `#status` crosses the relay's
overlay shadow root and matches two elements. These locator/target problems are
separate from the demo's preexisting workspace-open timeout.

## Resolved: connected browser acceptance

2026-09-07: explicit CLI session `tidy-raven-945` successfully drove contract
43917 first, then demo 4311. Browser runtime packaging and client UI defects
were fixed and verified. Real OPFS restoration, authenticated guest chat, actual
Muse edit with same-Document HMR, and active interruption passed. See
`tests/REAL-APPS-EVIDENCE.md` and `tests/browser-evidence/receipt.json`.
The remaining sections are historical disconnected attempts. An initial
execution-context error and recovery are recorded in the API sibling's todo.

## Recheck after user reloaded the extension

2026-09-07, parent session: targeted execute from the reproduction below still
exits 1 with the same extension-disconnected error. Doctor confirms the daemon is
reachable at `127.0.0.1:19989`, matching CLI/relay 0.7.0 build, zero targets and
zero connected sessions. Installed extension artifact is version 0.0.24; the
browser's actual loaded extension version remains unknown. User-reported reload
has not restored the connection. No page was acquired or modified.

## Fresh verification attempt after user enabled a tab

2026-09-07, session `ses_f8141b0d9ffejLl9746UvFfL4m`, after commit `11b06b0`:

- Loaded browser-control skill first. Bare `browser-control execute 'return
  {url:page.url(),title:await page.title()}'` exited 1 with the exact
  extension-disconnected error below.
- After doctor/status, reproduced once with `browser-control execute --target-url
  127.0.0.1 'return {url:page.url(),title:await page.title()}'`: identical error,
  exit 1. Expected access to the user's enabled local tab; actual failure occurs
  before selection or page access. No session/page acquired or tabs altered.
- Doctor: endpoint `http://127.0.0.1:19989` reachable; CLI/relay 0.7.0, matching
  build `2026-09-05T19:03:42.828Z`; extension disconnected, protocol unknown,
  active/child/relay-owned/unhealthy targets all zero, connected sessions zero.
  Status: `connected:false`, `rejectedConnections:0`, empty target inventory.
- Recovery needed: load or reload the installed `extension/dist` unpacked
  extension in Chromium, then click its Browser Control toolbar button on the
  intended normal web tab. The relay-backed initial call and one retry did not
  recover the connection. No relay restart or alternate driver was used.
- HTTP checks passed: demo 4311 and contract 43917 both returned 200; no restart
  needed. Contract run/search and all browser lifecycle gates remain unexecuted.


Integration recheck 2026-09-07, replacement session `ses_f814d0710ffeif21SAWfQ2WDQG`:
`browser-control execute 'return { url: page.url(), title: await page.title() }'`
still fails with the same exact
extension-disconnected error below. Doctor confirms matching 0.7.0 relay, zero
targets, no competing connections. No session/page was acquired. Real demo is now
4311; contract is 43917. Run the contract first after reconnect, then follow
`../workspace-api/INTEGRATION-HANDOFF.md`. No relay restart or alternate driver.

- Date: 2026-09-07.
- CLI/package/relay: `@opencode-ai/browser-control` 0.7.0,
  build `2026-09-05T19:03:42.828Z`; relay and CLI match.
- Safe page context: local demo `http://127.0.0.1:4310/`; no browser session or
  page was acquired and no form data was used.
- Reproduction:
  `browser-control execute 'await page.goto("http://127.0.0.1:4310"); return await snapshot()'`
- Exact error: `Browser Control extension is not connected. Load extension/dist
  in Chromium; it reconnects automatically after relay or browser startup.`
- Expected: demo page opens and returns an inspectable snapshot.
- Actual: command exits 1 before page access.
- Recovery attempted: `browser-control doctor` confirms reachable matching relay,
  disconnected extension, zero active targets, and no competing connections.
  No relay restart or alternate browser driver was used.
- Follow-up: reconnect the installed Browser Control extension; run the real
  contract `window.contract.run()` and `window.contract.search()` at 43917 first.
  Then verify the real demo at 4311: seed/start/deliver/launch, same iframe Document
  across manual edit/restore and model edit, active-prompt interrupt, and
  stop/flush/close/reopen/dependency delivery/restart. Use one returned CLI session
  ID for subsequent inspect/act/verify calls. Headless HMR and fresh-worker disk
  snapshot restoration now pass; they do not satisfy these browser gates.
