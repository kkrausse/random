# Browser Control observations

- [x] 2026-09-06 WASM renderer, CLI 0.7.0, `lucky-falcon-533`, :5202:
  inspection mistakenly used `window.probe.shells` (undefined); correct API is
  `window.shells.sessions`. Guest remained running; corrected the inspection.
  Later the user's software-update reboot stopped the server/browser/relay.
  First recovered execute warned that relay state/refs reset, and `window.shells`
  was undefined on about:blank. Inspected URL, restarted only :5202, navigated
  explicitly and booted without resetting OPFS. Re-delivered owned probe assets
  and reran actual keyboard/resize/destroy plus independent libc probes: PASS.

- [x] 2026-09-06 TUI audit, CLI 0.7.0, `quiet-raven-411`, owned :5198:
  evidence-copy code using `fs.copyFileSync('browser-container-poc/vivari/.runtime/patched-build.json', ...)`
  failed ENOENT because the relay cwd is `browser-container-poc`, not the caller's
  repo root. Relative JSON writes had landed in a nested `browser-container-poc/`.
  Expected caller-relative paths; actual paths are relay-relative. Recovery:
  repeated evidence capture with absolute paths, inspected the screenshot, and
  removed only the misplaced audit JSON. Browser/kernel state stayed intact;
  no relay restart or page reload. This is runner path handling, not a browser
  session failure. Always use absolute host evidence paths in execute code.

- [ ] 2026-09-06 tool qualification, CLI 0.7.0, `tidy-otter-432`: after
  bridge-driven work, `await page.reload(); return page.url()` returned
  `about:blank`, while the original qualification runtime remained connected
  to the dev relay. Explicit navigation restored the harness but produced two
  harness pages. Expected the retained page to reload; actual default target
  had changed. Deterministic observation: compare `page.url()`,
  `context.pages()` and `vv status` before/after the reload; the trigger for
  target replacement is still unknown. Recovery: uniquely identified the old
  task-owned page by its saved registry-session checkpoint, closed only that
  duplicate, and booted the current page. Tool qualification and SDK saved-session
  recovery passed afterward. No storage reset or relay restart.

- [x] Next continuation, CLI 0.7.0, `tidy-otter-432`: first inspect again
  returned about:blank; explicit 127.0.0.1:5192 navigation returned
  `net::ERR_CONNECTION_REFUSED` because the scoped dev server had stopped.
  Restarted that patched server, navigated and booted explicitly; host probe
  passes. Expected retained page; cause of blank page remains unresolved.

- [ ] 2026-09-06 OpenCode continuation, CLI/relay 0.7.0 (build
  2026-09-05T19:03:42.828Z), extension 0.0.24, `tidy-otter-432`:
  sending a 28 MB bundle as a `page.evaluate` argument failed with
  `evaluate: Target page, context or browser has been closed`. The next short
  inspect returned `about:blank` and warned that the relay connection was lost
  and re-established. No deliberate relay restart. Expected a mounted file;
  actual session page was replaced. Use same-origin fetch for large delivery.
  Status subsequently showed two relay-owned targets for this session plus old
  5192 user targets. A newly booted localhost kernel had no durable persistence
  while an origin Web Lock remained held. Switched this continuation to the
  separate `http://127.0.0.1:5192/` origin; real adapter persistence then worked.
  Old tabs were retained. Root cause of page/target duplication is unresolved.
- [x] Same continuation: relay cwd was `browser-container-poc`, so an initial
  relative host read failed ENOENT. Corrected its path; final runner fetches the
  bundle from the harness instead. A diagnostic read of an oversized failed
  mount also returned ENOENT. SDK mount/writeFile had acknowledged a >1 MiB
  kernel write that was dropped with `kernel fs request too large for the shared
  data region`. This is an application transport limitation. Final delivery
  chunks writes and verifies the assembled SHA-256 inside the guest.

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
