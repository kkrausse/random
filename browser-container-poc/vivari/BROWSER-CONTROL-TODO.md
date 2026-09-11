# Browser Control observations

## Bounded execution when a guest operation never completes

- Browser Control 0.7.0, build 2026-09-05T19:03:42.828Z; extension 0.0.24.
- Session `tidy-comet-605`, localhost server qualification on port 43920.
- Reproduction: await guest server stop followed by `execution.exited` in one
  `page.evaluate`, while guest shutdown throws on missing `internal/fs/rimraf`.
- Actual: shell deadline expired after 30 seconds with no output; an immediate
  `page.locator('pre').textContent()` also exceeded a 20-second shell deadline.
  `status --json` remained responsive. Later short execute and DOM read recovered
  the original page without relay restart/reset.
- Expected: a bounded evaluation or clear pending-operation/cancellation outcome,
  allowing inspection while the guest exit promise remains unresolved.
- Recovery: bounded guest waits with Promise.race, and asynchronous acceptance
  start with a separately inspectable result. Runtime rimraf fix made graceful
  shutdown exit normally. No shared browser state was reset.
