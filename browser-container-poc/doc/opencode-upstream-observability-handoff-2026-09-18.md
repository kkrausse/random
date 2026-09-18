# Handoff: make browser-editor upstream regressions observable and fixable

## User goal and scope

User asked how to make upstream issues easier to notice and fix after startup
and model-request failures. Proposed improvements are below; **they have not
been implemented**. This handoff is the next-task starting point.

Recommended first slice: safe last-request diagnostics in the editor plus a
repeatable native-versus-proxy audit command. Then add real-generation release
qualification and clearer readiness/retry UX.

## Repositories and instructions

- Consumer: `/Users/kkrausse/Documents/repos/kkrausse/irs-tools`
- Toolkit: `/Users/kkrausse/Documents/repos/kkrausse/browser-agent-toolkit-upstream`
- Chronological reports: `/Users/kkrausse/Documents/repos/kkrausse/random/browser-container-poc/doc`
- Read each repository's AGENTS.md before editing. Commit only your own paths;
  do not push. Consumer has a pre-existing user-owned AGENTS.md modification:
  leave it untouched and uncommitted.
- Use Bun/TypeScript and existing UI patterns. Browser automation must use the
  Bun-backed `browser-control` CLI and its skill, not browser tool/MCP APIs.
- Do not clear browser storage, reset saved edits, or restart the shared relay.
- Do not delegate unless requested or required by applicable instructions.

## Current working state

Two independent issues were fixed:

1. **Premature health-check failure** — toolkit commit `8aedf38`.
   `opencode-chat/src/recipe.ts` had a 30-second health readiness deadline, but
   one 3-second fetch timeout escaped the loop. It now retries request failures
   within the deadline, bounds attempts/backoff by remaining time, preserves
   Effect interruption, and includes the last failure as the timeout cause.
   Regression tests cover transient fetch failure, timeout, HTTP 503, deadline
   exhaustion, response-body cancellation, and backoff cancellation.
   Chat suite: 99 pass, 2 optional skips; typecheck/build passed.

2. **Stale upstream model URL** — consumer commit `d0233ad`.
   `src/server/editorProviders.ts` now uses
   `https://opencode.ai/inference/openai/v1` instead of
   `https://opencode.ai/zen/v1`. Its existing proxy test asserts the new route.
   Consumer proxy test: 10 assertions passed.

Browser session: `quiet-raven-407`, `http://localhost:5173/`.
The editor was left connected with a successful Ling conversation and a green
browser-local landing-page title. Model:
`opencode/ling-3.0-flash-fin-free`. The agent performed real glob/read/edit calls;
Vite HMR refreshed `src/routes/landing.tsx`. Preview heading
`Process transcripts faster` has `text-green-500`, computed color
`oklch(0.723 0.219 149.579)`. Inspect current state before acting; it may change.

Consumer dependencies were rebuilt/reinstalled during startup debugging and dev
was started with `bun run dev --force`. Check the current process before
starting another server.

## Critical findings: do not repeat the earlier diagnosis

A 429 did **not** establish that the user's selected model was generally out of
quota. The same model worked in native local OpenCode.

Observed native local OpenCode 2.0.7 request:
- URL: `https://opencode.ai/inference/openai/v1/chat/completions`
- User-Agent: `opencode/latest/2.0.7/cli`
- `x-opencode-client: cli`
- `x-opencode-org-id` present
- Authorization matched the saved host Zen key (equality checked in memory).

Observed browser pinned OpenCode 2.0.3 request before correction:
- URL: `https://opencode.ai/zen/v1/chat/completions`
- User-Agent: `opencode/stable/2.0.3/vivari-opencode-server`
- `x-opencode-client: vivari-opencode-server`
- Organization header absent
- Authorization matched **the same** saved host Zen key.
- Guest protocol headers survived the envelope and host reconstruction.

Controlled comparison, same Ling model and tool-free OK prompt:
1. Native local request: 200, OK.
2. Native current URL with org header removed: 200, OK.
3. Keep native headers, change only URL to `/zen/v1`: 429.
4. Change only consumer upstream URL: browser generates successfully, then
   completes the user's green-title request with tools.

This isolates the old route as sufficient to reproduce failure. It does not
prove the provider's internal reason for differing rate-limit behavior.
Validation covers Ling's OpenAI-compatible HTTP route; other model protocols
were not exercised. Do not extrapolate that one `/inference/openai/v1` endpoint
is correct for every provider protocol.

The startup logs' unauthenticated `GET /` 401 is a separate Vivari startup probe:
`vendor/vivari/packages/core/src/workers/kernel-worker.ts`, `waitServing()`.
It is not evidence that the authenticated `/api/health` request was rewritten.

## Proposed implementation

### First: last model request diagnostics

Add a collapsible editor panel showing:
- Exact model/provider and guest OpenCode version.
- Actual upstream hostname/path and protocol.
- Status, structured provider error type, elapsed time, Retry-After.
- Credential source label, never its value.
- Allowlisted client-identity headers and org-header presence.
- Correlation ID linking guest/browser events and host proxy logs.
- Last successful request metadata for comparison with failures.

Keep prompts, bodies, credentials, raw envelopes, and arbitrary header values
out of diagnostics. Existing header envelopes contain a guest authorization
value; they are not safe to log wholesale. Use the existing authenticated
diagnostic infrastructure and bounded retention rather than adding a parallel
logging system. Determine how host events can safely reach the matching editor
session: current host requests have their own run IDs and use session IDs for
correlation. Do not assume current browser run IDs already propagate end to end.

### First: repeatable parity audit

Suggested interface (not yet implemented):

```sh
bun editor:doctor --model opencode/ling-3.0-flash-fin-free
```

Compare real native and proxied model requests, producing a redacted diff of
endpoint/protocol, model ID, relevant headers, credential equality, response
status, and structured error. Keep the request prompt harmless and tool-free.
Bound attempts, disable retries for controlled probes, and clean up hooks and
listeners afterward. Avoid altering the user's global OpenCode configuration.

Exercise the real request path. Mock proxy tests established forwarding
correctness but did not detect a stale production endpoint. A re-created manual
HTTP request is not automatically equivalent to native OpenCode's request.

### Next: accurate status and retry UX

Distinguish:
- Editor connected: server/plugin/catalog/preview readiness passed.
- Model request verified: actual generation succeeded for the relevant model
  and configuration.
- Last request failed: actionable upstream details.

Provide an explicit Test selected model control rather than silently making
potentially paid requests on every startup. Define when verification becomes
stale (model/provider/route/credential configuration changes).

Render Retry-After meaningfully. Observed 429 responses advertised roughly
seven hours, while chat showed only Retry 2. Give clear wait information and a
Stop control; preserve cancellation. Do not just increase retry counts.

### Next: versioned upstream compatibility qualification

Keep guest version, provider routes, supported protocols, and qualification
results together. Guest-build, catalog, transport, or upstream-route changes
should trigger transport tests, an explicit real generation smoke test, and a
browser tool-edit test with independent preview verification.

Centralize and allow configuration of upstream routes for quick repairs.
Investigate using supported upstream provider metadata rather than a separate
hardcoded route mapping. Do not guess protocol routes or silently upgrade the
qualified guest artifact without rebuilding/verifying its provenance.

## Relevant implementation locations

Toolkit:
- `opencode-chat/src/server.ts`: host proxy, envelope reconstruction, credential
  replacement, `model.request`, `model.response`, `model.error` diagnostics.
- `opencode-chat/src/model-headers.ts`: public http.request plugin and bounded
  base64 header envelope; outer request belongs to Clerk app authentication.
- `opencode-chat/src/recipe.ts`: readiness checks and orchestration.
- `opencode-chat/src/opencode-launch.ts`: pinned guest contract/configuration.
- `opencode-chat/test/model-headers.test.ts`: envelope tests and optional real
  guest qualification.
- `opencode-chat/test/server.test.ts`: streaming proxy tests.
- `opencode-chat/test/diagnostics.test.ts`: ingestion/redaction/retention tests.

Consumer:
- `src/server/editorProviders.ts`, `src/server/editorProviders.test.ts`
- `scripts/dev.ts`: VIVARI_MODEL_API_KEY override or saved
  `~/.local/share/opencode/auth.json` Zen key; host credentials stay host-side.
- `server.ts`, `scripts/editorLogs.ts`, `src/editor/`
- `tmp/editor/diagnostics/events.jsonl` and rotated file (bounded retention).

## Investigation commands and notes

```sh
# Run in consumer root; narrow by event/run to avoid dumping all historical logs.
bun editor:logs --event model.error
bun editor:logs --run RUN_PREFIX

browser-control execute --session quiet-raven-407 \
  'return await ariaSnapshot(page.locator(".oc-editor"))'

opencode run --model opencode/ling-3.0-flash-fin-free \
  --title "Model transport check" \
  "Reply with OK only. Do not use tools or modify files."
```

Load the OpenCode skill before working on its integration/configuration. Use V2
docs. Local 2.0.7 configured plugins require a **directory** entrypoint; passing
a single `.mjs` file was ignored with a log warning. Public session
`http.request`, `http.response`, and `retry` hooks enabled the controlled audit.
Bundled plugins can change import.meta.url; use an explicit output path for
temporary audit artifacts rather than assuming a sibling of the source file.

Temporary redacted audit scripts/output from this session are under:
`/private/var/folders/t_/x48jtnps7n5_0g_pt9xpvbg00000gn/T/opencode/model-header-audit`.
Treat these as disposable investigation material, not production dependencies.
The native test plugin's last mode was `legacy`, intentionally rewriting to the
failing route. Do not reuse it unchanged for a normal success check. Temporary
host imports and Browser Control request listeners were removed.

## Supporting reports

- `/Users/kkrausse/Documents/repos/kkrausse/random/browser-container-poc/doc/opencode-startup-recovery-2026-09-18.md`
- `/Users/kkrausse/Documents/repos/kkrausse/random/browser-container-poc/doc/opencode-model-header-audit-2026-09-18.md`
- Original failure handoff:
  `/Users/kkrausse/Documents/repos/kkrausse/irs-tools/docs/browser-editor-startup-handoff-2026-09-18.md`

Report commits in random: `6e4c383` (startup), `0aa5de0` (header audit).

## Acceptance criteria for the next slice

- A failing request can be traced from editor UI to its real upstream route and
  structured error without exposing secrets or request contents.
- The parity audit detects a deliberately mismatched endpoint and reports it
  clearly; transient failures and cancellation terminate predictably.
- UI distinguishes connected from successfully generated, without automatic
  billable probes.
- Changes are verified using real native/browser requests in addition to
  focused tests, and reports state exactly which protocols/models were tested.
