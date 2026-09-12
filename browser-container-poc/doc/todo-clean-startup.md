# TODO clean startup: native realpath root cause and bounded runtime fix

September 12, 2026. **Original clean-start FAIL; corrected-runtime startup and
same-document source HMR PASS.** This is not full editor/model/shell/retention
acceptance. Published Tailwind/Oxide 4.3.3 remains the backend throughout this
diagnosis; the separate source-PR archive was not selected.

## Exact original failure

The parent's first clean origin was `http://127.0.0.1:54390/`, Browser Control
session `lucky-tiger-637`. Preparation delivered and installed the full verified
tree. The Vite listener served the server-rendered Todos page, but the preview
input remained disabled, client readiness timed out, and chat was never launched.
The original failed receipt was preserved before any diagnostic restart.

Direct requests through the existing **public Vite Endpoint**, bypassing the
preview service worker, established:

| Request | Actual upstream response |
| --- | --- |
| `/node_modules/.vite/deps/@tanstack_react-query.js?v=73e77d04` | 504, status text **Outdated Optimize Dep**, content-length 0, empty body |
| `/node_modules/.vite/deps/@trpc_client.js?v=dbeac05a` | 504, same status text, empty body |
| `/src/lib/trpc.ts` | 200; imports retained the failed tRPC version hashes |
| `/src/home.tsx` | 200; imports retained React Query hash `73e77d04` |

The preview service worker had injected its bridge scripts into the otherwise
empty error response. Those scripts were not the Vite error text. `_metadata.json`
had browser hash `5ff434f0` and only seven initial React/Router optimized entries;
it did not contain the four newly discovered React Query/tRPC entries.

The normal controller drains/discards raw process output; its Activity log was
not presented as an optimizer log. After preserving the failure, diagnosis used
`controller.stopService('vite')` and an ordinary `runtime.node` launch with the
same manifest preview options plus supported `DEBUG=vite:deps*` logging. The new process's two
output channels were captured from launch. This restart explicitly invalidated
the original clean-start attempt. The parent-owned host stayed running.

The unchanged Vite optimizer reported:

```text
new dependencies found: @tanstack/react-query, @trpc/react-query,
  @trpc/tanstack-react-query, @trpc/client
Could not resolve "@tanstack/query-core"
node_modules/@tanstack/react-query/build/modern/index.js:19:14
error while updating dependencies: Error during dependency optimization
```

This is failed dependency optimization, not a successful optimizer update awaiting
a browser reload. The original diagnostic iframe loaded once; no incoming reload
message was recorded during that failure. That limited observation is not a claim
that every original WebSocket frame was captured: the listener was attached after
iframe load. The later successful HMR capture below records actual incoming frames.

## Root cause: native realpath returned the symlink spelling

An ordinary read-only guest Node probe inspected links and package metadata.
The installed graph is valid:

```text
/workspace/node_modules/@tanstack/react-query
  -> ../.bun/@tanstack+react-query@5.102.8+62547eec5a2188e3/node_modules/@tanstack/react-query

/workspace/node_modules/.bun/@tanstack+react-query@5.102.8+62547eec5a2188e3/node_modules/@tanstack/query-core
  -> the installed query-core 5.102.8 package
```

The transitive package intentionally has no top-level
`/workspace/node_modules/@tanstack/query-core` entry under the isolated linker.
That is ordinary package-manager semantics, not missing delivery.

For `@tanstack/react-query` and each tested tRPC package:

- `fs.realpathSync(path)` returned the correct `.bun/...` canonical path.
- **`fs.realpathSync.native(path)` returned the original top-level symlink path.**
- The native variant also failed to canonicalize `path + '/package.json'`.

Vite 7.3.6 selects `fs.realpathSync.native` as `safeRealpathSync` on this platform.
Its package resolution therefore retained the lexical top-level package directory
instead of the isolated store scope containing transitive dependencies. Inspection
of the runtime confirmed `packages/runtime/node/bindings/fs.js` implemented native
`realpath` as `return path`, assuming the vendored JS traversal handled it. The
native public API bypasses that JS traversal.

## Sustainable runtime fix

Runtime fork commit **`0ae4c2f6fb879236f5c10f2273bc7ed973e9fde8`** implements native
canonical traversal through existing `lstat` and `readlink` syscalls, including
relative/absolute links, links in ancestor directories, `..`, encoding, callback
delivery, missing/dangling targets, non-directory failures and a 40-link loop bound.
No new syscall, package transform, graph flattening, optimizer override, prebundle
scanner, timeout increase, or application-source workaround was introduced.

The fork-owned `fs-native-realpath` contract uses an independent package-shaped
tree with a private dependency, rather than depending on Vite or the TODO graph.

Checks:

- **Native Node 24.18.0:** `FS_NATIVE_REALPATH_PASS`.
- **Real guest workers under Node 24.18.0:** all **14 runtime contracts PASS**.
- **Real browser guest runtime:** `FS_NATIVE_REALPATH_PASS`, stdout exactly one
  marker line, stderr empty, natural exit 0 / signal null / forced false.

The shell's bare `node` was discovered to be Bun's injected Node alias. Its first
native-comparison attempt disagreed on `link/..`; it was not counted as Node
qualification. Both qualified native/worker checks were rerun using the explicit
cached Node 24.18.0 executable. The runtime behavior matches that Node result.

## Corrected-runtime browser check

The runtime was built from clean committed source with:

```sh
# From vivari integration directory:
bun scripts/build-runtime.ts --release --revision 0ae4c2f
# From browser-container-poc:
bun workspace-api/scripts/distribution.ts <evidence-root>/native-realpath-runtime
```

The corrected distribution is retained separately:

- Runtime version: `0f0f9bc6a72323e00f3cdb7cc61966bee47ff2ddaf7c8478e9826b149cc8d8f1`.
- Runtime build receipt SHA-256:
  `251e7d30741432ba162bcc944e474fef789d19e4403dffbde23ff298fc19c93e`.
- Distribution manifest SHA-256:
  `e7181db260dd9d1e251f92902c7814b1a9f94546fb00945189047bf1523252fe`.
- Process worker: `assets/process-worker-Bup6v9KR.js`.

The installed compiled preparer regenerated a separate staging output against
this distribution. All original source bytes and every original prepared file
hash/mode were identical. Bun's repeated installation additionally emitted one
unused relative bin link:
`/workspace/node_modules/.bun/update-browserslist-db@1.3.2+0d1c381ccee4bebb/node_modules/.bin/browserslist`.
The staged tree therefore has **10,464** entries rather than 10,463; this metadata
difference is explicit, not described as byte-for-byte identical preparation.
Its manifest SHA-256 is
`ba4901a2178a8177f4f36fb457557411a8a71e16c75db48f463562053693bbde`.

The unchanged production `server.ts` and existing `build/client` were served at
`http://127.0.0.1:54391/` from a separate host staging directory linking the build
and staged preparation, with `RUNTIME_DIR` selecting the corrected distribution.
The original parent server, live `.editor`, compiled packages and shared runtime
distribution were not rebuilt/replaced. Fresh-origin OPFS was checked empty
before opening the editor on the diagnostic origin.

The existing acceptance harness recorded:

| Gate | Result |
| --- | --- |
| Default-closed host UI / explicit Open editor | PASS |
| Verified tree install and Vite listener | PASS |
| Preview hydration | **PASS**, New todo enabled |
| Four formerly failing optimized dependencies | **200**, no failed preview requests |
| Optimizer metadata | All 11 React/Router/React Query/tRPC entries present |
| Vite client | Connected, controller `clients.vite === 'ready'` |
| OpenCode startup/config/model activation | Connected, controller `clients.chat === 'ready'`; all six stages done |
| Manual source edit via existing editor | PASS, workspace bytes flushed |
| Same-document HMR | **PASS**, heading became `Todos acceptance mty07fa0` |
| Actual HMR frames | `react-router:hmr`, JS update for `/src/home.tsx`, CSS update; no document replacement |

The first diagnostic host was mistakenly launched with a 120-second shell bound.
It expired **after** the saved startup-ready receipt and interrupted the first
subsequent standalone filesystem-fixture attempt (15-second bound, forced 143,
no output). That failure is retained. The host was restarted without a shell
timeout; the same fixture then passed, and the source/HMR checks passed. This
interruption invalidates full combined lifecycle acceptance for that run; it does
not turn the earlier startup or later individual checks into a full-editor PASS.

Cleanup used public controller ownership: Vite stopped with its existing forced
SIGTERM/143 policy; **chat closed by stdin EOF with natural exit 0**, both output
drains completed, runtime stopped, workspace flushed/closed. The diagnostic host
was then stopped. No genuine model prompt, built-in shell call, TODO CRUD,
conversation retention, or new-utility CSS acceptance was attempted here.

## Evidence and parent handoff

Evidence root:

```text
/private/var/folders/t_/x48jtnps7n5_0g_pt9xpvbg00000gn/T/opencode/todo-editor-clean-acceptance.d1vGpL
```

| Evidence | SHA-256 |
| --- | --- |
| `diagnosis-001-original-failure.json` | `907608aaf8d9983e35f84ebdd7cc2179ab03d390de181e90ffbbe46267cd6cd0` |
| `diagnosis-002-endpoint-and-metadata.json` | `e37626ab9467b36bd147a07a8a07d234d3b8197285336efa0a1a321c4cd7f176` |
| `diagnosis-003-optimizer-output.json` | `abe8b7f20b1c9f9457e82375e84dc2bf9f0922c301fbd054d33b519379257497` |
| `native-realpath-browser/mty07fa0-003-ready.json` | `bd5ccafbb2394a5a603afd75dcdf0bb14d4c39c4f09ee7c8ccd9a4902bac45e0` |
| `native-realpath-browser/native-realpath-browser-contract.json` | `16ef793f8d0281746696703773f6ebbab66d6940f562dd6a5c9b1a9d6f360370` |
| `native-realpath-browser/mty07fa0-006-hmr-verify.json` | `f88a4d9f1cd1c01baad251faa1dca4f808d99d8f6a54d688f7de2c85f1defdfb` |
| `native-realpath-browser/native-realpath-hmr-events.json` | `e48fee5a87ff9940c6b1fafcb4811ff241d9a5403250565e0d1e8d1c77c0bd14` |
| `native-realpath-browser/native-realpath-cleanup.json` | `111a3f50a1a54163e867a84ee7a474ebf9bafa976071cbe264e46c2c2e620f7a` |

Timestamped `*-graph.json`, restart/stop receipts, the interrupted-fixture receipt,
fresh-origin assertion and inspected `native-realpath-ready-hmr.png` are retained
beside these. `todo-app-demo/tests/diagnose-clean-start.js` contains the reproducible
public-API graph/output diagnostic phases; it requires the already inspected
controller handle and evidence configuration in the exclusively owned Browser
Control session. It never edits package sources.

Original live identities remain:

- `.editor/prepared/manifest.json`:
  `f88f82bee65e30dd2fb9be7d204b3f54e3c9d2c88b03f0fad6f9b491323f9a9b`.
- Shared `workspace-api/dist/runtime/distribution.json`:
  `bb4ea1f22640c31ab9dc25c0790dda74e3c096061f4b9612f74bc9f09be37816`.
- Unchanged beta-19425 receipt/application qualification remains intact.

**Parent next step:** select the corrected runtime directory for both preparation
and production hosting (`RUNTIME_DIR=<evidence-root>/native-realpath-runtime`),
then generate the parent's chosen published/source-archive backend manifest and
run a new fresh-origin combined acceptance. No prep/recipe workaround is needed
for this failure, and no runtime source pin was silently promoted. The shared
runtime build cache now describes clean commit `0ae4c2f`; the old distributed
runtime remains separately retained. Do not use old `.editor` with the new runtime
without regeneration: their provenance check deliberately rejects that mismatch.

Browser Control session `lucky-tiger-637` is returned on diagnostic origin 54391
with its workspace closed. Both task-owned diagnostic hosts are stopped; the
parent's original host on 54390 remains running. Original failed harness state is
saved as `state.failedEditorAcceptance` / `state.failedEditorAcceptanceConfig`;
the diagnostic run occupies `state.editorAcceptance`. Use a new run/origin for
final acceptance rather than promoting these partial, interrupted receipts.
