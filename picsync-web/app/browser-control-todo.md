# Browser Control verification notes

- Browser Control v0.7.0, session `quiet-raven-794`, local gallery fixture.
  A separate execute attempting `getByRole("button", {name: "Zoom in",
  exact: true}).click()` timed out after 30 seconds. The preceding execute had
  shown the viewer, but a fresh snapshot showed the grid and no dialog.
  Expected: viewer remains open between executes. Actual: viewer was closed;
  cause unconfirmed (possibly intervening browser interaction). Recovery:
  re-inspect, open the photo, and perform/verify zoom and close in one execute;
  this passed. No relay reset was needed. If recurring, reproduce with a
  dedicated untouched tab and record dialog lifecycle.
- The local integration probe was initially run twice with unguarded
  `addInitScript` worker/fetch wrappers. Both wrappers executed on navigation,
  producing false double-download/worker-leak counts. This was a test-script
  bug: added an idempotency guard and reran in fresh session `gentle-otter-701`.
  Result: peak ten workers, zero active after completion, one fetch per photo.
# Same-origin navigation during pool verification (2026-09-15)

- Browser Control v0.7.0, session `quiet-walrus-746`, disposable localhost fixture on port 8792.
- Repeated `page.goto` from an authenticated isolated page returned HTTP 403;
  the fixture button wait then timed out. Same-origin `page.reload()` recovered
  and the complete worker-pool verification passed. The public-URL tab still
  returned 403, so its photo failures were not reproduced in this session.
- A direct `page.evaluate(() => location.reload())` produced
  `execution-context/context-destroyed`; the next snapshot recovered normally.
- Expected: navigation retains appropriate fetch metadata. Actual: explicit
  navigation was denied by the app's origin/fetch-site gate. Use authenticated
  fixture reload for this test; no authentication checks were weakened.
- Updating the metrics init script in the same session retained the older init
  script too, so its idempotence guard left `metrics.jobs` undefined. Created a
  fresh session `calm-tiger-293` for the changed instrumentation.

## LAN server-conversion verification (2026-09-15)

- Browser Control v0.7.0, session `tidy-sparrow-927`, direct LAN gallery.
  Unscoped `page.getByRole("status").innerText()` failed with a strict-mode
  violation: it matched both the gallery render status and Browser Control's
  own `BC · RUN` status overlay. Reproduction: open a photo and read that
  unscoped role during execute. Expected: one application status; actual: two.
  Recovery: scope to `page.getByRole("dialog").getByRole("status")` and wait
  for `/^Full resolution/` (a substring also matches "Queued for full resolution").
  Verification then passed without a relay restart: zero workers/WASM/original
  requests, native 6240 × 4168 canvas, ten-photo eager lookahead, and 70 ms to
  display an already-prefetched next photo. Inspected the rendered photo visually.
