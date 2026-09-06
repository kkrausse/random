# Browser-hosted model loop — paused 2026-09-06

## Subsequent transport decision and implementation

The discussion after `c7c05a4` selected a deployment-neutral Bun HTTP proxy in
the web app server, with OpenCode/provider handling remaining in browser workers.
The first implementation replaces the fixed Vite Zen proxy and removes host
auth-file discovery. It derives upstream bases offline from the pinned SDK
catalog and forwards SDK-selected paths. See [current transport documentation](model-transport.md)
for architecture, commands, credential configuration, and mock-only verification.
No provider calls or existing credentials were used during that implementation.
Credential ownership and real model qualification are still open.

The remainder of this file records the historical `c7c05a4` checkpoint; its
Vite proxy/auth-file details and restart instructions have been superseded.

## Resume with a design discussion

User explicitly requested a breakpoint and context reset before deciding model
transport/authentication. Do not resume provider calls or enable credentials
automatically. No successful model-selected tool loop has been established.

Long-term requirements from the discussion:

- OpenCode SDK, sessions, filesystem and tool execution stay in browser workers.
- A very small proxy could live on the AWS box hosting the application.
- Transport should be pluggable: direct requests where supported, optional proxy,
  and clarify what an optional direct OpenCode connection would mean.
- Prefer delegation to OpenCode for provider protocols/model behavior. Avoid
  inspecting or rewriting model request bodies in our transport.
- Running OpenCode on the production server is not feasible for this project.
- Decide credential ownership, login/key entry and proxy authentication separately.
  Browser-side login/key entry is a possible later direction, not implemented.
- Suggested direction for discussion: keep provider handling in the browser SDK;
  swap transport/base URL between direct access and a transparent streaming proxy.
  Determine provider routing, header/auth handling, cancellation, and deployment
  constraints before implementation. This is a proposal, not a settled design.

Follow-ons: Vite running alongside the agent with visible preview HMR; a minimal
prompt/events UI attached to the embedded SDK; later evaluate `bun-web-terminal`
(Ghostty Web) for terminal presentation. The real OpenCode web client needs its
expected server API, which has not been qualified here. TUI compatibility remains
separate from xterm/Ghostty rendering and from the current stdin/output bridge.

## Implemented checkpoint

- `probes/opencode/model.mjs`: pinned SDK `0.0.0-dev-19167` submits a real prompt
  in a new `/workspace/opencode-model-*` fixture, using the official build agent
  and registered tools. Plugin hooks observe calls and provider status without
  replacing tool handlers. Fixture permissions allow read/edit/shell/glob/grep.
- Intended success requires all five tools, an assertion-failing test before the
  model edit, the same test passing afterward, an unchanged test file, streamed
  text/tool events, and a successful session terminal event. These success-path
  assertions are implemented but **not yet exercised by a successful model**.
- Waits for plugin activation before listing models (otherwise the list was empty).
  Waits for the terminal event after `sessions.wait`, since event delivery lags it.
- Saves `trace.ndjson` and `receipt.json` or `failure.json` in the guest fixture.
  Prints success only after host close; model failures return nonzero. Disables
  SDK retries for this bounded qualification; guest timeout 180s, harness 210s,
  bridge default 240s for model probes.
- `vv probe --model [MODEL_ID]` packages/transfers through the existing digest-
  checked path. Defaults to `opencode/big-pickle`, and rejects models with nonzero
  catalog input/output pricing. No provider credentials travel through `vv`.
- Experimental Vite proxy forwards only `/__model/zen/chat/completions` to
  `https://opencode.ai/zen/v1/chat/completions`, using Vite's streaming proxy.
  It substitutes authorization and strips cookie/origin/referer headers; request
  bodies are not transformed. This dev transport is hard-coded, not yet the
  proposed production/pluggable architecture. Static `dist` has no proxy.
- Proxy defaults to `Bearer public`. An optional `VIVARI_MODEL_AUTH_FILE` can read
  an OpenCode API-key entry from a host JSON file. **Authenticated forwarding is
  unqualified and not enabled at this handoff.** Restart Vite after config/auth
  changes. Do not infer approval for credential use from the presence of this code.
- Project `.env` defaults `VIVARI_DIST=.runtime/patched/packages/core/dist`.
  Vite explicitly loads it, because plain `bun run build` initially did not carry
  Bun's loaded environment into Vite's Node process. Exported values override it.
  `bun run dev --port 5192` and `bun run build` now select the patched runtime.

## Actual evidence and blockers

1. Direct guest SDK request failed with `provider.transport: Failed to fetch`.
   A minimal browser fetch established the reason: the upstream OPTIONS response
   lacks `Access-Control-Allow-Origin`; Chrome rejects its CORS preflight.
2. Public host-side diagnostics for Big Pickle and MiMo V2.5 Free both returned
   HTTP 429 `FreeUsageLimitError`. No model output was produced.
3. With the dev proxy, the **browser SDK** reached upstream and received HTTP 429,
   `provider.rate-limit`, `session.step.failed`, and `session.execution.failed`.
   Failure receipt was saved and the host closed cleanly. This proves the error
   transport/event path, not streamed provider tokens or tool-loop success.
4. Retained failure session: `ses_f8848d3ceffezeH7wMPclBhfAF`;
   fixture `/workspace/opencode-model-1788714888044`.
5. `vv probe --tools` and `scripts/qualify-bridge.ts` regressions passed after the
   model transport changes. Plain `bun run build` passed with patched worker and
   SQLite assets after explicit `.env` loading was added. The final optional auth
   change only received build checking, not an authenticated network qualification.

Ignored host evidence under `vivari/.runtime/opencode-package/`:
`model-run.log`, `model-package.log`, `model-receipt.json` (packaging receipt),
`tools-regression-model.log`, `bridge-regression-model.log`. The guest success
receipt and packaging receipt are different artifacts; do not confuse them.

## Credential discussion / local state

The agent initially interpreted acceptance of a local proxy as acceptance of using
an existing account. The user paused to clarify. Local metadata inspection found
OpenCode, Anthropic and OpenAI connections; an existing host auth file contains an
OpenCode API-key entry. No key was copied into source, browser storage or logs.
No authenticated qualification was run. A temporary ignored `.env.local` opting
into that file was removed at the breakpoint. Credential use is an open decision.

Harness origin: `http://127.0.0.1:5192/`. Last runtime ID:
`cf8f7549-7839-44f8-a8f9-e63164ef43d2`; use `bun run vv status` to recheck.
Browser Control session: `tidy-otter-432`. Avoid resetting OPFS. The local relay
uses port 5193; verify service liveness rather than assuming prior jobs survived.
The Vite process started during this session was stopped at the breakpoint to
discard any loaded proxy configuration. Restart with `bun run dev --port 5192`
when resuming; the browser tab was left open.

After deciding transport/auth, rerun from `browser-container-poc/vivari`:

```sh
bun scripts/package-opencode.ts model
bun run vv status
bun run vv --runtime ID probe --model
# Or another free model ID from the available-model checkpoint:
bun run vv --runtime ID probe --model mimo-v2.5-free
```

The patched harness, relay, booted runtime, and packaged ripgrep assets are required.
See README for setup. No production deployment or git push was performed.
