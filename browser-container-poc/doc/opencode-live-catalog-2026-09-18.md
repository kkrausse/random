# Browser editor live catalog — September 18, 2026

Toolkit commit: `9990665` in `browser-agent-toolkit-upstream`.

The retained OpenCode 2.0.3 entrypoint disabled native catalog fetch and exposed
the embedded, retired Ling tiny model. Rebuilt the same frozen registry packages
with `models.fetch: true`. The first browser qualification exposed a second
issue: Effect injected `b3` and `traceparent`, triggering rejected catalog CORS
requests. The supported `HttpClient.TracerPropagationEnabled: false` context in
the embedding entrypoint fixes that without runtime or proxy changes.

## Delivery and checks

- Qualified receipt SHA-256:
  `40789e37d00c5bfbfc9dad88012d7fe3c88a6054df7a2cbd340e1bd2bd676112`.
- Both host verification and browser launch pins updated together.
- Added `opencode-2.0.3-live-catalog-qualified.tgz` to the existing toolkit GitHub
  release `opencode-input-2.0.3`; old release asset preserved. Downloaded the
  published replacement and independently verified archive, receipt, and every
  application output against the updated pins.
- Node 24.18.0 real-worker probe: authenticated health 2.0.3, unauthenticated
  denial, stdin EOF scope shutdown, and natural exit 0 all passed.
- Chat typecheck, packed-consumer smoke, and unit suite passed: 97 passed,
  2 optional integration tests skipped, 0 failed.
- Rebuilt chat package, refreshed irs-tools file dependencies, forced editor
  preparation, and restarted its dev server with `--force` reoptimization.
  No irs-tools tracked source changes were needed. Its existing AGENTS.md edit
  was preserved.

## Native browser result

Browser Control CLI session `quiet-raven-407`, `http://localhost:5173/dashboard`:

- Opened the saved workspace without resetting storage. Existing chat history
  retained, and startup seeded only missing application source.
- Picker lists `Ling 3.0 Flash Fin Free` (`ling-3.0-flash-fin-free`); retired
  `ling-3.0-tiny-free` is absent from available options. Existing chats retain
  their selected model until the user chooses a current one.
- Selected current Ling in session `ses_f4ab81bd3ffeKgEZIvY5CnFI26` and submitted
  “Reply with OK only. Do not use tools or edit files.”
- Native response: `provider.rate-limit`, HTTP 429,
  “Rate limit exceeded. Please try again later.” Stopped automatic retries.
  This is provider quota, not the old `provider.internal` HTTP 400
  “Model is unavailable.” Successful generation remains quota-blocked.
- Editor remains open with current Ling selected. Dev server is running; no
  further local preparation/restart is required for this checkout.

For other existing checkouts, move the previous retained application directory
aside, run toolkit setup, rebuild/reinstall the chat package, rerun editor
preparation, restart the dev server, and close/reopen the editor. Do not reset
browser storage. The toolkit recipe README records these adoption steps.

## Browser Control observation / follow-up

CLI version 0.7.0. During forced Vite reoptimization, a combined Exit/reload/open
execute exceeded the shell's 30-second timeout while the dashboard was loading
its account; a subsequent short inspect succeeded on the same session/page.
An immediate `ariaSnapshot` of collapsed Chat settings also timed out after
5 seconds; expanding Session & model and inspecting again succeeded. No relay
restart, tab replacement, or storage reset was required. Reproduction: reload
during Vite dependency optimization, then await editor controls, or snapshot the
hidden navigation before expanding it. Expected: wait for visible controls;
actual: locator timeout. Follow-up is to use staged readiness and expand hidden
controls before inspection; no demonstrated Browser Control product defect.
