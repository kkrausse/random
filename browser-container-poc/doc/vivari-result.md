# Vivari feasibility result — September 5–6, 2026

**Recommendation: retain Vivari for the fast JS workspace and do one bounded
OpenCode native-dependency adaptation probe next. The real OpenCode host is
blocked before import; this is not an end-to-end agent success.**

Implementation: [`../vivari/`](../vivari/README.md). Upstream SDK `1.0.0`, gitHead
`2629c71097238400c45aefa213ef61df4794c2b7` (MIT). No upstream runtime edits;
three integration fixes: root worker asset delivery, packaged npm payload, and
inbound WebSocket/SSE forwarding to the preview iframe.

## Gate 1: real fixture is fast when warm

Real Vite **7.1.4**, React/React DOM **19.1.1**, plugin-react **5.0.2**, TypeScript
**5.9.2**, Lucide **0.542.0**. All eight direct dependency versions were checked
in the browser VFS against the unchanged fixture manifest. The original Bun lock
is preserved in the host fixture, but the runtime ignores its frozen semantics
and resolves through real npm **10.9.2**. Transitive equivalence with QEMU is not
established.

Device: Apple M4 Pro, 24 GiB RAM, macOS; Chrome **152.0.0.0**. The browser exposed
12 logical CPUs/16 GiB deviceMemory on `localhost`; an earlier `127.0.0.1` batch
exposed 3/8. These are recorded as reported rather than normalized. The browser
was foregrounded for warm profiling. Other host applications remained running.

### Fresh-origin startup

New `http://localhost:5190` origin, no prior Vivari VFS/dependency cache on that
origin. Browser process, host server, OS and network infrastructure were already
warm from earlier probes. This is **origin-cold, not machine/browser-cold**.

| Phase | Host-clock latency |
| --- | ---: |
| `Vivari.boot()` | 269.520 ms |
| Browser `bun install --frozen-lockfile` (delegates to npm) | 57,309.795 ms |
| Spawn Vite → server-ready event | 541.055 ms |
| Spawn Vite → first visible fixture heading | 3,001.780 ms |
| Two Bun fixture tests, exit 0 | 99.230 ms |

Phases were manually triggered; do not sum them into an observed end-to-end
startup. Boot excludes outer page delivery and fixture mount. Vite's own printed
412 ms is a guest measurement, separate from host timings. The two tests exercise
React server rendering/escaping and VFS source/asset reads. `node:test` failed
with module-not-found (exit 1), so the fixture uses `bun:test`. The Bun shim
prints an internal `process.exit called` stack despite the successful 2-pass,
0-fail result and exit 0.

### Warm samples (milliseconds, chronological order)

Order: first preview → two tests → five edit/restore cycles → three preview-only
reloads. Every edit and restoration checked that the preview document survived.
Source was restored to its original contents. A 150 ms pause between interactions
is outside timed regions; restoration edits also warm the transform pipeline.

| Phase | Individual samples | Median | Worst observed |
| --- | --- | ---: | ---: |
| Edit → visible | 39.785, 32.830, 32.205, 36.715, 27.265 | 32.830 | 39.785 |
| Restore → visible | 33.170, 33.235, 32.735, 36.735, 35.860 | 33.235 | 36.735 |
| Preview reload → visible | 44.705, 33.705, 32.235 | 33.705 | 44.705 |

An earlier complete warm batch on `127.0.0.1` gave edit samples
33.985, 31.540, 35.140, 34.205, 35.530 ms (median 34.205, worst 35.530), and
reloads 47.955, 36.120, 34.060 ms (median 36.120, worst 47.955).

Visibility means heading text with nonzero geometry observed with the host
animation clock; it is not measured compositor paint or completion of every
image/font. Reloads keep the runtime, server and dependency caches alive. Samples
are small and fixture-specific; no claim about large repositories or tail latency.

Against the [QEMU results](profiling.md), this comfortably clears the proposed
500 ms warm-edit goal. QEMU's focused warm edit was 1.883 s and cached preview
reloads about 13–14 s. Different transport, transitive dependency resolution,
warm-up histories and timing harnesses prevent a controlled speedup ratio.

## Compatibility failures and adaptations

| Probe | Evidence / disposition |
| --- | --- |
| Published SDK worker delivery | SDK references `/assets/*`; explicit serving/emission is required. Workers also need isolation headers. Fixed in the host Vite plugin. |
| npm bootstrap | Package omits `/vendor/npm-pack.bin`; initial Bun install exited 127 with npm delegation ENOENT. Built upstream-format payload from locked npm 10.9.2. |
| Genuine HMR | Vite reported updates but no visible change for 30 s. SDK omitted inbound tunnel relay. Added forwarding; complete five-edit batches then passed. |
| Rapid edit/restore | Immediate restoration after a sub-50 ms update produced no second HMR notification; retrying the write later recovered. 150 ms pacing allows a successful benchmark but does not fix the lost rapid update. Needs a minimal watcher-throttle reproduction. |
| Harness reload | Editing imported host fixture/harness code tore down the guest during an early batch. Outer harness HMR disabled; those failed batches are excluded. |
| Frozen lock | `bun install --frozen-lockfile` announces npm delegation and rewrites `bun.lock`. Direct pins verified; transitive lock semantics failed. |
| Source persistence | Dedicated recovery marker and exact original source survived page reload; recovery boot took 9.193 s. |
| Dependency recovery | `node_modules/vite/bin/vite.js` was absent after that recovery. On an earlier reload `bun run dev` reported `vite: not found`; reinstall succeeded in 13.929 s. Other restored boots observed at 8.462 s and 11.382 s. Treat source and dependency persistence separately. |
| Subprocess cancellation | Node interval process emitted seven lines, kill resolved exit 143, stream closed, and no more output appeared during a 200 ms observation. This does not prove OpenCode cancellation. |

## Gate 2: blocked before real host import

Read the current V2 SDK documentation and pinned `@opencode-ai/sdk` to
**0.0.0-dev-19167**, including matching OpenCode packages. The executable probe
uses `OpenCode.create()` and `host.sessions.create({location:{directory:
"/workspace"}})`, then closes the host. It never uses an external OpenCode server.

Unmodified npm peer resolution pulled metadata for a very broad optional peer
tree; that attempt was cancelled. A bounded retry with `--legacy-peer-deps`
failed after **54.653 s**:

```text
npm error code EBADPLATFORM
npm error notsup Unsupported platform for @ff-labs/fff-bun@0.10.5:
wanted cpu x64,arm64; current os linux, cpu wasm32
```

This is a required package dependency, not a model/auth failure. Host-side
inspection confirms the package has native platform binaries and no wasm32
target. The pinned core also contains `bun:ffi` process-lock and PTY paths, and
separate `bun:sqlite` / `node:sqlite` database implementations. Those paths are
**static compatibility risks, not observed runtime exceptions**: installation
failed first. Import, host creation, session storage, host tools, model streaming,
prompt-to-edit-to-HMR and OpenCode cancellation remain unverified.

Next bounded probe: determine whether the real SDK's Node-compatible host can
omit/fallback from the native file finder and native PTY/process-lock adapters
without replacing the real host or silently changing tool results. A platform
check bypass alone would not prove native support. If this requires a substantial
compatibility subsystem, stop and revisit the host architecture. Fast Vite alone
does not justify transparent Linux process routing or a shared filesystem layer.

## Evidence

Raw local reports under `doc/logs/vivari/` (gitignored):

- `1788666653562-capture.json`: fresh-origin timing, actual dependency versions,
  source, terminal output and test result.
- `1788666673641-profile.json`: final five edits/restorations and three reloads.
- `1788666087959-profile.json`: earlier passing warm batch.
- `1788665958209-profile.json`, `1788666028822-profile.json`: failed exploratory
  batches (document replacement / Vite absent), not successful timing evidence.
- `opencode-platform-failure.json`: actual failed dependency-install checkpoint.
- `cancellation.json`: subprocess cancellation evidence.
- `recovery.json`: recovery marker, exact original source, boot timing and missing
  Vite dependency after page reload.

The committed result card retains the individual successful samples and exact
blocker even when local reports are unavailable. Setup and browser scripts are
committed; `bun run build` checks host TypeScript and production asset emission.
