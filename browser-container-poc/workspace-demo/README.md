# workspace-demo (placeholder consumer for Workspace/Runtime API)

Status: scaffold only. The real `workspace-api` package (task F1, owned by a
parallel agent at `browser-container-poc/workspace-api/`) is not implemented
yet, so this demo does not run end-to-end. That is expected.

What the existing POC demo does (for reference): `opencode-demo/main.ts` boots
`Vivari`, mounts `/workspace`, installs deps, spawns OpenCode + Vite + shell,
and wires preview/tunnel messages manually. This demo must NOT copy that glue.

## Intended imports

```ts
import { Workspace, Runtime, attachPreview } from "workspace-api";
```

Flow (mirrors `doc/api-plan.md` Proposed usage):

`Workspace.open` → `workspace.fs.writeFile` → `Runtime.start` →
`runtime.tools.ripgrep` → `runtime.node({ entry: vite })` →
`runtime.expose(5173)` → `attachPreview(iframe, endpoint)` →
stop/dispose → `runtime.stop` → `workspace.flush/close`.

## What is stubbed

`src/api-stub.ts` declares the same typed surface (`Workspace`, `Runtime`,
`attachPreview`, `consumeOutput`, `ExecutionHandle`, `EndpointHandle`) but every
method throws/rejects `not implemented`. UI (`src/main.ts`, `index.html`) is
wired to the stub so the intended call sequence is visible and typechecks, but
reports honest failure at runtime.

## Wire-up step (after API agent finishes F1)

1. Implement `browser-container-poc/workspace-api/` per `doc/api-handoff.md`.
2. In `src/main.ts`, replace `from "./api-stub"` with `from "workspace-api"`
   (add dependency in `package.json`).
3. Delete `src/api-stub.ts` (or keep only for type reference).
4. Verify: open workspace → write/readback roundtrip → ripgrep query →
   Start Vite → same-document HMR in iframe → Stop → flush/reload persistence.
5. No shell requirement, no kernel bridge glue, no `window.demo` globals, no
   host Vite serving guest source.

## Run (once API exists)

```sh
bun install
bun run typecheck
bun run dev   # serves index.html (host server TBD)
```
