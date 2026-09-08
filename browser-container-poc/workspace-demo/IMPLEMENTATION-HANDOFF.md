# Local package checkpoint — ownership released

Owner: `ses_f80b87aabffecxahTVNNLC30bT`, September 7, 2026. No agents spawned.
This is an intentionally bounded **package increment**, not completion of the
requested production editable-app milestone. Parent should resume implementation
of the concrete remaining work below before asking fresh QA to accept product mode.

## Delivered

- Existing `workspace-api` is a private locally packable package: browser `.`,
  reusable `/react`, server/build-only `/assets` entrypoints. ESM JS and `.d.ts`
  built with Bun + TypeScript. Optional React 18/19 peer; core has no React import.
- Moved the existing provider/controller into `workspace-api/src/react.tsx`.
  Demo retains a small diagnostics adapter; source/launch/client recipe remains
  demo-owned. No generic-library demo diagnostic URL. Optional redacted event
  observer, run IDs/stage timings, payload bounds, existing bounded activity log.
  SSR initial snapshot supported; provider mount/import starts no services.
- Version-pinned standalone runtime delivery via `readRuntimeAssets` and
  `copyRuntimeAssets`. Installed package consumes an explicitly delivered asset
  tree; does not reach into POC `.runtime` or sibling dependencies. Durable build
  preparation stays in the existing POC script. No runtime source/patch changes.
- Demo application imports public package entries via a local file dependency.
  Historical diagnostics transport regression test still directly exercises the
  internal diagnostic reporter; that is not a consumer entrypoint/example.
- `workspace-api/scripts/consumer-smoke.ts`: actual separate tarball install,
  independent dependencies, strict NodeNext declaration check, React browser
  build, SSR/import worker/fetch laziness, diagnostics redaction, runtime relocation
  through installed public API and SHA256 comparison of every delivered file.

Exact install/build/asset commands and API/limitations:
[`../workspace-api/LOCAL-PACKAGES.md`](../workspace-api/LOCAL-PACKAGES.md).
Demo startup: build `workspace-api` first, then `bun install --ignore-scripts`
and `bun run demo` in `workspace-demo`. Runtime and prepared app prerequisites
remain those in README / TESTING-HANDOFF. Runtime patch version unchanged:
`5b9e2d83dddb85eb5e09c482418a19779c7235ce5b42ff0376e52872f9d4ba50`.
Generated package JS/types, runtime and prepared output remain ignored.

## Checks / retained receipts

- Core typecheck and build passed; core tests **4 / 17 assertions** passed.
- Demo browser/server typecheck and host build passed.
- Demo tests **7 / 34 assertions** passed after injecting its own diagnostics sink.
- External smoke passed: **36 runtime files, 55,141,902 bytes**, all hashes equal.
  Retained `/private/var/folders/t_/x48jtnps7n5_0g_pt9xpvbg00000gn/T/opencode/workspace-consumer-V4IeZn/`:
  `workspace.tgz`, `runtime.tgz`, isolated `consumer/`, delivered assets, receipt.json.
  Initial failed smoke `.../T/workspace-consumer-KV2DGl` exposed extensionless
  declaration imports; fixed and rechecked successfully. Demo typecheck initially
  raced the package rebuild removing declarations; sequential recheck passed.
- Browser CLI smoke blocked before page access; matching 0.7.0 relay, disconnected
  extension, zero targets. See BROWSER-CONTROL-TODO. No browser/runtime boot or
  DOM StrictMode acceptance inferred from SSR/build checks.
- No server started/stopped, lease acquired, storage reset, tab navigated, browser
  session reset/deleted or durable runtime patch edited. Existing 4311 owner and
  retained browser sessions from TESTING-HANDOFF remain with parent/QA.

## Remaining implementation (required before full product QA)

1. Controlled production React wrapper: caller-owned `isAdmin`/enable state;
   normal concrete interactive app by default; lazy-load editor code where possible;
   no workers/services until enabled. Keep original React tree mounted/visible until
   edited preview is ready, then full-window iframe. Host recovery shell stays
   outside iframe; floating chat toggle, expandable file/preview controls, Exit.
2. Exit/start/abort/StrictMode/unmount lifecycle: cancel pending recipe safely,
   await close/release lease, retain user source/chat, retry failed cleanup. Current
   controller comes from prior implementation and needs real DOM race coverage.
3. Explicit known-good **source** snapshot and reset ownership policy. Reset only
   declared source paths, restart relevant app; never wipe backend/chat/state or
   silently replace unknown files on normal entry/reopen.
4. Real server authorization adapter/hook for editor assets and model proxy,
   application-owned policy. Clearly labeled local admin fixture, no invented auth.
5. Required `/api/...` passthrough from guest iframe to existing same-origin backend
   with native request/response streaming/cookies/headers/method/body/status. Inspect
   listener query propagation and SW routing (`src/browser/preview.ts`, `host.ts`,
   canonical `studio/public/sw.js` in durable runtime source). Apply changes through
   `vivari/patches/0001-sqlite.patch` + established build-runtime workflow in
   V0-HANDOFF; never edit emitted worker/SW assets. Repackage/reprepare as needed.
6. Add same tiny backend and same concrete interactive app in normal and guest
   modes. Document relative URLs, routing, OAuth, iframe navigation and React
   remount-state limits without asserting identical URL semantics.

## Fresh QA after next increment

Normal lazy startup → authorized Enable editing → original app stays visible during
boot → iframe ready → floating chat/editor → same-origin backend request (both app
modes, including streamed response and cookie/header/body/status checks) → known-good
source-only reset → Exit and lease release → reopen with source/chat preserved.
Include non-admin direct editor-route denial, duplicate enable, exit during boot,
missing asset/start failure/retry, broken guest recovery from host shell, StrictMode
and unmount. Preserve both existing origins and chat/source edits listed in
TESTING-HANDOFF; no storage deletion. Parent owns next implementation and independent
QA assignment; this session releases all file/server/browser/runtime ownership.
