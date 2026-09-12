# Qualified OpenCode candidate: reusable verification and launch contract

September 11, 2026. **Host verification and focused checks PASS.** This increment
adds supporting modules for the next TODO editor integration. The combined editor,
built-in shell, and browser lifecycle have not been qualified by this change.

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
Once those parents import these modules, no new public package export is needed.
Neither helper is currently a package subpath export. Host imports must stay
out of browser code; the launch module has only a workspace type import.

## Checks

From `opencode-chat`:

```sh
bun test test/opencode-application.test.ts test/opencode-launch.test.ts
bun run typecheck
```

Result: **10 tests, 32 assertions PASS**, package typecheck PASS. Tests cover
same-size output tampering, receipt-byte tampering, wrong source/dirty build,
wrong output records, generic receipt rejection by the exact wrapper, escaping
paths, and actual launch/model/config/activation requirements. The real retained
root passed all six integrity checks (receipt plus five outputs). Full editor
acceptance, shell execution, and combined retention remain parent integration gates.
