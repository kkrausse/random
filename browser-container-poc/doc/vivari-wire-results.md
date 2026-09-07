# Compiled OpenTUI wire ABI and actual OpenCode TUI — 2026-09-06

**PASS: unchanged OpenTUI TypeScript renders, accepts input, resizes, destroys and
recreates in Vivari workers. PASS: the actual full OpenCode CLI reaches its provider
dialog and returns to the shell. BLOCKED: TUI model response → file edit → Vite HMR.**

## Implementation and pins

- Vivari upstream `2629c71097238400c45aefa213ef61df4794c2b7`, cumulative source patch
  `vivari/patches/0001-sqlite.patch`.
- OpenTUI **0.4.5**, source `0c8c4f7cff2927e3df63a9757a45eff9a343611c`, Zig **0.15.2**.
- OpenCode source **`5cf9f517cfec3ef68d3e68a12a6a4b3163947f44`**, isolated frozen
  install in `.runtime/opencode-tui-source`; source-lock Solid **1.9.10**.
  This is a separate pin from published `@opencode-ai/cli@0.0.0-dev-19167`.

`scripts/opentui-wire.ts` generates Zig boundary wrappers during the pinned native
build. Internal native records and OpenTUI TypeScript stay unchanged. StyledChunk
arrays are converted into temporary native arrays and freed after synchronous
calls; outbound TerminalCapabilities converts usize lengths into u64 wire slots.
Lengths are checked before narrowing, ranges against linear memory, and colors
for alignment. Invalid inputs panic explicitly. The reactor imports a growable
function table with manifest `tableInitial: 4096`.

**Correction to the previous audit:** the host packer uses 8-byte pointers, but the
actual worker reports `process.arch === "wasm32"` and uses 4-byte pointers. TS still
explicitly declares u64 lengths. Guest StyledChunk is **40 bytes**, not 56:

| Field | Guest TS offset | Internal Zig offset |
|---|---:|---:|
| text pointer | 0 | 0 |
| text length | 8 | 4 |
| fg pointer | 16 | 8 |
| bg pointer | 20 | 12 |
| attributes | 24 | 16 |
| link pointer | 28 | 20 |
| link length | 32 | 24 |
| size | **40** | **28** |

All **24** TS record definitions are extracted by `audit-opentui-ffi.ts`, measured
with Zig, and asserted using the actual packer in guest `probes/tui/abi.mjs`.
TerminalCapabilities is 56 bytes. Cursor options, line info, span/reserve and the
remaining audited layouts already match wasm32 and need no conversion.

Optional audio preserves eager symbol loading: compiled `createAudioEngine`
returns `INVALID_HANDLE`, so unchanged TS returns null and `Audio.create()` throws.
Other audio operations panic as unavailable; no runtime symbol placeholders exist.
Source patches/build generation are reproducible; installed packages and emitted
bundles are never hand-edited. OpenTUI/Yoga retain upstream MIT licensing and
dependency hashes in the pinned checkout; generated receipts are local evidence,
not a separately published binary distribution.

## Reusable runtime gains

1. Native-owned FFI mirrors write back **only JS-changed bytes** against refreshed
   baselines. An unchanged mirror can no longer overwrite native allocator writes
   performed while pinning another argument. An independent compiled C allocator-
   epoch regression checks this behavior.
2. `require('bun')` aliases the supported Bun shim namespace without installing a
   global or fabricating `process.versions.bun`.
3. HTTP `fetch` to localhost/127.0.0.1/::1 uses the guest Node HTTP/TCP byte relay.
   Binary requests, status/headers, streaming responses/SSE and abort are qualified
   across workers. Uploads are buffered. Automatic redirects explicitly reject;
   manual redirects are supported. This is a bounded Fetch subset, not full Fetch
   conformance. Host requests use the existing `host.vivari.internal` alias, routed
   after guest-loopback detection. The harness model proxy URL now uses that alias.
   A guest fetch of `http://host.vivari.internal:5205/` returned 200 and the actual
   harness HTML after this change; no new model request was made.

FFI retains one open library per process, a 64 MiB pin budget, transient JS buffers
retained until close, synchronized mirrors rather than external zero-copy buffers,
and rejection of distinct overlapping mirrors. Baselines add memory overhead.
Native object/allocation liveness is not inferred; retained mirrors require stable
native allocations. No consumer-symbol logic was added to generic FFI.

## Measured gates

| Gate | Result |
|---|---|
| Independent C FFI, both facades, allocator-epoch regression | PASS, headless and Chrome workers |
| Independent cross-worker loopback Fetch | PASS: binary POST, headers/status, first SSE chunk, abort, 204, 404, redirects |
| Compiled shim rejection controls | PASS: overflowing u64 length, invalid memory range, unavailable audio |
| Real RenderLib ABI | PASS: multichunk UTF-8/colors/hyperlinks, readback, line arrays, placeholders, viewport, capabilities, cursor colors, spans |
| Growth / native lifecycle | PASS: 70 KB text, preserved 70005 bytes, three object recreation cycles; native line width saturates at 65535 |
| Visible createCliRenderer + colored TextRenderable | PASS: typed `hello`, 186×19 → 74×14, destroy/recreate → 93×18, `TUI_LIFECYCLE_PASS`, usable shell |
| Runtime rebuild / full upstream verify-node | PASS after loopback change |
| POC production build | PASS after model host-alias update |
| Full actual OpenCode CLI | PASS: discovers real guest server, provider dialog, typed `nemotron`, 186×19 → 116×26, Ctrl+C to usable shell |
| Actual TUI model / tool edit / Vite HMR | BLOCKED; no model response or file edit performed |

All application executions are workers. Host Bun/Zig only build/package assets;
Browser Control drives the visible terminal. OpenCode server uses real durable
SQLite in the browser. A headless launch without persistence correctly failed
`SQLITE_CANTOPEN: durable persistence unavailable`.

## OpenCode packaging and remaining blocker

`scripts/package-opencode-tui.ts` packages both the full CLI and a diagnostic
direct `runTui` entry using the official Solid transform and published jsonc-parser
ESM entry. Solid imports are canonicalized to the same reactive module identities:
otherwise the plugin's server.js content substitution and direct solid.js import
produce duplicate contexts and `No renderer found`. No Solid version upgrade or
application source patch is used.

Start the real guest server separately with
`node /opencode-tui/cli/entry.cjs serve --port 4096 --register`, then launch
`bun /opencode-tui/cli/entry.cjs`. Source auto-start currently treats non-Bun
`process.execPath` as a compiled executable, so a separately running server is a
prerequisite. The diagnostic app wrapper can remain alive after renderer destroy;
the full CLI's actual NodeRuntime shutdown returns to the shell.

Guest-authenticated probes observe `/api/health` 200 and `/openapi.json` 200, but
legacy `/config/providers`, `/provider`, `/agent`, `/config`, `/path` return empty
404. OpenAPI exposes `/api/agent`, `/api/model`, `/api/provider` and related paths.
The pinned `packages/cli/src/tui.ts` gracefulFetch fallback turns legacy 404s into
empty provider/config/agent data. The visible provider search therefore says
**No results found**. The server also logs **Failed to fetch models.dev**.
Credentials stayed guest-side and were not logged.

The reproducible CLI acceptance runner also passed after waiting for the native
dialog to recenter, rather than merely observing xterm's changed dimensions.
Its repeat resize capture retained a stray old `esc` cell at the right edge;
input, dialog recentering and shutdown pass, but repaint cleanliness is not fully
qualified.

Next: resolve the pinned application's TUI/server API compatibility explicitly,
then qualify provider/catalog access, a real TUI task, a verified model-driven
file diff and same-Document Vite HMR. Earlier SDK/model/HMR results are historical
controls and do not satisfy this TUI gate.

## Reproduce and evidence

From `vivari/`, with the pinned prerequisites in README:

```sh
bun scripts/build-ffi-probe.ts
bun scripts/build-opentui-wasm.ts
bun scripts/audit-opentui-ffi.ts
bun scripts/package-tui.ts
TMPDIR="$(mktemp -d)" bun scripts/build-runtime.ts patched
bunx --package node-bin-darwin-arm64@24.18.0 node scripts/ffi-headless.mjs --opentui
bun run build
```

For OpenCode, create a clean checkout/worktree at the exact source pin in
`.runtime/opencode-tui-source`, run `bun install --frozen-lockfile` there, then
`bun scripts/package-opencode-tui.ts` from `vivari/`. `OPENCODE_SOURCE` can select
another clean pinned checkout. `--opencode` on the headless runner is diagnostic,
not an acceptance gate.

Use a free origin and preserve OPFS. Current isolated origins:

- **:5204**, Browser Control `gentle-tiger-571`: renderer proof, idle Shell 1.
- **:5205**, Browser Control `lucky-panda-152`: real guest OpenCode server4096,
  idle Shell 1 after CLI teardown. Earlier :5202/:5203 were preserved.

Browser Control CLI runners from repo root (respect each script's origin guard):

```sh
browser-control execute --session SESSION --file browser-container-poc/vivari/scripts/ffi-browser.js
browser-control execute --session SESSION --file browser-container-poc/vivari/scripts/wire-tui-accept.js
# On :5205 after FFI delivery:
browser-control execute --session SESSION --file browser-container-poc/vivari/scripts/opencode-source-browser.js
browser-control execute --session SESSION --file browser-container-poc/vivari/scripts/opencode-tui-accept.js
```

Ignored `doc/logs/vivari/` evidence includes `wire-tui-browser.json`, visually
inspected `wire-tui-cycle-2.png` and `wire-opencode-provider.png`,
`wire-opencode-tui.json`, `wire-opencode-http.json`, `wire-browser.json`,
`wire-fetch-headless.log`, `wire-runtime-{build,verify}.log`, `wire-ui-build.log`,
`wire-final-headless.log` (final `--opentui` pass), and `wire-opencode-package.log`.
Receipts contain asset SHA-256 hashes, build pins
and guest-verified delivery. Generated build/layout/package metadata lives under
`.runtime/`; only source scripts, probes, patches and documentation are committed.
