# Handoff: official Effect client migration

User requested: use the official Effect client and effectify most of the chat
client. Then requested an immediate handoff because context was getting large.

## Implemented

- `opencode-chat/src/api.ts`: official `@opencode/client/effect@2.0.3`, Effect
  `4.0.0-rc.112`, injected FetchHttpClient transport, typed service/errors,
  official resource calls and shared event Stream. Handwritten HTTP/SSE removed.
- `opencode-chat/src/controller.ts`: named Effect programs, ManagedRuntime,
  connection/selection scopes and fibers, Deferred handshake, concurrent snapshot
  loading and interruptible recovery. Public React methods still return promises.
- Updated protocol-valid fixtures, cancellation/validation tests, license
  collection and packed consumer smoke (installs workspace peer for editor tests).
- README/provenance updated. Main verification receipt:
  `doc/official-effect-client.md`.
- Sidebar layout was already committed earlier as `466c324`.

## Verification status at handoff

- Package typecheck/build passed, including the final typed API error changes.
- Packed consumer smoke passed after correcting its pre-existing missing
  workspace peer and replacing its partial controller mock with the real class.
- Final TODO consumer reinstall, typecheck, production build and 3 tests passed.
- Full package suite passed **78 tests / 1 skip** before final error-wrapper and
  formatting edits. Latest targeted run after those edits passed 26 tests but
  exposed a flaky timeout assertion in the new test.
- Corrected that assertion: timeout can abort injected fetch before the SDK
  acquires a body reader, so assert the fetch AbortSignal instead of requiring
  ReadableStream.cancel to run on an unread mocked response. The corrected
  timeout test passed individually. **Run the full package suite once more.**
- Browser: real native read tool + follow-up succeeded; reconnect and same-page
  close/reopen retained both successful idle records. Desktop/mobile sidebar
  screenshots inspected. These live turns preceded the final error-wrapper-only
  changes; the final host build is available for a final startup smoke if desired.

## Next actions

1. From `browser-container-poc/opencode-chat`, run `bun test`.
2. If clean, update this handoff/receipt with final status and commit only own
   paths. Do not stage `vivari/scripts/probe-tailwind-direct.mjs` (unrelated work).
3. Deliver concise completion: official Effect migration, checks, successful real
   tool/follow-up. Do not claim the previous encrypted-reasoning rejection's cause
   was established or that the SDK change definitively fixes it.
4. User can restart their original demo with:
   `LOCAL_EDITOR_ADMIN=1 PORT=4390 bun start` from `todo-app-demo`, then refresh.
   The host caches its editor asset manifest, so restarting after rebuild matters.

## Live resources

- Agent-started test host: Bun PID **97379**, port **4391**, background shell
  `sh_0a7b0e2f80017yd2B2zio94Gw2`. Verify PID/command before stopping it.
- Browser Control CLI 0.7.0 session **rapid-badger-571**, page
  `http://127.0.0.1:4391/`. Editor was explicitly exited; the page is still open.
- Browser automation notes: `todo-app-demo/browser-control-todo.md`.
- Screenshots in the approved temporary directory:
  `todo-effect-sidebar.png` and `todo-effect-sidebar-mobile.png`.
- Use the Browser Control CLI, not MCP/browser tools. No subagents authorized.

## Bundle tradeoff

Lazy TODO editor JS: **946.45 kB / 291.40 kB gzip**, previously
**320.16 kB / 108.37 kB gzip**. Loaded only when opening the editor.
