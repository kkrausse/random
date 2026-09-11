# Direct unbundled OpenCode startup — first executed milestone

September 11, 2026. **Startup remains blocked; no server acceptance.**

Latest: runtime `80d5cdd` supplies bounded worker uncloneable-mark semantics.
The direct launcher now passes Undici initialization and reaches `Unexpected string`
compiling `packages/client/src/effect/service.ts`. Earlier failures below record
progress. Still no listener or server acceptance.

## Reproduce

From `browser-container-poc/vivari`, with the existing frozen upstream install at
`.runtime/opencode-v2-source` (`d7a7256bb6b0952f486c95718cfbf460b1570a56`):

```sh
/Users/kkrausse/.nvm/versions/node/v24.7.0/bin/node scripts/opencode-direct-headless.mjs
/Users/kkrausse/.nvm/versions/node/v24.7.0/bin/node scripts/opencode-direct-headless.mjs --cli
```

`OPENCODE_SOURCE` overrides the upstream directory; `VIVARI_SOURCE` uses the
standard runtime source resolver. Requires already-built runtime WASM. The probe
prints source revision/status and lock hash. It mounts 165,463 JS/TS/JSON/JSONC
files and 12,833 symlinks from the ordinary installed tree into `/upstream`, using
bounded batch delivery. File bodies are copied unchanged. It does not bundle,
rewrite package code, scan an import graph, resolve optional imports in advance,
or invoke either existing application packager. Symlinks retain relative layout;
absolute links inside the source root relocate with the mount.

This is a **diagnostic code image**, not yet a complete distributable install:
other extensions (WASM, SQL, text, native binaries, etc.) are omitted generically.
No missing asset is hidden by a replacement; extend generic asset delivery when
execution reaches it. The host dependency tree is a prerequisite; guest install
and dependency restoration are not qualified. Mounting optional package files
does not execute their imports.

The existing checkout reports a preexisting modification to
`packages/tui/src/component/devtools-bar.tsx`; it was preserved. This is therefore
not a clean-upstream reproduction receipt. Lock SHA-256:
`b6ebc10fd743b192bf81437c0e95a89b850daffa6cfe9de0ba6491c13f1c3764`.

The default invocation-only guest launcher is:

```js
import { Effect } from 'effect';
import { ServerProcess } from '@opencode-ai/cli/server-process';
await Effect.runPromise(ServerProcess.run({
  mode: 'default', hostname: '127.0.0.1', port: 4096,
}));
```

The alternative executes the original CLI source directly:

```sh
bun /upstream/packages/cli/src/index.ts serve --hostname 127.0.0.1 --port 4096
```

Both use fresh in-memory VFS state and `/home/direct`, explicit probe-only auth,
and upstream flags disabling FFF, filewatching and model fetching. No host service
or host credentials are used. A 180-second bound terminates hangs; workers are
terminated after each completed attempt. Exit zero alone fails the probe: eventual
server qualification must add authenticated health and lifecycle checkpoints.

## Executed results and fix

1. **Before fix, exported entry launcher:** Effect's ordinary published
   `dist/Array.js` fails compilation with `Unexpected token 'export'`.
   This happens while loading the real Effect barrel, before server entry loading.
2. **Reduction:** local export lists containing JSDoc braces, e.g.
   `export { /** {@link value} */ value }`, were stripped only to the first `}`.
   The loader left malformed source and missed later export declarations.
3. **General runtime fix:** fork commit `b6a5fbe` reuses the existing lexical
   balanced-brace skipper in `packages/runtime/esm.js`. There is no package name
   check or application hook. New `esm-export-comments` fixture exercises block
   and line comments, aliases and subsequent exports with actual dynamic import.
4. **After fix, exported entry launcher:** Effect loads; then
   `Cannot find module '@opencode-ai/cli/server-process' from '/upstream/packages/cli'`.
   The package declares that exact name/export, but the runtime did not resolve
   package self-references. No import substitution was added. Worker compilation errors are reported separately;
   kernel cleanup gives exit 143, not a successful application shutdown.
5. **Ordinary CLI attempt after fix:** exits 1 with
   `TypeError: webidl.util.markAsUncloneable is not a function`, at Undici's
   `CacheStorage` construction. This is the next independently observed CLI-path
   compatibility blocker; it was not fixed in this milestone.
6. **Continuation, `c2b10ac`:** implement general package self-reference lookup
   through the nearest package name/exports, respecting nested scopes and
   node_modules boundaries. The launcher next actually loads
   `packages/cli/src/server-process.ts`, which fails with `Unexpected token 'export'`.
7. **Second reduction/fix in `c2b10ac`:** the TS stripper treated `as` in
   `export * as ServerProcess from ...` as a type assertion and consumed following
   imports. Preserve module binding clauses and erase only their inline type
   specifiers. The independent contract tests namespace export/import, renamed
   bindings, an ordinary binding named `type`, erased types and real assertions.
8. **Launcher retry after `c2b10ac`:** now also reaches
   `webidl.util.markAsUncloneable is not a function`. This is a missing
   `node:worker_threads.markAsUncloneable` API used by installed modern Undici,
   rather than a reason to rewrite or bundle the package. Correct implementation
   needs cloning-boundary semantics, not a silent no-op.
9. **Bounded fix, `80d5cdd`:** process-local WeakSet marks reject at guest
   structuredClone, MessagePort/BroadcastChannel posting and Worker workerData
   boundaries. JS graphs are snapshotted once, preserving getters-once, cycles,
   aliases, Map/Set entries and Error causes. Known native values and transfer
   semantics remain native; ArrayBuffer/SharedArrayBuffer marks are ignored like
   Node. Unknown branded host objects explicitly reject once marks exist, rather
   than bypassing checks; raw cloning functions saved before builtin loading are
   outside this guard. This is bounded compatibility, not every platform brand.
10. **Latest executed launcher retry on committed `80d5cdd`:** Undici initializes;
    then `SyntaxError: Unexpected string (while compiling
    /upstream/packages/client/src/effect/service.ts [esm])`. A diagnostic parse of
    the runtime's transformed output finds a leftover `from "../service.js"`
    after type-export stripping; additional TS declarations also survive later
    in that file. These are next loader defects, not addressed in this slice.
    The compilation failure triggers worker cleanup/exit 143; no listening marker.

Neither attempt emitted a listener checkpoint. No conclusions about later native,
TUI, SQLite, HTTP, model or tool paths follow from these failures.

## Verification and scope

Executed in the standalone runtime fork with native Node 24.7.0:

```sh
node scripts/fixtures/runtime-contracts/esm-export-comments.cjs
node scripts/fixtures/runtime-contracts/package-self.cjs
node scripts/fixtures/runtime-contracts/worker-uncloneable.cjs
bun scripts/fixtures/runtime-contracts/ts-module-alias.cjs
node scripts/spike-bun-offline.mjs
node scripts/verify-runtime-contracts.mjs
```

Native fixtures and the complete offline Bun suite passed; the latest run passed
all thirteen real-worker contracts (including fs-permissions). The new native
Node/guest uncloneable contract covers nested marked values, maps, sets, Error
causes, workerData rejection, accessor values, getters-once, cycles, ordinary
Date/RegExp/typed-array/Error cloning and real ArrayBuffer transfer/detachment.
A direct `bun run build:core` attempt failed
because `wasm-pack` was absent from that shell's PATH, before any build output.
The coordinating session built clean `b6a5fbe` and qualified unchanged ripgrep in
Chromium, distribution `445933bcccfa1a2d306905190ee896d10bfc4453cc1b6ccdb1c2aeba6d5dd2fc`.
That does not qualify OpenCode or the later `c2b10ac` source-loader additions.
The coordinating session owns subsequent integration build/distribution; this
milestone does not advance the qualified runtime pin. No browser test was run
by this investigation.

The upstream CLI AGENTS references `opencode-dev`; skill loading failed and no
such skill was found in this environment. The available pinned `opencode-drive`
instructions were read. This work used the explicitly authorized noninteractive
isolated guest kernel rather than the installed live service.

Keep the existing packaged baseline. Continue with the executed client-service
TypeScript compilation failure, then retry with full generic assets when needed.
The original [case-study acceptance gates](opencode-runtime-case-study.md) remain.
