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
