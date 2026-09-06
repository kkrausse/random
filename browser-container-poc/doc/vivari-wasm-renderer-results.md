# Vivari reusable WASI / OpenTUI core slice

2026-09-06. **PASS: real OpenTUI 0.4.5 Zig renderer and edit buffer execute as a
WASI reactor in a Vivari process worker.** Real keyboard text, ANSI output into
xterm, live resize and destroy-to-prompt passed, including after the computer's
software-update reboot. **This is not yet the TypeScript OpenTUI RenderLib backend
or OpenCode TUI.** `createCliRenderer()` / `TextRenderable` acceptance remains open.

## Architectural choice and reusable gain

Continue Vivari's workers, shared guest FS and WASM architecture. Standard
`WebAssembly.Module` / `Instance` and `node:wasi.WASI.initialize` already load
reactor libraries correctly; no new proprietary loader or generic FFI framework
was necessary. All application execution in the evidence below is browser workers.
Host Zig/Bun performs source compilation/packaging only.

The generic runtime change is **WASI `fd_pwrite`**:

- Regular-file scatter/gather writes at an explicit nonnegative JS-safe offset;
  sequential file position is preserved. Fresh memory views handle memory growth.
- stdin/stdout/stderr return WASI **ESPIPE (70)**; unknown fds return EBADF (8).
  Zig's ordinary output writer probes pwrite, then correctly falls back to
  fd_write. The old ENOSYS (52) made this renderer hang before its first output.
- Invalid/unsafe offsets and out-of-memory-range iovec/result ranges return
  EINVAL in this bounded implementation. Errors from actual guest fs propagate.
- This enables other WASI libc/Zig programs using positional writes and streaming
  fallback. An independent C reactor verifies exactly those behaviors; it does
  not depend on OpenTUI or any renderer-specific import.

Generic implementation belongs in Vivari's `packages/runtime/node/lib/wasi.js`,
carried by the cumulative `vivari/patches/0001-sqlite.patch`. The protocol and
worker topology are unchanged. Full fd rights enforcement, fd_pread, synchronous
WASI stdin, and poll_oneoff remain outside this slice. The existing poll_oneoff
returns ENOSYS; OpenTUI ignores this during its two shutdown sleeps, so destroy
passes without qualifying those delays. This is not general POSIX/PTY support.

## Explicit upstreamable OpenTUI adapter

Pin: `0c8c4f7cff2927e3df63a9757a45eff9a343611c` / 0.4.5, Zig **0.15.2**.
`vivari/patches/opentui/0001-wasm.patch` changes source build/output seams:

1. Build a wasm32-wasi **reactor**, export its actual library functions and memory.
2. Compile Yoga with its existing no-exceptions path (fatal errors terminate),
   avoiding missing WASI C++ exception runtime symbols. Native build flags stay
   on their native path.
3. Report single-threaded output as non-threadable and compile out thread spawn.
4. Checked `u64` file size → `usize` conversion in the real text buffer.

`scripts/build-opentui-wasm.ts` generates a WASM source entry from pinned
`lib.zig`: it removes the audio export block/import and adds `wasmAlloc` /
`wasmFree`. Audio exports are absent, not successful placeholders. It builds all
remaining real exports, including text/edit/layout code. It checks the exact
revision, Zig version and recognized patch before modifying source. No installed
package, emitted bundle, Yoga dependency cache, or WASM binary is hand-edited.
Dependencies retain the pinned upstream `build.zig.zon` hashes and licenses in
the source checkout; this is a source-build experiment, not a published binary
package. OpenTUI and Yoga are MIT licensed.

The guest probe uses actual exported native handles, wasm32 linear-memory offsets,
owned allocations and copied UTF-8 bytes. It reacquires memory views rather than
retaining detached views across growth. Colors use the actual u16 RGBA layout.
The real edit buffer owns inserted text; the real renderer generates all frame
and setup/shutdown ANSI. JS maps a deliberately small ASCII input surface to
insert calls and passes guest resize events to `resizeRenderer`. `q` destroys
both objects and frees the temporary buffers before exiting. Process-worker
termination remains the outer lifetime boundary on uncaught failure.

## Exact gates

| Gate | Result |
|---|---|
| Original nine cross-build errors | RESOLVED in this WASM profile: audio excluded, thread guard, checked size |
| Further linker failures | RESOLVED: reactor startup model and Yoga no-exceptions configuration |
| Repeat pinned WASM build | PASS; same OpenTUI artifact SHA-256 below |
| Runtime Rust/WASM + SDK source rebuild | PASS; isolated TMPDIR bypassed the known broken shared wasm-pack cache |
| Upstream runtime verify-node | PASS, full regression suite; host worker test only, not browser acceptance evidence |
| POC TypeScript / production build | PASS |
| Delivery | PASS, chunked transfer and SHA-256 independently checked inside guest workers |
| Real OpenTUI reactor initialize/create | PASS |
| Real edit buffer, first frame | PASS, `Real OpenTUI WASM:` at 186×19 |
| Browser keyboard | PASS, typed `hello` appears in native-rendered text and edit-buffer readback |
| Actual xterm element / guest resize | PASS, 186×19 → 74×14; guest final readback agrees |
| Destroy and allocation release | PASS, alternate buffer returns to normal and usable shell prompt |
| Independent raw WASI contract | PASS: positional bytes, unchanged seek position, multiple iovecs, memory growth, invalid range/offset, bad fd, stream ESPIPE |
| Independent compiled C libc reactor | PASS, pwrite stdout gets ESPIPE; guest file becomes `aXYd`; seek position stays 4 |
| TypeScript `createCliRenderer` / `TextRenderable` | NOT IMPLEMENTED / NOT REACHED |
| Yoga JS measurement callbacks and pointer-containing structs | NOT QUALIFIED; Yoga compiled, not a JS layout acceptance |
| Actual OpenCode TUI startup / model / tool edit / Vite HMR | NOT REACHED in this slice |

No headless SDK result is counted as TUI support. Previous editor and shell HMR
evidence remains historical evidence, not a new model-driven HMR result.

## Reproduce and evidence

From `vivari/`:

```sh
bun scripts/build-opentui-wasm.ts
# Runtime build needs installed POC dependencies and pinned Rust prerequisites in README.
TMPDIR="$(mktemp -d)" bun scripts/build-runtime.ts patched
bun run build
bun run dev --port 5202 --strictPort
```

Use a free origin for a fresh run; **:5202 is currently owned**. Browser Control
CLI session **lucky-falcon-533**, <http://127.0.0.1:5202/>. Boot without reset and
open Shell 1. From repo root:

```sh
browser-control execute --session SESSION --file browser-container-poc/vivari/scripts/wasm-tui-browser.js
browser-control execute --session SESSION --file browser-container-poc/vivari/scripts/wasm-tui-accept.js
```

The acceptance runner expects an idle Shell 1, changes its element dimensions,
and rewrites only dedicated `/workspace/wasi-*.txt` files. Delivery owns
`/wasm-tui`. Both scripts guard :5202; adjust that explicit guard when choosing a
new isolated origin. `state.wasmTuiRoot` optionally selects a different checkout.

Live Shell 1 is idle after passing. To try the core interactively:
`node /wasm-tui/core.cjs`, type ASCII letters/spaces, then `q` to quit. This is a
low-level renderer probe, not an editor UI or OpenCode frontend.

Ignored evidence in `doc/logs/vivari/`: `wasm-tui-browser.json` (build-linked
receipts, delivery hashes and results), `wasm-tui-frame.png` (visually inspected),
`wasm-runtime-build.log`, `wasm-runtime-verify.log`, `wasm-ui-build.log`, and
`opentui-wasm-port-build.log` (intermediate build evidence). Current build metadata:
`vivari/.runtime/opentui-wasm-build.json` and `patched-build.json`.

OpenTUI WASM SHA-256:
`d3d9f72797dccdc92a55314bc60b353b63d4b99de6a2a2457d677273e99767ee`.
Independent libc reactor SHA-256:
`4e0635e4e3241bb8e2172af3bc52e5de47f8d00ea73c045319cd15f5d4b5dc70`.

The software-update reboot lost in-memory jobs/browser sessions. Source, build
artifacts and disk logs survived. Recovery restarted only this slice's :5202
service and navigated/booted the recovered blank Browser Control session without
clearing OPFS. Other origins were never reset or rewritten by this slice; their
pre-reboot process liveness cannot be preserved across the computer restart.

## Next bounded slice

Implement an explicit OpenTUI **TypeScript WASM RenderLib/platform backend** over
this working reactor. Its main work is ownership/ABI, not library delivery:
transient pointer-argument copy-in/out; retained buffer allocation lifetimes;
pointer-containing struct layouts on wasm32 versus native 64-bit; same-thread
event/log/Yoga callback trampolines; clear unavailable-audio errors. Then run the
real `TextRenderable` and an input control via `createCliRenderer()`, including
resize and teardown. The current native FFI facade cannot safely be reused by
interpreting JS addresses as WASM offsets. Only after that gate should the real
OpenCode TypeScript/Solid TUI initialization and model→edit→HMR flow proceed.
