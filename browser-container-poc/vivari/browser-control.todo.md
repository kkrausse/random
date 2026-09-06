# Browser Control observations

- [x] Continuation, CLI 0.7.0, two port-5192 kernels (`tidy-otter-432` and
  temporary `cosmic-tiger-633`): SQLite contention check passed, but starting the
  first kernel's Vite preview after tearing down the second showed an empty
  pending preview. The existing SW chooses among announced kernel clients and
  can still select the torn-down tab. Re-announcing the first host alone did not
  recover it. Deleting only the temporary test session and navigating the preview
  again restored its heading; five HMR edit/restore cycles and three reloads then
  passed. This is an application multi-kernel preview-routing limitation.

- [x] Continuation, CLI 0.7.0, `tidy-otter-432`: retained session initially
  reported `about:blank`, with previous reports still in CLI state. Navigating
  explicitly to the retained port-5192 harness recovered it. No relay restart.
- [x] Continuation, CLI 0.7.0: one report-read expression referenced `window`
  outside `page.evaluate` and failed `ReferenceError: window is not defined`.
  Corrected to read both reports inside `page.evaluate`; browser state retained.
- [ ] Continuation, CLI/relay 0.7.0, extension 0.0.24, `tidy-otter-432`:
  session returned to `about:blank` again before the combined qualification run.
  Reproduction: inspect session (blank), `page.reload()`, click Boot ->
  `click: Timeout 30000ms exceeded` waiting for the missing button. Doctor reports
  a healthy relay and one relay-owned blank target, no competing connection.
  Cause of the earlier navigation is unknown. Qualification now deliberately
  navigates to its explicit harness origin before inspecting/booting; no reset or
  relay restart. Existing CLI-saved reports survived.

- [x] 2026-09-06, Browser Control CLI 0.7.0, session `tidy-otter-432`, local
  patched harness `http://localhost:5192/`: after a runtime rebuild, executing
  `page.reload()`, clicking Boot, and `page.waitForFunction(() => !!window.probe?.vm)`
  failed with `waitForFunction: Timeout 30000ms exceeded.` Expected a booted
  runtime; observed an indefinite Working state. A short follow-up execute still
  worked. Worker diagnostics reported an error; fetching the newly hashed kernel
  worker returned the host HTML fallback (`200 text/html`). The host server was
  still running its startup-cached asset list; harness HMR disables config reload.
  Recovered by restarting only the POC's own port-5192 server. Middleware now
  reads asset filenames per request. This was an application asset-delivery
  failure observed through Browser Control, not a relay/session failure.
