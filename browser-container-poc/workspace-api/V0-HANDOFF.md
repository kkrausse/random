# Workspace API v0 — integration handoff

September 7, 2026. **Real backend checkpoint, not first-milestone browser acceptance.**
The parent requested this checkpoint and will launch a fresh integration agent.
This owner releases the runtime seam after the checkpoint commit.

Independent consumer commits: `196aec1` (`workspace-demo`) and `b02ac70`
(`opencode-client-demo`, matched to POC V2 core/schema `0.0.0-dev-19167`).

## Source of truth and code layout

All paths below are relative to `browser-container-poc/`.

| Path | Responsibility |
| --- | --- |
| `workspace-api/src/index.ts`, `types.ts` | Public exports/contracts |
| `workspace-api/src/workspace.ts` | Filesystem-only object, `/` → `/workspace`, storage ownership and close lifecycle |
| `workspace-api/src/host.ts` | Private browser worker/SW transport, explicit manifest boot, RPC and listener state |
| `workspace-api/src/runtime.ts` | One runtime attachment, execution/tool/endpoint ownership and stop |
| `workspace-api/src/execution.ts` | Proc launch, separate byte channels/shared in-transit budget, stdin/EOF/exit |
| `workspace-api/src/browser/endpoint.ts` | Generic guest Node HTTP relay, streaming Fetch and cancellation |
| `workspace-api/src/browser/preview.ts` | Fresh iframe navigation, sender validation, attachment-namespaced WS/SSE IDs |
| `workspace-api/src/tools/ripgrep/descriptor.ts` | Hash-verified existing ripgrep receipt, private executable, bounded results |
| `workspace-api/scripts/distribution.ts` | Packages built immutable assets + ABI/version manifest |
| `workspace-api/tests/headless-contract.ts` | Real Rust VFS + process workers; public Runtime/tools/fetch with a headless Host adapter |
| `workspace-api/tests/browser-contract.ts` | Public browser contract harness, currently **not run** |
| `workspace-api/scripts/serve-contract.ts` | Isolated contract server, default `127.0.0.1:43917` |
| `vivari/patches/0001-sqlite.patch` | **Durable runtime source changes**, including earlier work |
| `vivari/.runtime/patched/` | Ignored generated working checkout/build, upstream `2629c71097238400c45aefa213ef61df4794c2b7` |
| `vivari/scripts/build-runtime.ts` | Patch application, Rust/worker builds, retained assets and exact build receipt |

Runtime changes touch core FS/kernel workers, `kernel-host/{kernel,fs-server}.js`,
`runtime/{boot,builtins/process}.js`, canonical `studio/public/sw.js`, headless
`scripts/fs-worker.mjs`, and upstream architecture/roadmap docs. No demo/chat,
unrelated hybrid project or emitted worker was edited.

## Public contract — no further consumer export adjustments required

```ts
import { Workspace, Runtime, opfsStore, defineRipgrepTool, attachPreview }
  from '../workspace-api/src/index';
const manifest = await fetch('/runtime/distribution.json').then(r => r.json());
const distribution = { name: 'vivari', version: manifest.version, assetBaseUrl: '/runtime/' };
const workspace = await Workspace.open({ id: 'default', storage: opfsStore(distribution) });
const runtime = await Runtime.start({ workspace, distribution, tools: {} });
const process = await runtime.node({ entry: '/workspace/server.cjs', args: [], cwd: '/workspace', env: {} });
// Drain process.stdout and process.stderr concurrently while it runs.
const endpoint = await runtime.expose(4096, { signal: AbortSignal.timeout(30_000) });
const response = await endpoint.fetch('/global/health');
// attachPreview(mountedIframe, endpoint) owns HTML/HMR preview transport.
await runtime.stop(); // workspace files stay authoritative and usable
await workspace.flush();
await workspace.close();
```

- `opfsStore(distribution)` supplies assets for internal storage workers before
  Runtime exists. Only `id:'default'` is supported, with one origin's existing lease.
- Tools are callable methods: `runtime.tools.ripgrep(options)`, not A0 `.invoke`.
  Configure `defineRipgrepTool({receiptUrl:'/tools/rg-receipt.json'})`.
- `Execution.exited` resolves `{exitCode,signal,forced}`. Byte stdin/EOF and
  idempotent forced stop are supplied. No public Bun/full PTY/native-binary claim.
- Endpoint supplies `url`, `port`, `closed`, `fetch(string,RequestInit)`, `dispose`.
  Demo's native-Fetch input adapter remains compatible.
- Final combined workspace-demo typecheck passed against these exports.

## Implemented and verified versus remaining gates

### Passing real-worker evidence

- Actual shared Rust/WASM VFS; host >1 MiB binary read/write bypasses the small SAB;
  guest writes and rename notifications reach host observation.
- Explicit Node-compatible frontend, exact argv/cwd/custom env, missing-entry
  rejection, normal exit 7; separate arbitrary-byte/split-UTF-8 stdout/stderr;
  all 256 stdin byte values and EOF.
- Top-level output caps unread bytes at 1 MiB per channel **including worker transit**
  through shared credits, with 64 KiB frames. Overflow errors and kills that process;
  it never silently drops output. This is fail-on-overflow, not blocking backpressure.
  Guest child-to-parent and synchronous capture remain separate legacy channels.
- Runtime stop/reattach over retained VFS, execution/port cleanup, explicit listener
  close and incarnation IDs; stale Endpoint.fetch does not retarget reused ports.
- Generic Endpoint.fetch executes actual guest Node HTTP requests, not host HTTP
  or EventSource. Binary response/status/headers, binary POST, two live chunks before
  completion and cancellation reaching guest TCP all pass.
- Genuine packaged ripgrep WASM positive/no-match/invalid-regex/Unicode/ignore/glob,
  explicit truncation and shadowed `/bin/rg` pass. Hashes verify before installation;
  unknown existing bytes reject. No public rg launcher is required.

### Implemented, browser-only acceptance pending

- Workspace.open retains storage/supervisor with structured OPFS state and no
  project startup. Failed persistent ownership/init rejects, with no silent RAM fallback.
- Flush reaches the FS worker and awaits actual OPFS flush, reporting failures.
  Close rejects while attached, prevents concurrent attachment during close, flushes,
  then releases workers even if flush fails (and propagates failure).
- SW URLs carry reserved `__vv_listener` identity and iframe subrequests inherit it.
  Preview validates sender window/origin and namespaces connection IDs. Detach closes
  its tunnels and clears the iframe without stopping the service.
- Browser harness covers public open/flush/close/reopen, binary bytes, watches,
  execution, streaming/cancellation, generic preview, detach and port reuse.

### Explicit limitations

1. **Browser Control v0.7.0 extension disconnected**. Execute failed before obtaining
   a page. No browser OPFS reload/failure/quota/lease, fresh SW or HMR claim. See
   `BROWSER-CONTROL-TODO.md`. No alternate browser driver was used.
2. **Only one persistent origin store**. `default` does not create a new namespace.
   Core currently rejects unavailable/ephemeral persistence; no memory store supplied.
3. **`node_modules` remains excluded from existing OPFS mirroring**. Flush does not
   persist dependencies. Explicit delivery/cache restoration is needed after reopen.
4. **No prepared Vite/OpenCode app delivery**. Distribution is workers/WASM/SW, not
   project dependencies, OpenCode, npm vendor packs or provider setup. Missing npm
   asset logs are distinct from kernel readiness.
5. Fetch uses **one guest process/request**, buffers uploads (8 MiB), bounds headers
   (64 KiB), returns redirects manually, and does not implement browser cookie jars
   or Response.url/redirected metadata. Slow consumers may hit output overflow.
   SW preview HTTP itself remains buffered.
6. Preview needs browser race/adversarial checks: SW restart, SPA query removal,
   cross-port subresources, repeated attach. Same-origin trusted embedding is not
   deployment isolation or outbound network policy.
7. General bundle activation/upgrades/cookbook (D2), deployment E1, Vite/HMR F1 and
   actual OpenCode/model/client F2 are unfinished. Ripgrep is a first typed tool,
   not a general atomic release manager.
8. Runtime startup cancellation cleans execution ownership, but tool artifact
   fetches currently finish before startup cancellation is observed.

## Exact build, delivery and run commands

From `browser-container-poc/`:

```sh
bun vivari/scripts/build-runtime.ts patched
bun workspace-api/scripts/distribution.ts
# Optional explicit destination:
# bun workspace-api/scripts/distribution.ts /absolute/consumer-runtime-directory

bun run --cwd workspace-api typecheck
bun run --cwd workspace-api test
bun run --cwd workspace-api test:workers
bun workspace-api/scripts/serve-contract.ts
# http://127.0.0.1:43917
```

The worker runner uses pinned real Node:
`bunx --package node-bin-darwin-arm64@24.18.0 node`. Bare `node` here is a Bun shim.
The runner is macOS arm64-specific; use real Node 24 on other platforms. It consumes
already packaged ripgrep assets under `vivari/.runtime/opencode-package`. Regenerate:

```sh
bun install --frozen-lockfile --cwd vivari/probes/ripgrep
bun vivari/scripts/package-ripgrep.ts
```

The tool needs **every file referenced by `rg-receipt.json`** served beside the
receipt. The contract server exposes `/tools/`; other consumers must provide it.

Fresh real-demo server, avoiding the parent's existing `4310` server:

```sh
PORT=4311 RUNTIME_DIR="$PWD/workspace-api/dist/runtime" bun run --cwd workspace-demo dev
# http://127.0.0.1:4311
```

Choose **Shared workspace-api** and use this distribution JSON (read actual version
from `/runtime/distribution.json` after each runtime rebuild):

```json
{"name":"vivari","version":"2a67df41cbbd783e8c09614cf6f8f07030213b49ef4124645f87f5fea036ad5f","assetBaseUrl":"/runtime/"}
```

Required headers: COOP `same-origin`, COEP `require-corp`, SW response
`Service-Worker-Allowed: /`. Both demo and contract servers supply them. **No
API-owned server was left running**. Parent's 4310 demo is independently owned.

### Generated artifacts (ignored, rebuild rather than commit)

- `vivari/.runtime/patched/packages/core/dist/`: built SDK/worker output.
- `vivari/.runtime/patched-build.json`: exact upstream/toolchain/patch/asset hashes.
- `workspace-api/dist/runtime/distribution.json`: ABI `workspace-v1`.
- Version / patch SHA-256:
  `2a67df41cbbd783e8c09614cf6f8f07030213b49ef4124645f87f5fea036ad5f`.
- Active kernel `assets/kernel-worker-DcoHlL4E.js`.
- Active FS `assets/fs-worker-B8csCiFB.js`.
- Active process `assets/process-worker-CI_Ovpte.js`.
- `workspace-api/tests/.headless.mjs`: generated Node test bundle.

## Verification receipt

- Full `build-runtime.ts patched`: **PASS**, Bun 1.4.0, Rust 1.93.0,
  wasm-pack 0.13.1, pinned upstream above; worker/WASM build regenerated.
- Distribution delivery: **PASS**, explicit manifest and immutable assets.
- workspace-api typecheck: **PASS**, including tool inference and browser consumer.
- Unit tests: **3 pass, 0 fail**, 10 assertions.
- `test:workers`: **PASS** after byte-credit/large-read changes, real Rust VFS and
  real process workers, guest streaming HTTP/cancellation and actual ripgrep WASM.
  Its small headless Host adapter is explicit; no browser transport claim.
- Full upstream `scripts/verify-node.mjs` under real Node 24.18.0: **RESULT PASS**
  after final runtime behavior changes; 90 processes plus shell/HTTP/watch/Node APIs.
- workspace-demo combined typecheck: **PASS** against final exports.
- Browser CLI: **BLOCKED** by disconnected extension; no browser result.

## Safe ownership transfer and generated dirty state

Outer checkpoint commit owns only `workspace-api/`, `doc/api-handoff.md`, and
`vivari/patches/0001-sqlite.patch`. Nested `.runtime/patched` is intentionally dirty
against pinned upstream: all reviewed patches are applied there. Its complete
`git diff --binary HEAD` equals the outer patch at transfer. Build script verifies
this and refuses unknown changes. Do not reset either repository to make it build.

For the next **single runtime owner**:

1. Read applicable AGENTS and nested ARCHITECTURE/roadmap. Inspect both git statuses.
2. Edit authored source in `.runtime/patched`, with relevant docs and real probes.
3. Export from **that directory**:
   `git diff --binary HEAD > ../../patches/0001-sqlite.patch`.
   New authored files require intent-to-add inside the nested checkout so the diff
   includes them. Preserve all previous patch sections.
4. Run full real-Node verification and focused tests; use established build script
   (retains immutable assets), then regenerate standalone distribution. Do not edit
   emitted workers or install another source-of-truth copy.
5. Commit only owned outer paths; keep generated output ignored. Never stage
   unrelated `hybrid-exec`, `hybrid-mount` or other agents' work.

Ownership releases after this checkpoint. Parent should start the fresh integration
agent after completion, with no concurrent runtime patch/protocol writer.

## Prioritized next steps

1. **Connect Browser Control and run the contract page first**, CLI exclusively.
   Evaluate `window.contract.run()` and `window.contract.search()`. Fix actual
   browser startup/OPFS/SW defects before changing public contracts. Add independent
   reload, injected persistence failure and live lease-contender probes.
2. **Boot real demo on 4311 with this distribution**. Validate files without runtime,
   start/stop retention, then a small generic HTTP module copied from the contract
   fixture to isolate preview routing from Vite packaging.
3. **Explicitly prepare Vite dependencies**, using existing `opencode-demo/build.ts`
   and Vivari packaging recipes as references. Project files belong under
   `/workspace`; no host Vite substitution or second authoritative file tree.
   Vite 6+/8 may need documented `--configLoader native`. Prove same iframe Document
   across edit/restore HMR, then stop/restart and dependency restore after reopen.
4. **Prepare matched OpenCode V2 bundle**, set demo's configurable entry/args, prove
   health/session/event streaming through Endpoint.fetch, then provider/model edit
   to Vite HMR. Separate provider failures from transport failures.
5. Fix any actual V2 client adapter gaps generically, keeping application paths out
   of core; add real-worker/browser regressions. Only then expand D2/E1 follow-ons.

Iterate this real backend/demo checkpoint; do not add another throwing facade or
treat fixture output as proof of real execution.
