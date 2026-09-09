# Public chat integration — independent QA checkpoint

Owner: `ses_f808cf774ffebOrr0RRAle1t2z`; September 7 local / September 8, 2026 UTC.
No subagents. Integration follows implementation commits `96160af` and `4f32cf6`.
Package endpoint query fix: `a66ad66`.
Pin unchanged: **OpenCode dev-19167 / d7a7256bb6b0952f486c95718cfbf460b1570a56**.

## Root causes and fixes

- Replaced the vanilla client seam with built public `@kev-browser-agent-kit/opencode-chat`
  `createChatController`, `/react` `ChatView`, and `/styles.css` file dependency.
  No new private package-source imports. Production chat code is outside the normal
  static JS graph; workspace core/React APIs retain no chat or Vite dependency.
- Controller now belongs to the recipe service endpoint, not a React effect. One
  WeakMap entry/stream per service, awaited ready, registered release on replacement,
  reset/exit and immediate abort during startup. The host owns the endpoint/server.
  Panel/view subscription churn cannot create sessions, interrupt or stop the server.
- Public chat API discarded caller endpoint query parameters. Preserved base routing
  and auth query values alongside API filters, with repeated-value regression checks.
  The demo's real authenticated adapter receives strings/init and retains headers,
  body and signal. `/workspace` is caller-supplied without a directory picker.
- Fresh SSR integration exposed two React copies through Bun file symlinks (the chat
  package's dev React versus the demo renderer): invalid hook call. Demo build now
  resolves React/ReactDOM peers from the app via a Bun resolver plugin. Fresh bundled
  consumer passes; production build uses the same resolver.
- Fresh server remains empty until **New chat**. Chat file callbacks expand the
  editor and map `/workspace/` paths to workspace-relative FS paths; unsaved editor
  text is protected. Panel has bounded height and remains optional/replaceable.
- Startup/browser build checks built public exports and gives exact package
  preparation commands. No runtime rebuild was needed or performed.

## Verified here (boundaries matter)

| Case | Evidence |
| --- | --- |
| Package query/string-init/pagination transport, reducers, mixed parts/history dedupe, permissions/questions, authoritative interruption/reconnect/disposal | Package deterministic tests: 22 passed / 82 assertions; typecheck/build passed |
| Authenticated demo adapter, one controller/stream per service, explicit session creation, replacement and cancellation before handshake, caller endpoint ownership | New deterministic integration tests; no guest claim |
| React optional view and empty/error markup with a single app renderer | Fresh temporary bundled consumer, public exports, isolated Bun process |
| Normal graph excludes chat/editor, lazy assets guarded by policy, public scoped CSS | Bundle checks; real ephemeral non-admin/admin HTTP servers |
| Unauthorized direct lazy editor/runtime/prepared/model routes denied | Product tests; model proxy denial short-circuits without provider call |
| Source reset allowlist/preserved unknown source/config/chat/backend and reopen; duplicate lifecycle exclusion/abort/cleanup retry | Existing fixture/controller tests rerun; not browser OPFS acceptance |
| Native backend Request/Response stream passthrough in authored SW | Existing SW VM harness + real Bun HTTP; not iframe/browser cookie jar |
| Live admin demo HTML/JS/CSS/runtime/prepared/setup, isolation headers, binary PATCH/207/custom headers/cookie header, Set-Cookie, save/read, streamed chunks | [host-receipt.json](./host-receipt.json); `bun tests/integration-http.ts` against QA-owned 4312 |

Latest demo suite: **16 tests / 170 assertions**; browser/server typecheck and build
passed. Initial test-only expectations used a top-level directory and “New session”
label; corrected to pinned `location.directory` and actual **New chat**. The initial
preflight file-URL check was corrected before passing builds. None were guest failures.

HTTP diagnostic run: `7b1eb880-f704-490b-9433-44d6e6c89a18`, in bounded
`.diagnostics/events.jsonl` (+ `.1`). First stream chunk 0 ms, second 303 ms after
reader acquisition. No model/provider calls, no provider 429 observed here.
Historical opt-in worker harness `tests/real-apps.ts` also imports the built public
controller now, with one SSE stream and snapshot-based execution checks. It was only
typechecked, not run, and provides no acceptance evidence for this integration.

## Browser blocker and remaining gates

One Bun-backed `browser-control doctor`: CLI/relay 0.7.0, matching build
2026-09-05T19:03:42.828Z; extension disconnected, zero targets/connected sessions.
No browser session acquired, no screenshot available, no page/storage/edit mutated.
See `../../BROWSER-CONTROL-TODO.md`. No other browser driver used.

**Next exact case:** reconnect extension; inspect retained tabs using explicit
`brisk-wombat-706` + `--target-url 127.0.0.1:4311` and `tidy-badger-184` +
`--target-url localhost:4311` before any navigation. Preserve their saved headings
and session IDs from TESTING-HANDOFF. Create/select an explicit returned QA session
for 4312; inspect normal counter and no editing worker/network startup; then Enable
editing and verify original normal DOM remains visible throughout boot, populated
actual guest Vite iframe, stable floating shell and one React renderer.

Still **unverified** for the new integration:

- Real guest models/sessions/history and mixed reasoning/tool/text streaming, final
  history without duplicate text; actual model edit and same iframe Document HMR.
- Actual file callbacks/editor focus/selection; real permission/question responses
  where safely obtainable (package fixtures above are explicitly deterministic).
- Active interrupt reflected by authoritative state; reconnect/history; tab/panel
  open/close without extra streams or endpoint/server disposal.
- Keyboard Enter/Shift+Enter/IME, safe live Markdown/code copy, reader-respecting
  scroll, usable viewport layout and controls. Attachments intentionally absent.
- Real browser cookie jar/native backend method/body/status/header/live-stream behavior
  in both normal root and iframe; source-only reset on QA-owned source preserving
  unknown/app/chat data; abort/retry/exit lease release; close/reload source persistence
  and dependency restoration. Never reset retained user stores to obtain a pass.

## Run and ownership

- **http://127.0.0.1:4312**: started deliberately with
  `PORT=4312 LOCAL_EDITOR_ADMIN=1 bun run demo`, PID **65716**, shell
  **`sh_07f798c270011eR7rzjxsE7mqv`**. Left running for parent/user browser QA.
  Ownership transfers to parent; stop only this shell/PID when finished. Normal view
  is default; Enable editing uses the explicit local admin fixture. No browser
  store exists from this QA; HTTP counter fixture is currently 23.
- **http://127.0.0.1:4311**: original terminal/watch owner, observed PID **86252**,
  `localEditorAdmin:false`. Never killed/reconfigured. For retained-origin editing,
  its owner must deliberately restart with `LOCAL_EDITOR_ADMIN=1`.
- No host OpenCode or Vite was started; server only delivers assets/backend/proxy.
  No runtime/API authored/generated files were changed. Temporary test servers and
  consumer directories cleaned up; unrelated repo work left untouched.
