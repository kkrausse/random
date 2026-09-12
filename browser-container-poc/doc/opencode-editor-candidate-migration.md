# Qualified OpenCode candidate: reusable verification and launch contract

September 11, 2026. **V2 preparation, candidate integration, host checks PASS.**
The reusable modules are now wired through `prepare.ts`, `prepared.ts`, and
`recipe.ts`, following preparation commit `d7ce99a` and client commit `fa4a0ab`.
The combined editor, built-in shell, and browser lifecycle have not been qualified
by this change; browser acceptance belongs to the parent task.

## Completed integration and runnable handoff

- Old `receipt.json`/d7a7256 delivery and generated CLI wrapper are replaced by
  exact retained-root verification. The V2 manifest's `opencode` field retains
  candidate/format/revision/receipt hash and the exact receipt text. An identical
  standalone `opencode-build-receipt.json` accompanies it. Browser loading pins
  the receipt and five declared output identities, and delivery verifies both
  fetched bytes and installed application/support read-back.
- `prepareOpenCodeRipgrep` performs ordinary Bun 1.4 installation with
  `--frozen-lockfile --linker isolated` and an isolated cache, using the archive
  SHA-512 retained by qualification. Generic `captureTree` preserves the nine
  unchanged package files, isolated package links, `.bin/rg` and executable modes.
  The support manifest and lock, including their SHA-256 values, are retained.
  Guest support now lives at `/app/node_modules`; the launch factory receives
  `/app/node_modules/.bin`. All nine files independently match the earlier
  `/direct` qualification. The new layout still needs combined browser acceptance.
- Global config and required `/.server` directories are written via workspace
  filesystem APIs. `.server` is excluded from `sourcePaths`. The config includes
  shell permission for the upcoming built-in shell check; qualification still
  covers only read/edit/grep/glob. Unsupported recipe model options fail before
  workspace startup.
- `verifyOpenCodeReady` awaits authenticated health, plugin activation, the loaded
  global model config, and the enabled tool-capable model catalog. Chat launch
  uses the parent's fifth controller argument
  `{shutdown:'stdin-eof', timeoutMs:10000}`.
- Delivery provisions only `/runtime-probe/.browser-editor`. Tree reset targets
  do not include `/runtime-probe`, so the fixed database is not overwritten or
  removed. Actual retained history/lifecycle remains a browser acceptance gate.

From `todo-app-demo`, with Bun 1.4.0 and the existing runtime distribution:

```sh
bun run --cwd ../workspace-api build
bun --cwd ../opencode-chat install --linker isolated --force --frozen-lockfile
bun run --cwd ../opencode-chat build
bun install --linker isolated --force --frozen-lockfile
export OPENCODE_PACKAGE_DIR=/private/var/folders/t_/x48jtnps7n5_0g_pt9xpvbg00000gn/T/opencode/server-process-candidate.0co24kti
bun run prepare:editor
bun run build
LOCAL_EDITOR_ADMIN=1 PORT=4390 bun start
```

Open `http://127.0.0.1:4390`, then **Open editor**. Preparation and production build
were executed successfully. The production server/browser command is the runnable
acceptance handoff, not a claim of a completed browser run. The existing authorized
loopback admin fixture controls editor/model/asset access.

Full preparation produced **10,463 tree entries**, **8,843 regular files**,
**173,466,519 delivered file bytes**. An independent post-preparation pass validated
every file's bytes/hash, all tree links/modes, all nine ripgrep qualification hashes,
and exact source `package.json`/`bun.lock` preservation.

| Prepared provenance | SHA-256 |
| --- | --- |
| `.editor/prepared/manifest.json` | `f88f82bee65e30dd2fb9be7d204b3f54e3c9d2c88b03f0fad6f9b491323f9a9b` |
| Original project manifest | `b064036c5f1dccd0ffb5e11803e06cc8a2cdc86f33686d8bff450f6f3e1e5173` |
| Original project lock | `3ccd16d5559b7eeeb603640d6ad6cd881bd345d06cd77c259b31051ac9987bba` |
| Derived runtime manifest | `36abc28f8504b85b5acec37dee17d10b505d7f2a51047afa0ec8396d0eded5b1` |
| Derived runtime lock | `051ff8cd9177197bdc2e8046b64caaadbf3338b08b910bc85c0091188b479d32` |
| Ripgrep support lock | `7af069d6ee7a3c194fb875c2f5b7688491e4ea07c714ae062ec4cef3fbd8142b` |
| Runtime backend policy | `a52960f669405f22d165d384408ccff5f3ffe2a7b91fa177c7207d66452d2a0a` |

Runtime version remains
`098e0b60a0ff8703994ea681d9c974ae9267bfe5dbdd799e87ff00982ff938a3`.
Derived backend versions are esbuild-wasm 0.28.2, @rollup/wasm-node 4.63.1,
lightningcss-wasm 1.32.0, and published @tailwindcss/oxide-wasm32-wasi 4.3.3.
The derived lock records four changed backend entries, `lightningcss/napi-wasm`
added, and replaced native backend optional packages removed. No Tailwind PR
backend or production source transform was adopted.

## Identity and evidence

The exact application is `opencode-server-process-beta-19425`, source revision
`20aff6d9f643afe9abf8a048e68f019d049f5329`. Its retained root is:

```text
/private/var/folders/t_/x48jtnps7n5_0g_pt9xpvbg00000gn/T/opencode/server-process-candidate.0co24kti
├── build-receipt.json
└── .runtime/opencode-bun-server/
    ├── ffi-rs.darwin-arm64-xwnmxr1d.node
    ├── server.js
    ├── tree-sitter-bash.wasm
    ├── tree-sitter-powershell.wasm
    └── tree-sitter.wasm
```

The retained receipt's SHA-256 is
`d6dcd8f0458d7bb3238229eebb0d01766eb4bd8861abc8e74646fe65fe8d7949`.
Its exact bytes and all five output lengths/hashes were checked using the new
`readQualifiedOpenCodeApplication` function. `server.js` remains 28,419,496 bytes,
SHA-256 `55be88221d3d21dc373fb7ad7f80fdda3974a4a0be6453001e8e3df0957fc4fb`.
All five independent expected output identities are in
`opencode-chat/src/opencode-application.ts`.

This is verification of retained artifacts against a qualification identity, not
a fresh verification of a source checkout or a claim of reproducible rebuilding.
The exact receipt binds its original source/tree/lock/install/build recipe and
WASM provenance, including original absolute source paths. Relocating the archive
does not authorize rewriting the receipt. No application bytes are transformed.

Sources read:

- [Preparation contract audit](todo-editor-delivery-contract-audit.md).
- [Model/tools qualification](../vivari/experiments/opencode-bun-server/SERVER-PROCESS-MODEL-TOOLS-PASS.md).
- The retained `experiments/opencode-bun-server/server.ts` and current
  `vivari/probes/opencode-direct-{browser,model}.ts` harnesses.
- V2 [config](https://opencode.ai/v2/docs/config),
  [providers](https://opencode.ai/v2/docs/providers), and
  [API](https://opencode.ai/v2/docs/api) docs. Candidate-specific details use the
  actual qualified entrypoint and harness rather than inferring current defaults.

## Preparation integration

Within `prepare.ts`:

```ts
import { readQualifiedOpenCodeApplication } from './opencode-application';

const application = await readQualifiedOpenCodeApplication(options.openCodeDirectory);
for (const asset of application.assets) await add(asset.destination, asset.bytes);
```

`openCodeDirectory` now means the **retained root**, not its output subdirectory.
An archive with different host layout can pass a second argument containing
`receiptPath` and/or `outputDirectory`. Guest targets deliberately remain `/app`.
The returned `bytes` are the exact verified buffers; `length` is the numeric size.
Package those buffers directly. Retain `application.provenance` in the versioned
preparation manifest and the exact `application.receiptBytes` in the prepared
archive for audit. Preserve all five outputs, including the `.node` output.
Browser delivery must validate fetched bytes and installed read-back against the
same hashes before launch, as the qualification harness does.

Replace the old `receipt.json`/`revision:d7a7256` assumption and generated
`/opencode-v2/run.cjs` wrapper with this delivery. Update prepared-asset target
validation to accept these five `/app/` targets and retain application provenance
alongside the selected runtime identity. These modules do not select or promote
a runtime version. The qualification used runtime version
`098e0b60a0ff8703994ea681d9c974ae9267bfe5dbdd799e87ff00982ff938a3`.

`verifyApplicationDelivery` is a generic host helper whose independent caller
contract is the trust root. It checks receipt bytes, clean successful source
identity, exact output set/records, safe output names and each output's bytes.
It is intentionally distinct from `readQualifiedOpenCodeApplication`, which pins
the exact candidate and fixed guest layout. A self-authored generic contract
does not grant this candidate's qualification.

## Recipe integration

Import from `./opencode-launch`:

- `openCodeCandidateLaunch`: versioned descriptor, required directories, fixed
  database path, API barriers, model reference, lifecycle markers.
- `createOpenCodeCandidateConfig(modelBaseURL, additionalToolActions?)`: ordinary
  global configuration with explicit Muse Spark definition and read/edit/grep/glob
  permissions. Pass `['shell']` only when implementing the separate shell gate;
  adding permission does not qualify that tool.
- `createOpenCodeCandidateLaunch({ password, ripgrepBinDirectory? })`:
  `NodeLaunchOptions` for `/bin/bun.js /app/server.js`, cwd `/app`, port 4096.

Integration sequence:

1. Provision the descriptor's `workspaceDirectories` with `workspace.fs.mkdir`.
   Write the config JSON at `workspaceConfigPath`
   (`/.server/config/opencode/opencode.json`) and flush. The process sees it at
   `/workspace/.server/config/opencode/opencode.json` through `XDG_CONFIG_HOME`.
   Project config discovery is disabled by the unchanged entrypoint; writing
   `/opencode.json` does not configure this candidate.
2. Supply the existing transparent host model proxy URL, e.g.
   `http://host.vivari.internal:<port>/editor/model/`, streaming to
   `https://opencode.ai/zen/v1`. The config explicitly supplies
   `@opencode/ai/providers/openai`, tool/media capabilities, context 1,048,576,
   output 131,072, and `websocket:false`. The embedded snapshot lacks this model.
   The upstream provider manages public access; no API-key literal is needed.
3. Deliver verified application bytes and provision guest `/runtime-probe`
   before launch. The unchanged entrypoint fixes the database at
   `/runtime-probe/opencode.sqlite`; XDG_DATA_HOME does not relocate that database.
   The earlier harness provisioned this directory via an ordinary installed
   marker file. Preserve its guest filesystem/database across same-page reopen
   using the existing supported lifecycle, and verify conversation retention.
   Page-reload retention is not established by the earlier qualification.
4. Deliver ordinary `ripgrep@0.3.1` bytes and executable metadata. The evidence
   harness uses the nine files under `vivari/probes/ripgrep/node_modules/ripgrep`,
   guest `/direct/node_modules/ripgrep`, `.bin/rg -> ../ripgrep/lib/rg.mjs`, and
   executable mode on `lib/rg.mjs`. Its installer is
   `vivari/probes/runtime/opencode-ripgrep-install.cjs`. A metadata-preserving
   prepared tree can deliver the same link/mode without that installer. Default
   launch PATH is `/direct/node_modules/.bin:/bin`, with package-supported
   `RIPGREP_NODE_WASI=0`. A different installed bin path is configurable, but
   needs consumer acceptance. These support bytes are separate from the five
   application outputs and need their own preparation provenance.
5. Generate a fresh password in memory; pass it to the launch factory. Construct
   `Basic ` plus `btoa('opencode:' + password)` for authenticated endpoint calls.
   Keep it out of the prepared manifest and logs. Launch and expose descriptor
   port 4096, await health and the ready marker, then POST `activation.path` with
   authentication. Verify `/api/config?directory=/workspace` contains the global
   document (entry array directly), then `/api/model?directory=/workspace`
   contains the enabled tool-capable `{providerID:'opencode',
   id:'muse-spark-1.3-contributor-free'}` in `response.data` before chat readiness.
6. Keep stdout/stderr drained and stdin open for the server lifetime. Closing
   stdin requests scoped shutdown. Await the shutdown marker, natural exit 0,
   output drain, endpoint closure, runtime stop, workspace flush/close. Reuse
   existing controller ownership with these candidate-specific checkpoints.

The factory retains the qualification's supported HOME/XDG, tree-sitter paths,
`OPENCODE_TEST_HOME` isolation and `OPENCODE_PASSWORD`; it does not resurrect the
old CLI disable/model/parser environment contract. Extra tool permissions are
explicit extensions to the qualified config. Model changes require a new
explicit supported model definition and separate qualification.

The existing build bundles local imports into `prepare.js` and `recipe.js`.
These parents now import the modules; no new public package export is needed.
Neither helper is currently a package subpath export. Host imports must stay
out of browser code; the launch module has only a workspace type import.

## Checks

From `opencode-chat`:

```sh
bun test test/opencode-application.test.ts test/opencode-launch.test.ts
bun run typecheck
```

Initial isolated result: **10 tests, 32 assertions PASS**, package typecheck PASS. Tests cover
same-size output tampering, receipt-byte tampering, wrong source/dirty build,
wrong output records, generic receipt rejection by the exact wrapper, escaping
paths, and actual launch/model/config/activation requirements. The real retained
root passed all six integrity checks (receipt plus five outputs). Full editor
acceptance, shell execution, and combined retention remain parent integration gates.

Integration checks: `OPENCODE_PACKAGE_DIR=<retained-root> bun test` in
`opencode-chat`: **63 tests / 263 assertions PASS**, including the actual retained
candidate test (skipped when that external artifact is not supplied), ordinary
ripgrep installation, altered V2 receipt/output/link rejection, activation/config/
model failures, unsupported model rejection and server-state source exclusion.
Workspace package build, toolkit package build/typecheck, TODO production build
and typecheck all passed. TODO HTTP/tRPC tests: **3 tests / 23 assertions PASS**.
