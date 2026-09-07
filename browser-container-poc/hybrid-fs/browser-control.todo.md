# Browser Control observations (v0.7.0)

All observations concern only `tidy-walrus-391`, `http://127.0.0.1:5220/`.
No relay reset, existing-tab adoption, or protected-origin operation was used.

- Resolved caller error: `page.waitForFunction(predicate, {timeout:180000})`
  timed out at 30 seconds. Playwright's second argument is the predicate arg,
  not options. Recovery: `waitForFunction(predicate, null, {timeout:180000})`.
  Expected long wait; actual default timeout; no browser state lost.
- Resolved caller error exporting evidence: `await fs.mkdir(path,{recursive:true})`
  raised `TypeError: The "cb" argument must be of type function. Received undefined`.
  CLI `fs` is Node's callback module. Recovery: `fs.promises.mkdir/writeFile`.
- Resolved page-runner race: immediately after iframe navigation, `body` could
  be null. The asynchronous startup probe failed on `.body.innerText`. Added
  `.body?.innerText`; resumed the same Linux boot manually without reloading.

These are reproduction-script corrections, not confirmed Browser Control bugs.

## Unresolved: session page lost across harness restart

After the harness announced `Command cancelled because the server restarted`
for the owned static server, the same CLI session returned `about:blank` and no
`window.fsSpike`/acceptance state. Expected the browser-owned page to remain
available; actual session page was blank. The first diagnostic capture failed
reading `.phase`, then a fresh read confirmed the blank URL. Exact cause and
whether the browser/relay itself restarted are unconfirmed. No relay restart or
session reset was requested by this agent. Recovery: restart only the `:5220`
static server and run `scripts/start-browser.js` in this same named session.
Raw filesystem/HMR PASS receipts had already been saved locally before this
event. The protected `:5213` session was not inspected or controlled.
