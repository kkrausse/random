# Real-demo integration checkpoint — ownership released

2026-09-07, session `ses_f817055aeffecHHfYsMiyH2SbT`. User requested an immediate
fresh-context checkpoint. **Integration is incomplete; do not call this browser
acceptance.** I release exclusive workspace-api/workspace-demo/client/runtime
ownership on completion. Coordinator: `ses_f8156bc4fffeWaJD7dOeuCH4t6`.

## Implemented

- `workspace-demo/prepare.ts`, `guest/package.json` + `guest/bun.lock`: explicit
  pinned dependency delivery; own guest install, no sibling private node_modules.
  Host preparation aliases esbuild 0.25.12 / Rollup 4.63.1 to their official WASM
  packages. User project metadata omits those host-only overrides.
- Reuses hash-verified `vivari/.runtime/opencode-v2-package/receipt.json`, revision
  `d7a7256bb6b0952f486c95718cfbf460b1570a56`, matched core/schema dev-19167.
  Runtime.node launches an ordinary wrapper that spawns the guest Bun-compatible
  frontend required by this CLI. No native OpenCode server is used.
- `src/prepared.ts`: manifest/path/hash verification and explicit callable delivery
  via public ToolDescriptor/ToolContext.installFile; conflicts reject. No apps
  auto-launch during delivery. Per-file installation is resumable, not atomic.
- Demo defaults real; discovers distribution JSON, seeds missing source/config,
  starts runtime, offers **Deliver prepared apps**, launches Vite/OpenCode separately.
  Prepared Vite uses native config loader; OpenCode state lives under
  `/workspace/.opencode-state`. Each server launch gets a fresh in-memory Basic
  credential injected into endpoint fetch. Health polling precedes chat mounting.
- Dev server serves `/runtime/`, `/prepared/`, and reuses the existing POC's public
  OpenCode model proxy. Source `/opencode.json` is seeded with its actual local port.
- Client fixes proven against real server: listener-query-safe URL composition;
  model/default catalog-activation barrier; matched model ref is `{providerID,id}`,
  **not** current published docs' `{providerID,modelID}`. UI + fixture use matched id.
- Runtime source fix: child stdout/stderr must preserve Uint8Array instead of
  `Buffer.from(String(chunk))` (which produced CSV numbers). Independent public
  worker regression checks all 256 stdout bytes plus binary stderr.

## Evidence and exact current failure

**Passed:** full real-Node runtime `verify-node.mjs` (90 processes); rebuilt runtime;
distribution packaging; combined workspace-demo typecheck (latest tree); demo
fixture tests 2/2; client tests 6/6; HTTP 200/isolation headers on 4311 and 43917.

Real app test previously reached **RESULT PASS** with the new distribution:
actual guest Vite HTML/TSX, shared-source edit, genuine HMR WebSocket update through
kernel tunnel; authenticated OpenCode health, 31 models after activation, sessions,
history, SSE reader cancellation, client model switch and prompt admission;
**Muse made a real file-tool edit**, with text.delta/tool.success/execution.succeeded
events, and guest Vite served that changed TSX. Both services restarted and the
same session's user history survived. Provider/network succeeded on these runs.
This uses real Rust VFS/process workers plus explicit **test-only disk persistence**
(`tests/app-fs-worker.mjs`); it is not browser OPFS or same-Document evidence.

**Latest stricter test fails:** after manual edit the tunnel gives HMR update,
but after the model edit Vite logs `page reload src/App.tsx`, not an `update`
frame. `workspace-demo/tests/real-apps.ts` now asserts the model's HMR update and
fails `AssertionError: Expected actual Vite websocket frame`. Model edit itself
still succeeds. Re-fetching main/App and pinning optimizeDeps include/noDiscovery
did not fix it. Tried awaitWriteFinish briefly; it also lost the manual update,
so reverted that experiment. Do not weaken the new assertion to claim success.

**Last atomic change, NOT EXECUTION-TESTED:** added official
`@vitejs/plugin-react@5.0.2` to guest dependencies and Vite config (Fast Refresh),
then updated lock/prepared output and passed typecheck. Current prepared manifest:
**2291 files, 98,019,988 bytes**. Previous passing/failing runs used 334 files,
86,583,020 bytes, manual `import.meta.hot.accept` in main.tsx and no React plugin.
The new active-prompt interrupt assertion is after the failing HMR assertion;
it has **not run**. Idle interrupt and SSE reader cancellation have passed.

## Browser and running servers

CLI exclusively: `browser-control execute 'return { url: page.url(), title: await page.title() }'`
failed before creating a page: `Browser Control extension is not connected. Load
extension/dist in Chromium; it reconnects automatically after relay or browser startup.`
`doctor`: CLI/relay 0.7.0 build 2026-09-05T19:03:42.828Z match; extension disconnected,
zero targets, no competing connections. **No browser session/page is owned.** No
alternate driver used. Contract must be run FIRST when extension connects.

Servers left running (HTTP smoke confirmed):
- real demo `http://127.0.0.1:4311`, shell `sh_07eab5654001FHnhlCDnOHqQaS`;
- contract `http://127.0.0.1:43917`, shell `sh_07eab58a4001PZnpVfzY0qMoq7`.
- Parent's preexisting 4310 was not touched.

## Durable/generated state and run commands

Nested authored diff **exactly equals** durable `vivari/patches/0001-sqlite.patch`;
SHA-256/version `7c14a75d21b27d6c2f2bfdc7b0b9d9ba47a1cc3379708bbab8721b8e7c4d274f`.
Built kernel `kernel-worker-BqrEBNhW.js`, process `process-worker-CeEKXAhY.js`,
FS `fs-worker-B8csCiFB.js`. Ignored runtime build/distribution/prepared assets are
current. Never edit emitted workers. Preserve the existing nested untracked
`bun.lock`. Outer unrelated hybrid-exec/hybrid-mount and .DS_Store files untouched.

From `browser-container-poc/`:
```sh
bun vivari/scripts/build-runtime.ts patched
bun workspace-api/scripts/distribution.ts
bun run --cwd workspace-demo prepare
PORT=4311 RUNTIME_DIR="$PWD/workspace-api/dist/runtime" bun run --cwd workspace-demo dev
bun workspace-api/scripts/serve-contract.ts
PREPARED_APPS="$PWD/workspace-demo/dist/prepared" bun run --cwd workspace-api test:workers
bun run --cwd workspace-demo typecheck
bun test --cwd workspace-demo
bun test --cwd opencode-client-demo
```
App test makes real free-provider requests; outbound provider URL is direct in
headless test, same-origin model proxy in browser. Ordinary `test:workers` without
PREPARED_APPS remains the offline backend gate. Optional APP_STATE_DIR names a disk
snapshot directory; fresh FS-worker restart from those files is not yet tested.

## Next three actions

1. Check Browser Control. If connected, run `window.contract.run()` and
   `window.contract.search()` at 43917 before demo. Verify reload/lease/OPFS failures.
2. Run the app command against **current React-plugin preparation**. Diagnose
   model edit → full-reload instead of HMR if still failing. Inspect actual watch
   events/module graph; avoid framework special cases in core. Complete active
   prompt interruption test and dependency restoration/fresh-worker persistence.
3. Browser demo: open → seed → runtime → deliver → Vite → OpenCode. Prove same
   iframe Document across manual edit/restore and model edit; stop/flush/close/reopen,
   restore dependencies, restart. Update receipts and commit scoped paths only.
