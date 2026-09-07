# Vivari → Linux native library: feasibility and executable slice

**PASS:** a real Vivari process worker requested native musl library work inside
browser QEMU Linux; 20 result cases and six explicit failures passed.
**Recommendation:** Linux native execution can replace WASM ports when the native
consumer and its ownership-sensitive JS stay together in Linux. A generic remote
`bun:ffi` replacement is neither implemented nor recommended for OpenTUI.

This is a named, asynchronous, copied-value RPC, `scan-v1`. It is deliberately
smaller than a renderer implementation. No host native library execution, canned
native output, or renderer stand-in participates in the proof.

## Executed boundary

```
Vivari process worker (client.cjs)
  stdout JSON request → browser harness
  → existing QEMU serial bridge HTTP GET
  → Linux loopback Bun service (guest.ts)
  → dlopen(/lib/ld-musl-x86_64.so.1), memchr + abs
  → JSON / existing gzip+base64 serial response
  → browser → atomic Vivari VFS reply mailbox → originating worker
```

The VFS mailbox is a prototype transport seam, polled every 5 ms. The request
originates from `vm.spawn('node', ...)`, not a host process or ordinary page
worker. No Vivari runtime change was needed. Native pointers exist only during
the Linux handler and never enter the wire representation. The guest service is
persistent; measurements exclude creating a new Bun process for each call.

### Exact contract and validation

Input: `{op:"scan-v1", bytes:number[], needle:u8, signed:i32}`. Bytes must be
integers 0–255, length ≤4096. `signed` excludes INT_MIN, whose C `abs` result is
not representable. Unknown fields and operations reject. Pointer and callback
fields are explicitly tested failures. Output is a byte index (first occurrence,
or -1), absolute integer, timings, and binary provenance. Errors are HTTP 400
with an error string. No raw struct blobs, pointer handles, callbacks, mutable
shared buffers, arbitrary symbol names, library paths or ABI descriptions are
accepted from the worker.

Linux validates the actual library file independently as little-endian ELF64,
EM_X86_64=62, then calls:

* `memchr(const void*, int, size_t) → void*`, declared `ptr,i32,u64 → ptr` on
  the explicitly gated Linux x64 ABI. Return addresses become relative offsets.
* `abs(int) → int`, declared `i32 → i32`.

The worker independently computes `Array.indexOf` and `Math.abs` expectations.
Cases include empty input/null result, embedded zero bytes, values ≥128, first
match among duplicates, absent needle, ±2147483647, and 15 varying 256-byte
arrays. Invalid bytes, fractional needle, INT_MIN, unknown operation, pointer
and callback requests all return their expected errors. This validates this
bounded ABI use; it does not qualify arbitrary u64 values, foreign record layouts,
pointer lifetimes, callbacks or general FFI coercions. Library ownership lasts
for the Linux service process; byte storage is retained through each synchronous
call. The worker removes reply files, rejects errors, and has a 120-second wait
deadline. Browser relay exceptions kill the client. The inherited serial request
timeout is 290 seconds; timeout/cancellation propagation remains a production gap.

## Measurements and evidence

Captured on isolated **http://127.0.0.1:5222/**, Browser Control
`quiet-badger-883`, using the existing browser QEMU emulator and actual Vivari
workers. `evidence.json` contains all raw inputs/results and measured timings.
`bun verify.ts` independently rechecks the artifact.

| 15 warm sequential 256-byte requests | Minimum | Median | p95 / maximum |
|---|---:|---:|---:|
| Vivari worker end-to-end wall ms | 535.605 | 639.060 | 1172.660 |
| Browser serial/HTTP/decode wall ms | 530.820 | 634.540 | 1171.115 |
| Two FFI calls, Linux guest clock ms | 0.115 | 0.135 | 1.365 |

First empty-input request: **6265.745 ms** worker end-to-end. Warm statistics
exclude the first five functional cases and all failure cases. p95 is nearest
rank with n=15, hence the maximum. The guest clock is QEMU's clock, not an
independent host-wall native microbenchmark. This shared-browser run had other
experiments active; these are observed transport costs, not a lower bound for
a future virtio/shared-memory channel. JSON escaping, serial I/O, Linux HTTP,
gzip/base64 and emulation scheduling are included. The ~4.52 ms difference
between warm medians suggests mailbox optimization alone cannot rescue this
transport. No per-call OpenTUI benchmark or frame-rate result is claimed.

## Actual current OpenTUI contract

Audited **@opentui/core 0.5.10**, local source revision
`f6673a04ccb671b9207da358c57152bfd27c781f`. Paths below are relative to
`../vivari/.runtime/opentui-v2-source/packages/core/src/`.
`bun audit.ts` AST-extracts the actual `dlopen` declarations and hashes the
source into `source-audit.json`: **423 symbols; 184 with ptr arguments;
39 with buffer arguments; 13 returning ptr**. Categories overlap and raw
signature types alone do not describe ownership. Many other object identities
are integer handles, which still need service-local lifetime management.

| Source seam | Actual behavior | Consequence for remote execution |
|---|---|---|
| `platform/ffi.ts:66–104,118–146` | Synchronous symbol facade, callback ownership, `ptr`, `toArrayBuffer`; Bun numbers vs Node bigint pointers | Replacing returns with Promises breaks callers; a synchronous worker wait still needs reentrant callback servicing |
| `zig.ts:644–655,3928–3982` | Text draw and individual cell/color writes call native symbols | Granularity can be per cell, not one call per frame; batching requires a new command protocol |
| `buffer.ts:82–109` | Four cached typed-array views over native char/fg/bg/attribute allocations | JS expects observable native memory, not snapshots without an ownership/synchronization contract |
| `zig.ts:310–314,4989–5025` | Stabilizes backing storage before obtaining retained pointers for text memory | Copying bytes just for the duration of one RPC is insufficient |
| `zig-structs.ts:20–45` | StyledChunk embeds text, color, link pointers and explicit u64 lengths | Native addresses embedded inside packed records cannot be relocated by generic scalar marshalling |
| `zig.ts:3541–3584,3630–3653` | Native log/event callbacks supply transient pointer+length data; event data is copied before microtask delivery | Event messages can be made asynchronous at a service boundary; callback pointer ABI cannot simply cross environments |
| `zig.ts:4905–4927`, `yoga.ts:294–320` | Yoga callbacks receive node/measurement constraints and call `yogaStoreMeasureResult` | Measurement is a synchronous, reentrant dependency, not a fire-and-forget notification |
| `zig.ts:3591–3621` | Disposes event sink, disconnects Yoga/log callbacks, then closes library | Remote object generations, teardown order and disconnect cleanup are mandatory |

The raw buffer views alone cover **24 bytes/cell** (char4 + fg8 + bg8 + attrs4):
a 100×30 buffer is 72,000 bytes before JSON/base64 and protocol overhead. Multiple
buffers and writeback increase that. This is a size calculation from source,
not a measured transfer workload. One round trip per cell at the observed median
would already cost ~32 minutes for 3,000 cells; actual frame call counts were not
profiled. Even one ~639 ms frame transaction misses a 16.7 ms / 60 Hz budget.

### Prior Vivari WASM work is real, and already solves different parts

Read-only references: `../doc/vivari-ffi-results.md`,
`../doc/vivari-wire-results.md`, `../doc/vivari-v2-results.md`, and
`../vivari/patches/0001-sqlite.patch`.

The WASM facade uses explicit `.ffi.json` artifacts, pinned buffers, native-owned
mirrors, callback trampolines and synchronization at call/callback boundaries.
The compiled OpenTUI wire adaptation fixed actual record differences: old-pin
worker StyledChunk was 40 bytes versus internal wasm32 Zig's 28, while a native
64-bit packer used 56. It qualified 24 old-pin record layouts, real RenderLib
operations and lifecycle. Later V2 documentation reports a matched real TUI →
model edit → same-Document HMR pass. These prior results were inspected, not
rerun here; their source pins differ from this current 423-symbol audit.

Linux avoids compiling OpenTUI/Yoga/audio dependencies to WASM **if their JS
consumer executes in Linux too**. It does not make a Vivari wasm32 packed struct
or mirrored JS ArrayBuffer suddenly valid in Linux's x64 address space. Thus
the existing WASM work is not replaced by changing `dlopen`'s transport.

## Recommended integration boundaries

1. **Lowest-risk OpenTUI boundary: run the complete OpenTUI consumer in Linux.**
   Keep TS renderer, native library, Yoga callbacks, retained buffers and native
   dependency resolution together. Send terminal input/resize in and PTY output
   out. Vivari can continue to accelerate Vite or other browser-suitable JS work.
   The existing `qemu/guest/preview-bridge.ts:9–40,72–77` already supplies PTY and
   guest execution; it has no FFI or shared-memory primitive.
2. **If application logic must stay in Vivari:** introduce an explicitly async,
   coarse Linux service. For rendering, transmit versioned scene/text updates,
   input events and bounded batches, then return acknowledgments/terminal output.
   Keep layout measurement and native buffer ownership in Linux. This is a new
   renderer/application split, not a drop-in RenderLib facade. Synchronous custom
   JS measurement callbacks need relocation or an explicit redesign.
3. **Other libraries:** bounded byte-in/value-out work (compression, hashing,
   parsing, database transactions) can use named operations and benefit from
   batching. Define binary envelopes, maximum sizes, request IDs, native object
   generations if needed, cancellation, crash cleanup and bounded queues. Replace
   the mailbox/serial prototype with a proper Vivari broker and faster guest
   transport before making performance commitments.

The sharp boundary is ownership and synchronous interaction, not merely whether
the native library can load. Generic remote FFI would additionally need address
translation, pointer-bearing record schemas, alias tracking, read/write barriers,
allocation lifetime tracking and synchronous callback/reentry arbitration.
SharedArrayBuffer can coordinate browser workers but does not provide a direct
mapping of Linux virtual addresses or its guest allocations.

## Reproduce

Requires the existing generated hybrid/QEMU/Vivari inputs. No downloads or
native rebuilds are performed. `provenance.json` records SHA-256 verification of
the reused QEMU files and fixed runtime; the source audit records its exact hash.
The loaded native musl file hashes to
`2fb72c67f292827c8c4095067197af7880c234a3a4060136e1b5518d10de1eb9`.
Linux image: Alpine 3.21, Linux 6.12.107-0-virt x86_64, Bun 1.4.2;
Vivari base `2629c71097238400c45aefa213ef61df4794c2b7` plus the existing hybrid
syscall wait-loop overlay. The image/toolchain's exact reused bytes are in the
provenance receipt. No copied third-party binaries are committed here.

```sh
# In hybrid-ffi/
bun audit.ts
bun server.ts
# Fresh owned Browser Control tab at http://127.0.0.1:5222/
# Click Start Linux, log in as root, wait for /workspace prompt.
# The slow login OpenCode version check can be interrupted with Ctrl+C.
# Click Connect Linux PTY bridge and wait for Ready.
# From repo root, on that isolated session:
browser-control execute --session SESSION --file browser-container-poc/hybrid-ffi/accept.js
browser-control execute --session SESSION 'return await page.evaluate(()=>window.ffiEvidence)'
# Save complete evidence via browser-control fs.writeFileSync, then:
bun verify.ts
```

The harness serves existing static hybrid assets read-only on :5222; GET-only
host routes provide no execution endpoint. Acceptance installs the tiny service
only in this VM's disposable `/tmp`, then boots Vivari and runs once. Repeat on
a fresh owned page to avoid stale service/worker state. The inherited buttons
for Vite/dependencies are not part of this experiment. Original :5213 and other
agents' pages are untouched. Closing this experiment's page destroys its Linux
processes/overlay. Only this directory is owned and committed by this slice.
