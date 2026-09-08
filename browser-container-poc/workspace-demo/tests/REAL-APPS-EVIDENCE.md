# Real application integration receipt — 2026-09-07

Runtime version: `7c14a75d21b27d6c2f2bfdc7b0b9d9ba47a1cc3379708bbab8721b8e7c4d274f`.
Prepared delivery: 2,291 files / 98,019,988 bytes, including official
`@vitejs/plugin-react@5.0.2`, Vite 7.1.4, matched OpenCode core/schema dev-19167
(source `d7a7256bb6b0952f486c95718cfbf460b1570a56`).

These are real Node 24 / Rust VFS / guest process workers, public Runtime and
Endpoint.fetch, authenticated guest OpenCode, and actual Muse provider requests.
Persistence uses the explicit **test-only disk snapshot adapter**, not OPFS.

## Strict full-app run: exit 0

- Existing offline worker contract passed (binary VFS and stdio, HTTP/SSE,
  cancellation, listener identity, process cleanup, actual ripgrep WASM).
- Explicit prepared delivery; actual guest Vite HTML and TSX transformation.
- Manual source edit produced real Vite WebSocket `update` through the kernel tunnel.
- Authenticated OpenCode health, catalog activation/model selection, sessions,
  durable history, live SSE, reader cancellation.
- Muse used real file tools to change the heading to `Prepared OpenCode edit`.
  Observed tool.success, text.delta and execution.succeeded.
- Vite logged `hmr update /src/App.tsx, /src/App.tsx?t=1`; the strict model-edit
  WebSocket update assertion passed. The React plugin preparation fixes the
  previously observed full-reload-only outcome in this run.
- A second prompt emitted execution.started, then execution.interrupted after
  the client adapter's interrupt request.
- Runtime stop left zero processes/listeners. Both services restarted; user
  history remained readable. Final explicit snapshot flush completed.
- `RESULT PASS (real headless workers; browser-only gates remain separate)`.

An earlier run hit provider HTTP 429 before the edit. It exposed a false-positive
test path: a missing edit could print RESULT PASS. The test now requires the edit
for success, while completing independent interruption/restart checks first.

## Fresh-worker restore run: exit 0

A separate invocation starts a new Node process, Rust VFS, FS worker, kernel and
guest workers using the first run's snapshot directory. It skips provider requests.

- Exact retained App.tsx bytes match the flushed receipt.
- Both `/workspace/node_modules` and `/opencode-v2` are initially absent.
- Public prepared-app delivery explicitly restores both dependency trees.
- Guest Vite serves HTML and transforms the retained edited TSX.
- Guest OpenCode starts with a fresh Basic credential and serves user history
  for the previous run's exact session ID.
- `RESULT PASS (real headless workers; browser-only gates remain separate)`.

Reproduce from `browser-container-poc/`, retaining the same directory for both runs:

```sh
export APP_STATE_DIR="$(mktemp -d)"
export PREPARED_APPS="$PWD/workspace-demo/dist/prepared"
bun run --cwd workspace-api test:workers
APP_RESTORE=1 bun run --cwd workspace-api test:workers
```

Also passed: standalone offline worker contract after the harness change;
workspace-demo and workspace-api typechecks; `git diff --check`.
Local full logs: approved temp directory `opencode/integration-apps-strict.log`
and `opencode/integration-apps-restore.log` (not durable source artifacts).

## Remaining external browser gate

Browser Control CLI/relay 0.7.0 build `2026-09-05T19:03:42.828Z` match, but the
extension is disconnected and zero targets are attached. Execute fails before
creating a page; doctor confirms no competing connections. No browser driver
substitution was used.

Contract first: http://127.0.0.1:43917, `window.contract.run()` then
`window.contract.search()`. Demo: http://127.0.0.1:4311 (both HTTP 200).
Pending: real OPFS reload/lease/failure checks, SW preview routing, same iframe
Document across manual and model edits, browser chat streaming/interrupt, and
browser stop/flush/close/reopen/dependency restoration. Headless success does not
establish any of those browser results.
