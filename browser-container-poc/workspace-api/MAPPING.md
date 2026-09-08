# A0 — contracts + source/distribution seam: mapping

Status: A0 done (type skeleton + gap mapping). No backend wired; every entry
point rejects instead of reporting fabricated success.

## Library source/distribution seam

- Library home (new, A0-owned): `browser-container-poc/workspace-api/`
  (`src/`, `src/browser/`, `src/tools/ripgrep/`, `examples/basic/`, `tests/`).
- Runtime distribution consumed explicitly via `Distribution { name, version,
  assetBaseUrl }` in `Runtime.start`. No distribution builder exists yet — no
  pinned worker/WASM/SW asset set, no hashes, no versioning.
- Browser consumers resolve worker/WASM/SW assets from `assetBaseUrl` once a
  distribution build exists. A0 does not copy emitted workers into the new
  tree (per handoff: keep distribution identity explicit).
- Backend gaps are reported, not stubbed: `Workspace.open` / `Runtime.start`
  throw `BackendUnavailableError`; `attachPreview` and default ripgrep
  `invoke` reject. Nothing reports success without a backend.

## Contract → existing-backend gaps (all verified by reading, not wired)

| A0 contract | Existing code (read-only) | Gap for A1+ |
| --- | --- | --- |
| `Workspace.open` w/o launching programs; `workspace.fs` as one authoritative tree | `Vivari.boot` couples kernel+workers+VFS startup with execution; `FileSystemAPI` in `vivari/.runtime/patched/packages/core/src/fs.ts` rides the shared `KernelBridge`; FS worker owns VFS + OPFS write-behind | No standalone storage-lifetime owner; kernel-worker owns VFS. A1 must trace `workers/{kernel,fs,process}-worker.ts` + `kernel-host` FS path and pick a topology where storage outlives execution |
| `flush()` durability barrier; `persistence` state (durable/ephemeral/failed) | OPFS write-behind exists (`kernel-host/opfs-persistence.js`); early failures only surface via `BootOptions.onLog` text (`types.ts`, `vivari.ts`); readiness is untyped ready-gate | No structured persistence state; no public flush barrier; accepted-write boundary undefined. A2 work |
| `Runtime.start({distribution, workspace, tools})`, no project programs | `Vivari.boot` starts execution infra eagerly; `openTerminal`/demo flow auto-runs servers (`VV_RUN`) | No validated distribution/tool-compat check; no program-free start. B1/A1 integration |
| `runtime.node({entry,args,cwd,env})` + byte-split stdout/stderr, `exited`, idempotent `stop()` | `Vivari.spawn(command, args)` does PATH/`/bin` lookup (`kernel.js resolveProgram`); `VivariProcess` is merged-text streams | No typed module entrypoint; no byte-safe split stdout/stderr (bridge carries merged strings — needs real bridge extension, cannot wrap). B1 work |
| `runtime.expose(port)` — connectivity, no access enum | `server-ready`/`port` events + `previewUrl(port)` in `vivari.ts`; listen/close wiring incomplete; preview HTTP buffered + manual `vv-ws`/`vv-sse` forwarding | Missed-event races, listener close/identity, generation routing, SW control all unresolved. C1 work |
| `attachPreview(iframe, endpoint)` owns relay plumbing | `packages/core/src/bridge.ts` + `packages/studio/public/sw.js` hold transport; demo forwards tunnel messages manually | No encapsulated adapter; sender/connection ownership validation missing. C1/E1 work |
| `runtime.tools.ripgrep` typed, PATH-independent | `scripts/package-ripgrep.ts` emits `/bin/rg` launcher + real WASM payload; `probes/runtime/ripgrep-contract.cjs` holds fixtures; no typed TS binding | No worker entry/typed binding/structured-result contract. D1 work |
| Launch/exit errors, stream ownership, endpoint closure, attachment ownership | Partial: exit codes exist on process handles; structured error codes, single-reader/overflow/EOF, generation-scoped endpoint ownership do not | Open choices marked in `src/types.ts` doc comments; not silently enlarged |

## Open choices (explicit, unsettled)

- `workspace.close()` while attached: proposed reject (per plan); unenforced.
- Workspace-root vs runtime-root mapping: proposed `/workspace` mount; unwired.
- Structured `ErrorCode` set: seeded (`ENTRY_NOT_FOUND`, `LAUNCH_REJECTED`,
  `BACKEND_UNAVAILABLE`); launch/exit/stream/endpoint code table is B1/C1 work.
- Startup logs → structured state: `onLog` remains the only channel; A1/A2 must
  convert to `PersistenceState`.

## Verification

- `tsc --noEmit` in `workspace-api/` (system tsc 5.9.2): pass, including
  `@ts-expect-error` configured/missing-tool inference checks in
  `tests/tool-inference.ts` and the `examples/basic/consumer.ts` import check.
- No runtime tests: no backend to run against. No browser run (nothing to serve).

## Next task

**A1** — separate workspace lifetime from execution (depends on A0). Primary
seam: core FS API, bridge, FS/kernel workers.
