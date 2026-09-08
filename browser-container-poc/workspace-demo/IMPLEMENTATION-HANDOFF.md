# Normal / editing implementation — ownership released

Owner `ses_f80adc345ffehktRIDsTSnqYzk`, September 7, 2026. No subagents spawned.
This implements handoff points 1–6; **real browser acceptance remains fresh QA's job**.
The independent optional chat package is owned by `ses_f80a3c533ffeAdBIIOtwzOmTG4`;
this session did not edit `opencode-chat/` or the completed audit directory.

## Delivered

- Public `/react` `WorkspaceEditing`: caller-owned allowed/enabled/start/retryKey,
  readiness predicate and editor render slot. Original children stay mounted and
  visible during boot, hidden only once caller readiness passes. No startup on
  import/mount. Generic API has no Vite/OpenCode recipe or diagnostic upload URL.
- Controller `cancelAndClose`: abort immediately, await in-flight operation, close
  services/runtime/workspace serially; repeated calls share cleanup. Signal renews
  after success. Failed cleanup can be retried. Provider disposal shares this path;
  effect replay defers admission/disposal. Recipes must await work and observe signal.
- Concrete normal interactive `SampleApp.tsx`; its exact source is delivered into
  guest Vite. Counter Save/Refresh and streamed `/api` response work against the same
  application-owned backend. Normal React state stays mounted; guest is a new root.
- Demo lazy-loads editor/recipe chunks only after Enable editing. Full-window guest
  preview waits for a populated React root. Host corner shell survives broken guest:
  Chat toggle, expandable Editor, Reset source, Exit/cancel and retry. Saved source
  and chat survive ordinary re-entry; Exit explicitly discards unsaved editor text.
- Recipe reset allowlist: `/index.html`, `/src/main.tsx`, `/src/App.tsx`,
  `/vite.config.mjs`. Restore known-good prepared bytes, flush and restart Vite;
  pause/reconnect OpenCode to prevent concurrent agent writes. Never delete paths,
  unknown files, backend or session state; package.json/opencode.json remain owned.
- Public server-only `/server` authorization adapter: app callback permits or 403;
  callback failures deny. Demo uses **explicit LOCAL_EDITOR_ADMIN=1 loopback fixture**,
  not production identity. Without it, no toggle and direct editor assets/model
  routes deny. Runtime/prepared/lazy editor graph/diagnostics are guarded in serve.ts.
  Replace `server-policy.ts` with existing app session/role policy for deployment.
- Public `attachPreview(...,{hostPaths:["/api"]})` routing policy. Reserved
  `__vv_host_paths` query travels with `__vv_listener`. Authored SW native-fetches
  matching root-absolute iframe requests with the original Request/Response stream;
  host WS/EventSource stays native too. Default policy empty; no OpenCode routes in VM.

## Exact local run / consumption

```sh
cd browser-container-poc/workspace-api
bun run build
cd ../workspace-demo
bun install --ignore-scripts
LOCAL_EDITOR_ADMIN=1 bun run demo
# http://127.0.0.1:4311 → normal counter → Enable editing
# Omit LOCAL_EDITOR_ADMIN for non-admin direct-route-denial mode.
```

If 4311 already has a different policy, `demo` reports it and preserves that owner.
Parent/QA must deliberately restart its owning terminal with the intended env.
Changing ports changes persistent origin; do so only intentionally.

Independent tarball install and asset delivery: `../workspace-api/LOCAL-PACKAGES.md`.
New exports remain independently consumable; build before installing/rechecking the
demo. Never run consumer checks concurrently with package rebuild deleting dist/lib.
Runtime source/patch workflow remains `../workspace-api/V0-HANDOFF.md` §215–227.

## Runtime / generated assets

Authored SW: `vivari/.runtime/patched/packages/studio/public/sw.js`; updated nested
ARCHITECTURE/roadmap. Full nested `git diff --binary HEAD` exported to durable
`vivari/patches/0001-sqlite.patch`; retained previous sections and untracked bun.lock.
Full runtime build, distribution and demo preparation completed; emitted assets
were never hand-edited. Runtime version now:
`fd0c1c8769ed2ab52fca10ccbdfdb9beebda5a31e1c1985d7a24f83ae6a39003`.
Prepared apps: 2,291 files / 98,019,988 bytes. Output remains ignored.

## Checks / evidence

- API typecheck/build + 4 unit tests / 17 assertions passed.
- Demo browser/server typecheck, build, and tests passed: suite 12/84, final focused
  product 5/55 (combined coverage 12/89). Source reset/reopen, cancellation/cleanup retry,
  lazy public/private graph, real server policy denial/allow and native SW request
  passthrough are covered. Real PATCH binary upload/header/cookie/status, counter
  state, Set-Cookie and two live stream chunks tested against a Bun HTTP backend.
  SW VM harness executes authored routing; it is not a real browser cookie jar.
- Full pinned real-Node `scripts/verify-node.mjs` passed after SW change; full runtime
  rebuild passed. Logs: `.../T/opencode/product-runtime-{build,verify}.log`.
- External consumer smoke passed: 36 runtime files / 55,143,643 bytes hash-equal;
  NodeNext declarations, browser build, SSR lazy wrapper and server adapter tested.
  Receipt: `.../T/opencode/workspace-consumer-iw19Gm/receipt.json`; log
  `.../T/opencode/product-consumer.log`. No packaging audit repeated.
- Initial product reset test missed fixture parent mkdir; fixed. One test run raced
  consumer prepack's dist/lib replacement (HTTP bundle 500); sequential rerun passed.

## Ownership / remaining acceptance

One `browser-control doctor`: matching CLI/relay 0.7.0, extension disconnected, zero
targets. No browser page/storage/tab/session touched; see BROWSER-CONTROL-TODO.
No existing server started/stopped. Two test-owned ephemeral-port servers were
started and stopped for route checks. Existing watch server may have reloaded source;
its flag/environment was not changed. Preserved tabs/origins/source/session IDs
remain listed in TESTING-HANDOFF. No model provider calls made.

Fresh QA: normal no-workers/network-lazy check → enable/boot original DOM retained →
full-window guest → chat/editor/HMR → backend cookie/method/body/status/live stream →
explicit source-only reset on a test-owned snapshot/origin → Exit lease release →
reopen saved source/chat. Include duplicate enable, cancel during boot/import, failure
retry, broken guest recovery, StrictMode/unmount and policy revocation/direct denial.
Do not Reset source on retained user headings without preserving/restoring their bytes.

Known limitations: relative api paths resolve under preview prefix; router/query
identity, OAuth/top navigation and SW revival need application integration. Guest
React remount state is not normal state. Backend sample is server-lifetime memory.
Dependency/package changes can need manual repair beyond source reset. Same-origin
editing is trusted code, not isolation. Unload flush is best-effort. Browser behavior
above is unverified while disconnected, not inferred from host/unit tests.

Chat seam: `src/chat-adapter.ts` + `Chat` in `editor-components.tsx` currently mount
the existing client. Replace there with public `@vivari/opencode-chat` controller
and optional `/react` view after its owner's completion. The sample supplies
service.connection and directory, owns ready/dispose and runtime lifecycle. Keep
that integration outside generic workspace React/core. Parent coordinates follow-up;
this session releases its source/runtime/server/browser ownership after scoped commit.
