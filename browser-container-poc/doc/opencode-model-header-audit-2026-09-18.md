# Local versus browser model request audit — 2026-09-18

## Result

The same Ling model succeeds locally and through the browser after correcting
the consumer's stale upstream URL. The previous interpretation of the browser's
429 as a generally exhausted provider quota was insufficient.

Consumer fix: `d0233ad`,
`/Users/kkrausse/Documents/repos/kkrausse/irs-tools/src/server/editorProviders.ts`.

## Observed requests

Captured native local requests through a temporary public `http.request` hook,
the browser's decoded model-header envelope through Browser Control, and the
host proxy's final fetch arguments through temporary host instrumentation.
Credential values were never logged; comparison to the saved host Zen key was
performed in memory and recorded as a boolean. Unlisted header values were
redacted. No model request bodies were captured.

| Property | Local | Browser proxy before fix |
| --- | --- | --- |
| OpenCode version | 2.0.7 | pinned 2.0.3 |
| Model | `opencode/ling-3.0-flash-fin-free` | same |
| Upstream URL | `https://opencode.ai/inference/openai/v1/chat/completions` | `https://opencode.ai/zen/v1/chat/completions` |
| Authorization | matches saved host Zen key | matches same saved host Zen key |
| Content-Type | `application/json` | same |
| User-Agent | `opencode/latest/2.0.7/cli` | `opencode/stable/2.0.3/vivari-opencode-server` |
| x-opencode-client | `cli` | `vivari-opencode-server` |
| x-opencode-org-id | present | absent |
| x-opencode-project/session | present | present, guest values retained |
| x-session-affinity/id | present | present |
| accept-encoding | absent at native hook | host adds `identity` |
| content-length | present at native hook | left to host fetch |
| Response | 200 | 429 `FreeUsageLimitError` |

The guest envelope contains `Bearer public`; the host deliberately replaces it
with its saved credential. Guest protocol/header identity survives the envelope
and reconstruction. Host adds its configured User-Agent and encoding policy.

## Controlled comparison

All comparisons used the same model and harmless `OK` prompt. Retry was disabled
for the controlled local probes.

1. Native local request: 200, `OK`.
2. Current inference URL, remove only `x-opencode-org-id`: 200, `OK`.
3. Keep local headers, change only the request URL to `/zen/v1`: 429.
4. Change only the consumer's upstream base URL to `/inference/openai/v1`:
   browser returns `OK`, with original 2.0.3 client identity and no org header.

This isolates the old upstream route as sufficient to reproduce the failure;
it does not establish the provider's internal reason for different rate-limit
behavior on its two routes.

## End-to-end verification

Resubmitted the user's original green-title request in the browser. Ling completed
`glob`, `read`, and `edit` calls and changed the browser-local landing page title
to `text-green-500`. Vite HMR refreshed `/src/routes/landing.tsx`; the preview's
`Process transcripts faster` heading computed to `oklch(0.723 0.219 149.579)`.

Consumer proxy test passed (10 assertions), including the current upstream URL,
host credential replacement, native header retention, and body/path forwarding.
Temporary instrumentation imports and the Browser Control request listener were
removed. User-owned AGENTS.md remains untouched. The browser is left with the
successful conversation and green title. Validation covers Ling's OpenAI-compatible
HTTP route; other model protocols were not exercised by this audit.
