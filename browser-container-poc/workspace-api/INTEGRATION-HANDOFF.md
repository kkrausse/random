# Real-demo integration checkpoint — ownership released

2026-09-07, replacement session `ses_f814d0710ffeif21SAWfQ2WDQG`, following
predecessor commit `31d01ee`. **Headless integration passes; browser acceptance
is incomplete.** Ownership is released on completion. Correct parent/coordinator:
`ses_f8193563bffecnVesGFwJGHrrp` (the previous coordinator ID was mistaken).

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

## Evidence and remaining browser gate

**Passed:** full real-Node runtime `verify-node.mjs` (90 processes); rebuilt runtime;
distribution packaging; combined workspace-demo typecheck (latest tree); demo
fixture tests 2/2; client tests 6/6; HTTP 200/isolation headers on 4311 and 43917.

Current strict real app test reached **RESULT PASS** with the new distribution:
actual guest Vite HTML/TSX, shared-source edit, genuine HMR WebSocket update through
kernel tunnel; authenticated OpenCode health, 31 models after activation, sessions,
history, SSE reader cancellation, client model switch and prompt admission;
**Muse made a real file-tool edit**, with text.delta/tool.success/execution.succeeded
events, and guest Vite served that changed TSX. Both services restarted and the
same session's user history survived. Provider/network succeeded on these runs.
This uses real Rust VFS/process workers plus explicit **test-only disk persistence**
(`tests/app-fs-worker.mjs`); it is not browser OPFS or same-Document evidence.

**Resolved headless model-HMR failure:** official `@vitejs/plugin-react@5.0.2`
preparation is now execution-tested. Manual and real Muse file-tool edits both
generated genuine Vite `update` frames; model edit logged
`hmr update /src/App.tsx, /src/App.tsx?t=1`. The strict assertion was preserved.
Current prepared manifest: **2291 files, 98,019,988 bytes**.

**Active-prompt interrupt passed:** execution.started followed by the client's
interrupt and execution.interrupted. First attempt encountered provider HTTP 429
before editing; it exposed a false-positive RESULT PASS path, now fixed by requiring
the real edit for final success. The next full run passed with no provider error.

**Fresh-worker persistence passed:** explicit final disk flush, then a separate
Node invocation using `APP_RESTORE=1` and the same `APP_STATE_DIR`. Exact source
bytes restored; both excluded dependency trees were absent, explicitly re-delivered,
and both real guest services launched. The previous session's user history survived.
Receipt: `../workspace-demo/tests/REAL-APPS-EVIDENCE.md`. No runtime rebuild/change
was needed. Both workspace-api and workspace-demo typechecks passed.

## Browser and running servers

CLI exclusively: `browser-control execute 'return { url: page.url(), title: await page.title() }'`
failed again in the replacement session before creating a page: `Browser Control extension is not connected. Load
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
export APP_STATE_DIR="$(mktemp -d)"
export PREPARED_APPS="$PWD/workspace-demo/dist/prepared"
bun run --cwd workspace-api test:workers
APP_RESTORE=1 bun run --cwd workspace-api test:workers
bun run --cwd workspace-demo typecheck
bun test --cwd workspace-demo
bun test --cwd opencode-client-demo
```
App test makes real free-provider requests; outbound provider URL is direct in
headless test, same-origin model proxy in browser. Ordinary `test:workers` without
PREPARED_APPS remains the offline backend gate. APP_STATE_DIR names the test-only
disk snapshot directory; APP_RESTORE requires that same directory and skips provider
requests. Full strict run and separate fresh-worker restore both exited 0.

## Next three actions

1. Check Browser Control. If connected, run `window.contract.run()` and
   `window.contract.search()` at 43917 before demo. Verify reload/lease/OPFS failures.
2. Headless app/model-HMR, active interrupt and fresh-worker restoration now pass.
   No further provider calls or runtime rebuild are needed unless new changes or
   browser findings justify them. Provider 429 is an external transient gate;
   a missing edit now fails rather than printing acceptance.
3. Browser demo: open → seed → runtime → deliver → Vite → OpenCode. Prove same
   iframe Document across manual edit/restore and model edit; stop/flush/close/reopen,
   restore dependencies, restart. Update receipts and commit scoped paths only.
