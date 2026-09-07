# Vivari general WASM FFI continuation — 2026-09-06

**Superseded checkpoint:** [compiled wire shim and real TUI results](vivari-wire-results.md).
The renderer gate now passes. The 56-byte TS finding below measured the host:
the actual wasm32 guest packs StyledChunk into **40 bytes**, versus Zig's 28.
The compiled boundary converts that mixed-width layout and outbound capabilities;
audio creation returns an explicit invalid handle. Native mirror writeback now
copies only JS-changed bytes, preserving native allocator mutations. The remaining
model/edit blocker is the pinned OpenCode TUI/server API mismatch. This report
retains the earlier contract and investigation; its blocked gates and live-state
instructions describe that earlier run.

**PASS: an independently compiled C library runs through both `bun:ffi` and
`node:ffi` in real Vivari browser workers.** The implementation is a general
runtime substrate, with no OpenTUI symbol names or TypeScript RenderLib adapter.

**OpenTUI TypeScript acceptance remains BLOCKED.** Its unchanged published code
now reaches the actual WASM artifact through its existing Node FFI backend, then
`createCliRenderer()` fails explicitly on `missing export createAudioEngine`.
The separate ABI probe establishes another blocker: its actual StyledChunk
packer emits 56-byte native64 records; the actual Zig declaration is 28 bytes on
wasm32. No TypeScript renderer frame, TextRenderable, TUI input/resize/cleanup,
or actual OpenCode TUI/model/edit gate passed in this continuation.

## Architecture and supported contract

Source: `vivari/.runtime/patched/packages/runtime/builtins/ffi.js`, carried in the
cumulative `vivari/patches/0001-sqlite.patch`. Both facades share one memory owner
per process. Runtime identity remains `linux-wasm32`, with no fabricated Bun
version. The Node facade is justified by OpenTUI's real `process.versions`
detection; invoking guest `bun` still selects OpenTUI's Node backend.

`dlopen` accepts an explicit guest `.ffi.json` artifact manifest:

```json
{
  "abi": "vivari-wasm32-flat-v1",
  "wasm": "ffi-library.wasm",
  "tableInitial": 128
}
```

The asset resolves relative to the manifest through guest fs, and is compiled
synchronously in the process worker. A reactor must export `memory`,
`ffi_alloc(u32)->ptr`, and `ffi_free(ptr,u32)`. Optional `tableInitial` supplies
`env.__indirect_function_table` for builds using an imported growable table.
An exported growable table is also supported. WASI preview1 is initialized using
the existing runtime. Unknown imports fail WebAssembly linking.

Supported surface:

- Bun `dlopen(...).symbols` and `.close()`, `ptr(buffer/view, offset)`,
  `JSCallback` with `.ptr`, `.threadsafe === false`, `.close()`;
  `read` scalar methods and bounded `toArrayBuffer` mirrors.
- Scalar signatures: i8/u8/i16/u16/i32/u32/i64/u64/f32/f64/bool/ptr/void, their
  implemented C-style aliases and numeric Bun type IDs. i64/u64 require BigInt.
  This is not a complete Bun FFIType enumeration or coercion implementation.
- Actual WASM parameter/result types are checked before initialization/calls.
  No guessing from JS function arity. A declared void result may discard an actual
  scalar return, as native FFI does. This generic rule fixes OpenTUI's
  `editorViewGetViewport`: TS declares void while the native export returns bool.
- Node `dlopen` returns `{lib, functions}`; signatures use `arguments`/`return`.
  `getRawPointer` and pointer arguments/results use BigInt.
  `lib.registerCallback`, `unregisterCallback`, and `close` use the same substrate.
- Pointer values are actual wasm32 offsets. Typed-array views of the same JS
  backing buffer retain relative offsets and alias the same allocation.
  Full backing buffers are pinned and copied in/out at call/callback boundaries.
  Native-retained pointers remain stable until library close. This also means
  transient inputs are conservatively retained until close, not promptly freed.
- Native writes are visible to JS before callbacks. JS writes reach WASM before
  a reentrant call or callback return. Memory views are reacquired after growth.
  Callback exceptions unwind; closed callback table entries trap.
- `toArrayBuffer` supplies synchronized mirrors, not arbitrary zero-copy external
  ArrayBuffers. Identical ranges reuse their buffer; distinct overlapping ranges
  fail explicitly. Mirrored native allocations must remain valid until library
  close. Copies requested by Node use a snapshot of the mirror.

### Explicit limits

Only **one open library per process**. `ptr`, reads and callbacks require that
owner to be open. JS pins have a combined **64 MiB** budget and retain their
owners until close. Close frees facade-owned allocations and invalidates symbol
wrappers/callbacks; applications must destroy their own native objects first.
Raw numeric offsets do not carry provenance or native allocation liveness.

No native ELF/Mach-O/shared-library execution, dlopen(null), symbol-address
overrides, variadics, C compilation, N-API, string/CString conversion, usize,
arbitrary struct-by-value returns, multiple memories, shared memory, threadsafe
or asynchronous callbacks. Unsupported signatures/options and missing symbols
throw. There are no successful audio/native-function placeholders.

Pointer-bearing records **must already use the artifact ABI**. `ptr` tells a
loader neither the size nor the field types of its pointee. This substrate cannot
infer layout or recursively relocate unknown bytes, and does not inspect consumer
names to do so. Native allocations cannot be freed/reused behind a retained
mirror. These constraints exclude some unmodified libraries today.

## Independent consumer proof

`vivari/probes/runtime/ffi-library.c` is compiled by pinned Zig 0.15.2's C driver
to a real WASI reactor. It has no renderer dependency. `ffi-contract.cjs` uses
the public FFI facades, not raw WebAssembly instantiation.

| Observable behavior | Headless guest worker | Built Chrome worker |
|---|---|---|
| Typed scalar calls, u64 BigInt, f32, numeric FFIType | PASS | PASS |
| Pointer copy-in/out and overlapping typed-array views | PASS | PASS |
| Retained pointer sees later JS writes | PASS | PASS |
| Memory growth with pinned and native-owned mirrored buffers | PASS | PASS |
| Real pointer-bearing wasm32 struct consumed by compiled C | PASS | PASS |
| Native → JS callback, native writes visible on entry | PASS | PASS |
| Reentrant call and JS writes visible after callback | PASS | PASS |
| Callback close/stale trap; library close/use-after-close | PASS | PASS |
| Rejection: native path, bad signature, missing export, overlapping mirrors, threadsafe | PASS | PASS |
| Node BigInt pointer and owned callback facade | PASS | PASS |

The browser runner hashes assets before delivery and again in guest workers.
The same contract was launched with real keyboard input in visible Shell 1;
it printed `FFI_CONTRACT_PASS` and returned to a usable prompt.

## Exact OpenTUI ABI finding and next native-build work

`scripts/audit-opentui-ffi.ts` extracts the pinned TypeScript field definitions,
asks the installed real `bun-ffi-structs` packer for its layout, extracts the actual
Zig StyledChunk declaration, and compiles it for wasm32 to measure offsets:

| Field | TS byte offset | WASM byte offset |
|---|---:|---:|
| text pointer | 0 | 0 |
| text length | 8 | 4 |
| fg pointer | 16 | 8 |
| bg pointer | 24 | 12 |
| attributes | 32 | 16 |
| link pointer | 40 | 20 |
| link length | 48 | 24 |
| record size | **56** | **28** |

The TS lengths are u64; the Zig fields are usize. Simply copying a packed TS
array would make native text length read the high half of the text pointer and
misinterpret every subsequent field/record. Exporting the missing audio names
alone cannot satisfy TextRenderable.

**Preferred next adaptation:** a reproducible **native build-time ABI shim** at
the exported boundary. Keep external records in the existing 64-bit wire layout,
check each pointer/length before narrowing to wasm32, translate into the internal
Zig structs, and explicitly convert outbound records. Audit every exported
pointer-containing record, not only StyledChunk. Scalar offsets can remain actual
wasm32 offsets represented in u64 slots; the runtime continues owning pinning.
This preserves the TS library and avoids renderer-specific runtime branches.

An alternative is **explicit general layout metadata** per artifact/export for
recursive in/out marshalling, including array counts and retention policy. That
is substantially more complex for returned arrays and retained pointers, and
cannot be inferred from existing `bun:ffi` declarations. Neither approach has
been implemented or qualified here.

Audio also needs a deliberate native portability decision: build actual supported
audio or provide a clearly unavailable native API profile that fails on use;
do not silently synthesize successful exports in the runtime. The existing profile
still omits audio and therefore correctly fails eager dlopen. Yoga's actual JS
callback paths and OpenTUI's native-buffer lifetimes remain unqualified.

## Reproduce, evidence, live state

From `vivari/`:

```sh
bun scripts/build-ffi-probe.ts
bun scripts/build-opentui-wasm.ts
bun scripts/audit-opentui-ffi.ts
bun scripts/package-tui.ts
TMPDIR="$(mktemp -d)" bun scripts/build-runtime.ts patched
bunx --package node-bin-darwin-arm64@24.18.0 node scripts/ffi-headless.mjs --opentui
bun run build
bun run dev --port 5203 --strictPort
```

`--opentui` asserts the recorded **blocked** gate; its exit zero is not renderer
acceptance. Runtime `scripts/verify-node.mjs` passed after the final substrate
changes, and the source runtime/POC production builds passed.

Boot an unused origin without resetting OPFS, then run from repo root:

```sh
browser-control execute --session SESSION --file browser-container-poc/vivari/scripts/ffi-browser.js
```

The runner guards :5203 and owns `/ffi-probe` and `/tui-probe`. Current live origin:
**http://127.0.0.1:5203/**, Browser Control **tidy-tiger-674**, idle Shell 1.
Try `bun /ffi-probe/contract.cjs`. The earlier :5202 page **lucky-falcon-533** and
its worker/shell were inspected and preserved; no origins or databases were reset.

Ignored evidence under `doc/logs/vivari/`: `ffi-browser.json` (both cases,
delivery hashes, full runtime/OpenTUI build metadata and measured layout),
`ffi-headless.log`, `ffi-runtime-build.log`, `ffi-runtime-verify.log`,
`ffi-ui-build.log`, `ffi-opentui-build.log`, `ffi-tui-package.log`.
Generated source/build files remain ignored. The new OpenTUI build only adds
the general allocator export names to the earlier native-port profile; it does
not modify installed packages or generated bundles.
