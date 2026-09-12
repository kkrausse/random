# TODO editor dependency delivery: contract escalation

September 11, 2026. **BLOCKED at preparation design; combined acceptance was not
run.** This is a read-only implementation audit plus an ordinary host build, not
a new browser qualification or a newly reproduced runtime failure.

The authorized continuation required sustainable library delivery, retained project
semantics, the immutable beta-19425 application, and the complete editor flow.
It also required stopping before workarounds or significant architecture expansion.
The audit found that making delivery faithful requires changing the public
preparation representation and graph handling, rather than just updating the
three backend substitutions. That design is escalated below. No preparer, recipe,
runtime, application, dependency, or lockfile change was made in this increment.

## Exact observed preparation impact

Inputs inspected: `opencode-chat/src/{prepare,prepared,recipe}.ts`, the actual TODO
`package.json`, `bun.lock`, installed `node_modules`, and existing ignored
`.editor/prepared/manifest.json`. The previous integration, upstream Tailwind,
root-cause/release-check, and three beta-19425 receipts were read first.

| Observation | Source / evidence |
| --- | --- |
| Project scripts are removed | `prepare.ts:72` sets `scripts: undefined`; the prepared project has no scripts. The host has seven scripts: prepare:editor, dev, build, start, preview, typecheck, test. |
| Six declared dependencies are omitted from the generated project dependencies | `@kev-browser-agent-kit/opencode-chat`, `@kev-browser-agent-kit/workspace`, `@types/bun`, `@types/react`, `@types/react-dom`, `concurrently`. `prepare.ts:24` filters these before generating the new installation manifest. |
| Application lockfile is not the install input | `prepare.ts:29–32` writes a new dependency manifest and runs `bun install` in the output directory. The source allowlist does not include `bun.lock`; the prepared project has no lockfile. |
| Executable links are omitted | `prepare.ts:43` skips `.bin`. Host `node_modules/.bin` has 24 entries; the prepared asset list has zero paths containing `/.bin/`. |
| Tree metadata is not represented | `PreparedManifest.assets` carries file/destination/hash/length only. The walker follows `realpath`, then copies bytes. It does not encode symlinks or file modes. |
| Toolkit guest package is reduced | `prepare.ts:54–57` supplies only the build-time vite/config exports under a generated package manifest. This is an existing explicit editor-boundary packaging decision, not a complete copy of the toolkit package. |
| esbuild payload is incompatible with the normally installed version | Installed host esbuild is 0.28.2; prepared esbuild-wasm is 0.25.12. Rollup is 4.63.1 on both sides. Host Lightning CSS is 1.32.0 and Oxide is 4.3.3; matching version strings alone do not prove WASM backend delivery. |
| Current prepared runtime identity is already coherent | The inspected manifest names `098e0b60…`, matching the existing distribution. The handoff's stale-version concern does not apply to these inspected bytes. Regenerating it just to change the version is unnecessary. |

Host bin names: `jsesc`, `browserslist`, `jiti`, `tsserver`, `concurrently`, `nanoid`,
`prettier`, `marked`, `baseline-browser-mapping`, `tsc`, `parser`, `conc`, `semver`,
`vite`, `intent`, `rollup`, `json5`, `update-browserslist-db`, `vite-node`, `esbuild`,
`tsconfck`, `tailwindcss`, `react-router`, `tree-kill`.

These omissions predate this task and were already described in earlier reports.
They are not newly introduced regressions. The previous successful Tailwind
diagnostic retained the reduced prepared graph and replaced selected package trees;
its startup result does not establish faithful project/dependency delivery.

Preserving the original manifest alone would expose commands/dependencies which
the delivered graph does not contain. Copying bin symlink targets as ordinary
files can also change their relative module resolution. Neither is an adequate
faithful-delivery implementation.

## Missing library contract and proposed bounded design

The missing capability is **a reproducible, metadata-preserving prepared package
tree with explicit platform backend provenance**. This is a consumer/library
delivery gap; it is not evidence of a missing Vivari filesystem syscall.

The runtime already owns the lockstep policy in
`packages/runtime/toolchain-shims.js`: esbuild → esbuild-wasm, rollup →
@rollup/wasm-node, lightningcss → lightningcss-wasm. The runtime Fetcher Worker
consumes it. The previous host diagnostic imports it using `runtime-source.mjs`.
The distributed manifest records that source file as a build input, but the public
`readRuntimeAssets` interface does not expose a backend-selection policy.
The host preparer currently consumes neither the fetcher nor that table.

Proposed changes, **not implemented**:

1. Define a versioned package-tree preparation format with regular-file bytes,
   executable modes and symbolic-link targets. Validate root confinement and
   dangling/escaping links. Preserve package-relative resolution and bin links.
   The current public `ToolContext` offers `installFile`, `readFile`, and `node`;
   a normal guest installer using supported Node filesystem operations is a
   possible consumer of this format. This does not itself justify a new kernel API.
2. Define lock-aware graph provenance: deliver the normally resolved installation
   graph (including nested versions and local packages), retain original project
   manifest/lock bytes, and account explicitly for platform backend selection.
   Backend replacement must use the runtime-owned lockstep policy at the selected
   version and deliver the replacement's actual dependencies plus applicable
   published WASM optional dependencies. Do not manufacture a new project override
   block or re-resolve unrelated transitive dependencies without reporting it.
3. Provide a reusable build-time backend-policy artifact/interface tied to the
   consumed runtime revision. Importing an arbitrary editable checkout from every
   application would not provide that provenance contract. This can be separate
   from immutable worker bundles; a runtime distribution rebuild has not been
   demonstrated necessary.
4. Version the OpenCode launch/delivery descriptor alongside that format. Accept
   and verify the qualified root `build-receipt.json` and its five output hashes,
   deliberately replacing the old `receipt.json`/d7a7256 CLI package contract.
   Preserve the unchanged server entrypoint and ordinary global configuration.

This expands the public prepared-asset and dependency graph contract. Under the
stop/escalate constraint, the audit stops before choosing and implementing that
architecture. It does **not** assert that the existing supported runtime cannot
implement it, or that every preserved project script must execute the host-owned
backend inside the browser. Host-owned API routing remains an explicit boundary.

## Qualified candidate contract checked

V2 config/API documentation was fetched from `https://opencode.ai/v2/docs/config`
and `https://opencode.ai/v2/docs/api`. The exact retained beta-19425 source was
also inspected, including `shell.ts`, `shell/select.ts`, `shell/parse.ts`,
`tool/plugin/shell.ts`, and the session protocol.

The retained receipts establish ordinary `/bin/bun.js /app/server.js` launch,
`OPENCODE_PASSWORD`, global configuration under XDG_CONFIG_HOME, explicit supported
Muse Spark model configuration, and plugin activation await. The current consumer
still requires `d7a7256` and launches `/opencode-v2/run.cjs` with the older CLI/env
contract. It has not been adapted or qualified against the retained candidate.

The actual built-in shell tool uses the non-interactive upstream Shell service,
shell parsing/permissions and the Environment process spawner. This audit provides
no evidence that it needs native PTY support, and does not classify PTY as a blocker.
No shell/model invocation was made, so no shell execution success or failure is
claimed. Earlier read/edit/grep/glob PASS receipts do not cover this tool.

## Per-check results for this increment

| Requested check | Result |
| --- | --- |
| Ordinary host production build | **PASS**: `bun run build` in `todo-app-demo`; client build and React Router prerender completed, exit 0. |
| Default-closed/lazy source invariant | **PASS (static)**: `src/editing.tsx` retains lazy import, `useState(false)` and Open editor button. No user click was tested. |
| Business frontend/backend preservation | **PASS (static)**: empty diff from aa7a4a6 for home.tsx, server/trpcRouter.ts and schema/todo.ts. |
| Immutable candidate/runtime provenance | **PASS (file hashes)**: exact values below. No asset rebuild. |
| Clean dependency preparation | **BLOCKED**: missing faithful package-tree/graph contract; proposed above. No regeneration. |
| Qualified OpenCode2 consumer wiring | **BLOCKED / not implemented** after the preparation design stop. |
| Open button → real preview/chat startup | **BLOCKED / not attempted** in the combined consumer. |
| Genuine model edit + completed correlated tool + independent bytes + visible HMR | **BLOCKED / not attempted**. |
| Candidate built-in shell → Node source check, unique stdout, exit 0 | **BLOCKED / not attempted**; no host-runtime substitute. |
| Host TODO add/complete/delete through preview | **BLOCKED / not attempted**. |
| Close/reopen retained source and conversation | **BLOCKED / not attempted** in this consumer. |
| Combined process/endpoint/output/workspace lifecycle | **BLOCKED / not attempted**. |
| New Tailwind utility CSS HMR | **Known upstream FAIL remains open**: published Oxide WASM 4.3.3/current insiders incremental scanning defect from the prior independent reproduction. No downgrade or workaround. |

There is no verified full-editor startup command for the new candidate yet.
The only command newly verified here is:

```sh
cd browser-container-poc/todo-app-demo
bun run build
```

Running `OPENCODE_PACKAGE_DIR=<candidate artifact directory> bun run prepare:editor`
is not a verified migration command: the preparer still expects a different receipt
location/schema and revision. The candidate's standalone harness command in its
earlier receipts is not a command for the complete TODO editor.

## Durable evidence identities and cleanup

SHA-256 values read directly during this audit:

| Input | SHA-256 |
| --- | --- |
| Retained candidate build-receipt.json | `d6dcd8f0458d7bb3238229eebb0d01766eb4bd8861abc8e74646fe65fe8d7949` |
| Retained candidate server.js | `55be88221d3d21dc373fb7ad7f80fdda3974a4a0be6453001e8e3df0957fc4fb` |
| Existing runtime distribution.json | `bb4ea1f22640c31ab9dc25c0790dda74e3c096061f4b9612f74bc9f09be37816` |
| Audited prepare.ts | `16b2b195f7f8c787b0a51f18d1ca4cef5b8330f0e04edaf3c06d33c28676e6e4` |
| Existing TODO prepared manifest | `6e999cb9ac8067756026b8c1e6cd30dea918b3d8d57f951f4cdc2bb48f00b578` |
| TODO bun.lock | `3ccd16d5559b7eeeb603640d6ad6cd881bd345d06cd77c259b31051ac9987bba` |

Candidate retained root:
`/private/var/folders/t_/x48jtnps7n5_0g_pt9xpvbg00000gn/T/opencode/server-process-candidate.0co24kti`.
Runtime version remains
`098e0b60a0ff8703994ea681d9c974ae9267bfe5dbdd799e87ff00982ff938a3`.

No browser session, host server, guest process, model request, endpoint, or workspace
was opened. Existing user OPFS was not accessed. The foreground build completed;
only ignored normal host build outputs were regenerated. The pre-existing untracked
`vivari/scripts/probe-tailwind-direct.mjs` is preserved. This report is the only
tracked change. No new public API or application diff is delivered by this audit.
