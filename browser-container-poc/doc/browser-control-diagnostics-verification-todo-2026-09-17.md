# Browser Control follow-up: irs-tools diagnostics

- [x] irs-tools Exit verification exceeded the caller's shell timeout.
  - CLI/relay 0.7.0, build `2026-09-05T19:03:42.828Z`; extension 0.0.24, protocol 2.
  - Session `tidy-walrus-087`, attached local `/dashboard` tab. Reproduction: execute a
    click on the editor's `Exit` button followed by waiting for `Edit local copy`,
    with a 20,000ms outer shell timeout and Playwright's default waits.
  - Exact outer error: `Command exceeded timeout of 20000 ms. Retry with a larger timeout if the command is expected to take longer.`
  - Expected: a returned closed-editor assertion. Actual: caller timeout with no result.
  - Recovery: a short page read confirmed the editor was closed and `Edit local copy`
    enabled. A later narrow Exit click with a 5s locator timeout returned successfully.
    Relay remained healthy; no reset/restart/tab replacement was needed. Separate slow
    cleanup waits from actions and set explicit inner deadlines below the outer timeout.
