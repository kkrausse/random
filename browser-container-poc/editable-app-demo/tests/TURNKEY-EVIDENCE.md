# Turnkey sample / React consumer checkpoint

2026-09-07/08, session `ses_f81074389ffe32i7lVNm6xCRKm`.

## Original failure actually inspected

Browser Control CLI 0.7.0, matched relay build 2026-09-05T19:03:42.828Z.
The attached user-owned tab was **http://127.0.0.1:4311/**, not the older 4310 server.
Its activity contained `8:01:19 PM Failed: signal timed out`; workspace was closed,
runtime stopped and every downstream launch action disabled. The failure was
therefore the 120-second **Workspace.open initialization deadline**, not a Vite/
OpenCode ordering error. No underlying worker error was retained in that activity.

One retry through the actual Open workspace button succeeded at 8:05:31 PM without
clearing storage, rewriting files, replacing the distribution or restarting the
server. The retained source was exactly:
`import React from "react"; export default function App(){return <h1>Browser Muse HMR verified</h1>}`.
The reason that earlier initialization missed its deadline is **not proven** by
the surviving diagnostics. Do not claim an identified/fixed kernel defect or
attribute it to background throttling as a fact. New startup reports the exact
stage, checks assets first, and makes a safe retry explicit.

## Browser acceptance before the React steering change

Sessions `brisk-wombat-706` (explicit target 127.0.0.1:4311) and
`tidy-badger-184` (owned localhost:4311 page), exclusively Bun-backed CLI:

- One Start sample double-click admitted one startup. All seven stages completed,
  2,291 files verified/delivered, real guest Vite and authenticated OpenCode ready.
- Retained origin preserved exact source and the existing session
  `ses_f81172f68ffejN3an9WuDa9DW4`. Chat reported connected, 31 models plus server
  default, enabled Send, no error. No provider invocation was needed in this pass.
- Manual title edit and exact restoration both preserved the same iframe Document.
  The original source was saved/flushed again after restoration.
- Fresh `localhost:4311` origin was used without deleting any user data. A deliberate
  distribution-version mismatch failed before opening storage; correcting it and
  retrying succeeded. Counter rendered, click changed Count: 0 → Count: 1.
- Changing the title to “My edited browser counter” through Save file preserved
  both the iframe Document and Count: 1. Fresh chat automatically created
  “Sample workspace”, `ses_f80ff3b6bffeWfgjD6TNLkJvHb`, with Send enabled.

These results exercised the initial vanilla one-click shell. The user then
explicitly requested the **React host/context provider**, now implemented.

## React-host acceptance gate

Before reloading the React host, Browser Control disconnected. Both stop/close
calls failed before page access; doctor reported matching healthy relay, zero
targets, disconnected extension. The user was asked to reattach; one later
explicit-target execute failed identically. No storage was cleared, no user tab
was closed and no relay was restarted. See `../BROWSER-CONTROL-TODO.md`.

Still required after reconnection: reload React host after acknowledged close when
possible; Start workspace; retained source/session reuse; fresh counter render;
editor → same-Document HMR; real chat readiness; partial service failure/retry;
stop/close/reopen restoration and effect cleanup. The previous vanilla pass does
not establish those claims for the React implementation.

## Non-browser checks

- `bun run demo` prepared changed recipe inputs once, verified assets and reused
  the existing compatible 4311 server/proxy. No unrelated port owner was stopped.
- Focused tests cover missing-file seeding/preserved edits across snapshot reopen,
  duplicate lifecycle exclusion and stage failure/retry, and pending-startup abort
  plus once-only attachment disposal. Fixture tests are explicitly not OPFS proof.
- Final React tree: `bun run typecheck` passed both browser and Bun projects;
  `bun test` passed 5 tests / 21 assertions; `bun run build` emitted the React host,
  chat bundle and Tailwind stylesheet. Client tests passed 6 / 24 assertions.
- HTTP smoke at 4311: `/`, `/app.js`, `/app.css`, `/setup-check`,
  `/runtime/distribution.json`, `/prepared/manifest.json` all returned 200 with
  COOP `same-origin` and COEP `require-corp`.
- Repeated `bun run demo` verified/reused 4311 without preparation. An isolated
  temporary HTTP port owner was rejected with actionable instructions; its HTTP
  200 response remained intact. The first non-JSON-owner check exposed a parsing
  fallback; content-type gating now reports that conflict directly.
- A preliminary `PORT=4310 bun run demo` found no listener and started an owned
  server, then the shell timeout terminated it. `lsof` confirmed only the original
  4311 listener remained. No preexisting 4310 process was killed.

User subsequently requested an independent fresh QA agent. This implementation
session intentionally stops at focused developer checks and HTTP smoke; ownership
and the remaining real React acceptance gate transfer via
`../TESTING-HANDOFF.md`.
