# Browser Control validation notes

## September 15, 2026 — official Effect client validation

- Browser Control CLI: 0.7.0; session `rapid-badger-571`.
- Page: local TODO demo at `http://127.0.0.1:4391/`.
- A combined New chat → fill → Send execute timed out after 30 seconds because
  session selection remounted the composer after it was filled. Expected: send
  an enabled composer; actual: replacement composer empty and Send disabled.
  Recovery: inspect the completed selection, then fill and send. That succeeded.
  Future scripts should wait for the selected session/empty-chat heading first.
- A wait for literal text `assistant` timed out after 90 seconds. The actual
  transcript labels are `article "assistant message"` and visible `OpenCode`.
  A fresh ARIA snapshot confirmed the completed read tool, answer and successful
  idle record. Use the observed article role/name for subsequent verification.
- These were automation timing/locator errors, not relay or application failures.
