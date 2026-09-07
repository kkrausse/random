# Actual OpenCode TUI qualification — 2026-09-06

**Latest continuation:** [compiled ABI shim and real TUI results](vivari-wire-results.md).
Unchanged OpenTUI TypeScript passes the renderer lifecycle gate. The actual
source-pinned full OpenCode CLI renders its provider dialog, accepts search input,
resizes and returns to the shell on Ctrl+C. Model/edit/HMR remains blocked by
legacy TUI API paths returning 404 from its `/api/...` server, with a models.dev
fetch failure also logged. All sections below are historical audit evidence.

**Implementation continuation:** [real WASM core results](vivari-wasm-renderer-results.md)
supersede the cross-build blocker below. The real Zig renderer/edit buffer now
renders, accepts keyboard text, resizes and destroys in a browser worker using
a source-built WASI reactor and reusable `fd_pwrite` runtime support. The
TypeScript `createCliRenderer` / `TextRenderable` backend and actual OpenCode TUI
are still not reached. The following sections retain the original audit evidence.

**BLOCKED before first frame.** The actual pinned CLI installer rejects Vivari's
`linux-wasm32`. Independently, the real OpenTUI module imports in guest workers,
but `createCliRenderer()` rejects its native library target. A pinned Zig WASI
cross-build fails with nine compilation errors. This is a native renderer/backend
port, beyond the terminal geometry and stdin work already shipped.

No OpenCode TUI rendered, accepted a task, or edited a file. The independent
shell→Vite HMR control passed with a verified file diff and the same iframe
Document. That control is explicitly not model editing.

## Pins and audit

| Component | Pin / qualification scope |
|---|---|
| Published V2 CLI | `@opencode-ai/cli@0.0.0-dev-19167`, matching the existing SDK version |
| CLI tarball integrity | `sha512-lnDr5SGE7AfMnbAcOB3fvhYU/nUXJMA5mRSTO/DVCcxW7r09Fx0BNhHoDeXLHoAxAHsmrKkLL9zuj6wsXUpn5w==` |
| OpenCode source audit | `5cf9f517cfec3ef68d3e68a12a6a4b3163947f44` (local checkout, read-only) |
| Real OpenTUI dependency | `@opentui/core@0.4.5`, the audited source's catalog pin; frozen `vivari/probes/tui/bun.lock` |
| OpenTUI source | npm `gitHead` `0c8c4f7cff2927e3df63a9757a45eff9a343611c` / release v0.4.5 |
| Build tools | Bun 1.4.0, TypeScript 5.9.2, Zig 0.15.2 |
| Vivari | Existing cumulative patch SHA-256 `8457fe7e88d3ddf6c81dc5624f85b75c12fcfb2744e0434647864e565975182f`, upstream `2629c71097238400c45aefa213ef61df4794c2b7` |

The CLI npm pin and source audit are **separate pins**: the exact npm-release-to-
source identity was not established. Do not describe this as a source rebuild of
dev-19167. The audited CLI source uses the development command name `lildax`;
the tested published artifact exposes `opencode2`.

Audited source paths (under the source pins above):

- OpenCode `packages/cli/script/build.ts`: `Bun.build({compile: ...})` produces
  native Bun single executables for Linux/macOS/Windows x64/arm64, including
  baseline/musl variants. No wasm32 target is published in the CLI manifest.
- `packages/cli/src/index.ts` dynamically imports the default handler; the actual
  TUI in `packages/tui/src/app.tsx:194` calls `createCliRenderer`, then configures
  keymaps, theme, plugins, and application rendering.
- OpenTUI `src/zig.ts:5330`: `resolveRenderLib()` constructs `FFIRenderLib`.
  The earlier eager attempt swallows its error; an import succeeding is expected
  and is not native renderer initialization.
- `src/platform/ffi.ts`: Bun uses `bun:ffi`, Node uses experimental `node:ffi`.
  Both resolve native shared libraries and address/pointer/callback APIs.
  `setRenderLibPath()` changes a native library path, not the backend kind.
- `src/zig/build.zig`: native audio C code, Yoga C++20, libc/libc++, and platform
  audio/pthread dependencies. `renderer-output.zig` has real stdout and memory
  output backends, with optional threaded output. Memory output is a credible
  future WASM seam, but still belongs to the same native library today.

## Actual guest results

All application execution below used Vivari process workers in Chrome on the
new **http://127.0.0.1:5198/** origin, Browser Control **quiet-raven-411**.

| Gate | Result |
|---|---|
| Guest npm delivery of actual CLI | PASS using `--ignore-scripts --force`; this bypasses installation gates, not executable compatibility |
| Actual CLI postinstall | FAIL, exit 1: `OpenCode does not provide a binary for linux-wasm32` |
| Shell `opencode2` invocation | FAIL: `SyntaxError: Unexpected string`; the installed placeholder is shell text saying postinstall did not run, which Vivari's JS loader parses as JS. No native binary was reached |
| Packaged real OpenTUI | PASS, both Node/Bun export conditions; repeated packaging produced identical receipts/hashes |
| Verified browser delivery | PASS, all 17 assets SHA-256 checked before transfer and again by guest Node after fd assembly |
| Real OpenTUI import | PASS in both guest `node` and guest `bun` |
| `createCliRenderer()` | FAIL, both exit 1 without timeout: `Failed to initialize OpenTUI render library: Unsupported OpenTUI Node asset target: linux-wasm32` |
| `node:ffi` | Missing module |
| `bun:ffi.dlopen()` | Explicit unsupported-native-FFI exception; the exported function is an unsupported stub |
| Keyboard launch in visible xterm | PASS transport: actual keyboard typed the renderer command; same initialization error and usable prompt returned |
| Actual TUI first frame / input / resize | NOT REACHED, initialization failed |
| TUI task / model response / tool edit | NOT ATTEMPTED, renderer gate blocks them |
| Independent Vite/shared-file control | PASS, Vite 7.1.4 background job, Shell 2 guest Node edit, exact independently read source difference, same iframe Document, exact restoration |
| Host production build | PASS (`bun run build`, TypeScript and Vite) |
| Runtime Rust/WASM rebuild / upstream runtime suite | NOT RERUN; no runtime source or protocol changes in this slice |

Both guest commands report Node 24.18.0 emulation, `linux-wasm32`, and no
`process.versions.bun`, so OpenTUI runtime detection uses its Node backend even
in the Bun-conditioned packaged entry. Runtime identity was not spoofed. Geometry
was 100×30 for SDK probes; stdin isTTY was true and stdout isTTY false, including
the shell launch. That pre-existing fd/TTY gap is secondary to native code support.

The first host packaging attempt correctly rejected unexpected emitted assets;
the final packager includes Bun's parser WASM/query/worker assets rather than
silently discarding them. Node asset discovery fails on wasm32 before parser
asset loading, so this does not claim a complete parser asset qualification.

## Real compatible-build attempt

On an untouched OpenTUI checkout at the pin above, with its required Zig 0.15.2:

```sh
cd packages/core/src/zig
zig build -Dtarget=wasm32-wasi -Doptimize=ReleaseSmall
```

**FAIL: 9 compiler errors**, including:

- miniaudio: undeclared `sched_get_priority_min/max`, incomplete `sched_param`;
- `std.Thread.spawn`: cannot spawn threads in single-threaded mode (audio paths);
- audio `@atomicRmw/@atomicLoad(u64)`: target expects 32-bit or smaller atomics;
- `text-buffer.zig:1203`: allocator length `u64` cannot implicitly narrow to
  wasm32 `usize`.

This actually entered cross-compilation; it was not merely a missing-compiler
or unsupported-target-selector failure. Native source/build files and emitted
bundles were not hand-edited. Fixing these compiler errors alone would still
leave a WASM memory/callback ABI and OpenTUI backend integration to implement.

## Smallest credible next slice

**Port the real OpenTUI renderer core to a worker-loadable WASM backend first.**
Use the existing platform and `RenderLib` boundaries rather than adding a global
fake `bun:ffi` or falsely reporting x64/Bun identity.

1. Add a reproducible source build profile excluding optional audio and native
   render threads, retain actual text/edit-buffer/layout code, and fix checked
   wasm32 size conversions. Keep unsupported audio explicit.
2. Implement WASM-owned memory allocation/copy, pointer offsets, returned buffers,
   callback/event delivery, and lifetime management at the existing FFI/RenderLib
   boundary. Native JS addresses cannot be interpreted as WASM offsets. Yoga
   measurement callbacks and struct layouts must use that same ABI.
3. Wire the existing non-threaded/memory output seam to guest stdout (or a real
   WASI fd write), including terminal setup and teardown. Qualify one real
   `TextRenderable` and input control: first frame, keystrokes, resize, and clean
   destroy in a Vivari worker. This is a renderer dependency gate, not yet OpenCode.
4. Only then pin an exact OpenCode source revision, package its actual CLI/default
   TUI with the Solid transform, qualify startup/service transport and fd/raw-mode
   semantics, and submit the fixture-edit task through that real TUI. Keep model
   auth/HTTP proxy and same-Document HMR as subsequent independent gates.

This is a substantial dependency/backend port; a host OpenCode process, headless
SDK wrapper, or screenshot-shaped replacement would not satisfy the goal.

## Reproduce and retained evidence

From `vivari/`:

```sh
bun install --frozen-lockfile --ignore-scripts --cwd probes/tui
bun scripts/package-tui.ts
bun run build
bun run dev --port 5198
```

Use an **unused** origin; the current :5198 owns a live kernel and OPFS. Boot,
Open shell, then in guest Shell 1 (the fixture already has a package manifest):

```sh
cd /workspace
npm install --ignore-scripts --force @opencode-ai/cli@0.0.0-dev-19167
node node_modules/@opencode-ai/cli/postinstall.mjs
opencode2
bun run dev &
```

The guest install adds a CLI dependency to the isolated fixture manifest and
changes its install tree. It is not a frozen-fixture/install proof. The initial
run issued npm from a manifest-less subdirectory; npm installed into its ancestor
`/workspace`. The commands above make that destination explicit.

From repo root using your Browser Control session:

```sh
browser-control execute --session SESSION --file browser-container-poc/vivari/scripts/tui-browser.js
# Inspect window.tuiQualification until phase is complete or failed.
# Open Shell 2 with Vite preview ready, then:
browser-control execute --session SESSION --file browser-container-poc/vivari/scripts/tui-hmr-browser.js
```

`complete` means probes finished, **not TUI success**. The renderer errors/codes
are retained in `cases`; the HMR control identifies its actor as guest Node.
For a visible initialization attempt, type `node /tui-probe/node/renderer.cjs`
into Shell 2. The guest fixture source is restored after the HMR control.

Ignored evidence in `doc/logs/vivari/`: `tui-browser.json` (full cases, delivery
receipt, HMR before/after), `tui-package.log`, `tui-package-repeat.log` (identical),
`tui-wasm-build.log`, `tui-ui-build.log`, `tui-final.png`, `tui-build.json`.
Generated delivery receipt: `vivari/.runtime/tui-package/receipt.json`.

Live :5198 retains Vite job `%1` in Shell 1 and usable Shell 2, with guest preview
**http://127.0.0.1:5198/preview/5173/**. Browser workers are
`kernel-worker-ndFYwFs1.js` and `process-worker-CgOjqImJ.js` (build snapshot retained).
Earlier :5192/:5196/:5197 browser pages, jobs, services and OPFS were not touched.
The isolated :5198 CLI-relay CORS rejection is expected. Port :5194 had no model
proxy listener at inspection; no credential files were read or transferred and
no model call was made. Authentication is not the current stopping gate.

Latest headless evidence was independently read at
`vivari/.runtime/opencode-package/model-five-tools-3.log`: seven successful tools,
25 deltas, failing test→edit→passing unchanged test. It remains headless SDK
evidence, not evidence of this TUI goal.
