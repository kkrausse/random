# Local TypeScript package checkpoint

`@vivari/workspace-api@0.1.0` is a private, locally packable ESM package.
Nothing is published. Generated JS/declarations and runtime payloads are ignored.

## Public entrypoints

| Import | Environment / contract |
| --- | --- |
| `@vivari/workspace-api` | Browser Workspace, Runtime, storage, endpoints, previews and tools |
| `@vivari/workspace-api/react` | React 18/19 peer; WorkspaceProvider, useWorkspace, WorkspaceController, snapshot/connection/service/progress and diagnostic types |
| `@vivari/workspace-api/assets` | Bun/Node build/server only; readRuntimeAssets, copyRuntimeAssets, RuntimeAssetManifest |

The React entry imports the public core entry, keeping runtime class identity shared.
Core imports do not load React. No entry starts workers on import. Provider mount
creates only a controller/subscription; `controller.open()` acquires storage and
`startRuntime()` starts execution. SSR renders the initial snapshot. Browser
StrictMode effect replay uses deferred disposal; DOM/browser verification is pending.

The provider owns its controller. Call `controller.run(label, task)` to serialize
actions; failures are reported in `state.error`, not rethrown from `run`. Direct
methods reject normally. `close()` stops services/runtime, flushes and releases
storage; `dispose()` permanently aborts the controller. Reopen after `close`,
create a new provider after disposal. Existing origin lease constraints apply:
only `id: "default"`, one workspace owner per origin. Source seeding, ports,
Vite/OpenCode preparation, authentication and chat UI remain application recipes.

`onDiagnostic` is optional and captured on mount. Events include run ID, timestamp,
stage/operation elapsed time and redacted bounded data (16KB event payload cap).
There are no package diagnostic upload URLs, timers that upload, or network sinks.
The controller retains at most 160 activity strings. The application must bound
any diagnostic event retention it chooses; observer failures cannot break cleanup.

## Build and install locally

From this package directory, using Bun and TypeScript:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run build
bun pm pack --filename /absolute/output/workspace-api-0.1.0.tgz
```

`pack` runs the JS/declaration build. Its output contains `dist/lib`, documentation
and package metadata, excluding sources, build scripts, dependencies and runtime.
Build before running consumers; don't rebuild the package concurrently with a
consumer typecheck. A package build replaces `dist/lib`.

In an unrelated Bun TypeScript React project:

```sh
bun add /absolute/output/workspace-api-0.1.0.tgz react@19.1.1 react-dom@19.1.1
bun add -d typescript @types/react @types/react-dom @types/bun
```

Alternatively set `"@vivari/workspace-api": "file:/absolute/path/to/workspace-api"`
in dependencies **after building**, then `bun install --ignore-scripts`. That
development dependency may be symlinked; a tarball is the independent delivery.
Use public imports only:

```tsx
import { WorkspaceProvider, useWorkspace } from "@vivari/workspace-api/react";
function Status() {
  const { state } = useWorkspace();
  return <p>{state.status}</p>;
}
export function App() {
  return <WorkspaceProvider><Status /></WorkspaceProvider>;
}
```

## Explicit runtime delivery

Runtime version is the durable patch SHA, separate from package semver. Current
verified version is `5b9e2d83dddb85eb5e09c482418a19779c7235ce5b42ff0376e52872f9d4ba50`.
Workers, WASM and SW must travel together as a separate versioned directory/archive.
The npm package does not find a sibling `.runtime` directory or build your runtime.

Developer preparation only, from `browser-container-poc/`, with the established
pinned checkout/toolchain prerequisites in `V0-HANDOFF.md` and `vivari/README.md`:

```sh
bun vivari/scripts/build-runtime.ts patched
bun workspace-api/scripts/distribution.ts /absolute/delivery/runtime-VERSION
tar -czf /absolute/delivery/runtime-VERSION.tgz -C /absolute/delivery/runtime-VERSION .
```

Skip the runtime rebuild when its reviewed compiled output already exists. Send
the resulting archive to the consumer. In the consumer, unpack it into a delivery
directory, then use **the installed package** in a Bun build-time script:

```ts
import { mkdir } from "node:fs/promises";
import { copyRuntimeAssets } from "@vivari/workspace-api/assets";
await mkdir("public/editor", { recursive: true });
const manifest = await copyRuntimeAssets({
  source: "/absolute/unpacked-runtime-VERSION",
  destination: "public/editor/runtime-VERSION", // must not exist
  expectedVersion: "5b9e2d83dddb85eb5e09c482418a19779c7235ce5b42ff0376e52872f9d4ba50",
});
console.log(manifest.version);
```

The API checks ABI, version, safe manifest paths, kernel hash and SW presence;
it copies the entire asset tree. It is not a signature verifier or a complete
asset hash manifest. A copy I/O failure can leave a partial destination; remove
only that build-owned directory before retrying. Existing destinations reject.

Serve that directory at `/editor/runtime-VERSION/`, preserving file names and
correct JS/WASM MIME types. Supply `Distribution` with that `assetBaseUrl` and
the manifest's exact version. Serve the application with
`Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp`; the SW script response also requires
`Service-Worker-Allowed: /` because preview registration currently has root scope.
Use localhost or HTTPS. No root-absolute nested worker paths are needed.

Prepared Vite/OpenCode source/dependencies are separate application artifacts,
not part of this runtime or library tarball. The repo demo still uses its existing
`prepare.ts`, manifests and recipe. No standalone turnkey OpenCode recipe package
is claimed by this checkpoint.

## Reproducible independent smoke

With `dist/runtime` already prepared:

```sh
bun run test:consumer
# Optional: WORKSPACE_SMOKE_TMP=/your/temp/root bun run test:consumer
```

This packs and installs into a fresh directory outside the checkout, installs its
own React/TypeScript dependencies, checks declarations under strict NodeNext
without skipLibCheck, builds a browser React app, verifies SSR/import laziness
with throwing Worker/fetch stubs, tests redaction, and uses only the installed
public asset API to relocate a separately delivered runtime archive. Every
relocated file is SHA256-compared. It prints the retained directory and writes
`receipt.json`. This proves package contents/type/build/relocation, **not** browser
runtime boot, DOM StrictMode lifecycle, service-worker routing or product UX.

## Product-mode boundary

The requested optional production editing wrapper is not implemented in this
checkpoint. The demo still presents its existing editor host and Start workspace
flow. Controlled admin enable/exit, original-app retention, floating chat shell,
known-good source-only reset, server authorization integration and same-origin
backend passthrough need the next increment. Existing preview SW can route iframe
requests to guest Vite; do not assume `/api` reaches your backend yet. Root scope,
iframe URLs/query identity, router/OAuth/navigation and guest React remount state
still require explicit policy and browser evidence. Hidden buttons are not server
authorization. Use this checkpoint for local integration development, not as
acceptance of those deployment requirements.
