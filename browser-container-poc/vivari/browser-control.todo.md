# Browser Control observations

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
