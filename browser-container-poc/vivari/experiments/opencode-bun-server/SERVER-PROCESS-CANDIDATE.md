# September 11 beta-19425 exported server/process probe

**BUILD_PASS; headless startup acceptance FAIL (180-second timeout).** One frozen
installation, one build, one headless execution. No browser execution. Stopped
after the first execution blocker; no fixes or retries. Investigation began at
22:21:57 UTC and evidence collection completed at 22:28:45 UTC.

## Retained inputs

Isolated root (retain for the next diagnostic):

```text
/private/var/folders/t_/x48jtnps7n5_0g_pt9xpvbg00000gn/T/opencode/server-process-candidate.0co24kti
```

- `.runtime/opencode-v2-source`: detached clean upstream worktree at
  `20aff6d9f643afe9abf8a048e68f019d049f5329`, tree
  `e4148bd22397254c48e64e11d60a158d7be9586f`.
- `bun.lock` SHA-256 before/after installation and build:
  `07711d25b2378d9a3491f6eb960b8386c7bd1831a15d401c04a3c77070cd2e75`.
- `experiments/opencode-bun-server/server.ts`: isolated invocation-only launcher,
  SHA-256 `503df8f0bf75521f9c494c203452bfc6d5a5129778ef44cb0b9944f1b1055646`.
- `experiments/opencode-bun-server/build.ts`: unchanged copy of the integration
  recipe, SHA-256 `431c02871642566da0209fddd67aadb42f516b599cff3d98a620c4927157f0fa`.
- `probe.mjs`: isolated adaptation of `scripts/opencode-bun-headless.mjs`, SHA-256
  `c7f66f5a7881fa76c4e3db13c4267e3b0cac89be73994a6a04f8b0dd704b2977`.
- `build-receipt.json`: output/recipe hashes, install and build facts, original
  WASM comparisons; SHA-256
  `d6dcd8f0458d7bb3238229eebb0d01766eb4bd8861abc8e74646fe65fe8d7949`.
- Logs: `install.log`, `build.log`, `probe.log`. Probe log SHA-256:
  `23087edb9a7ae835db8cc987c1f3a7db3e01e24c2efd7c8f87aac0d7d9fe7b8b`.
- Fresh disk-snapshot adapter directory: `storage-UV2GZR`.

Integration source was clean `f9f2e081be69696b20124bf7106e4eb007a057bc` before
adding this report. `scripts/runtime-source.mjs` resolved the clean sibling fork
`/Users/kkrausse/Documents/repos/kkrausse/vivari` at
`80d5cdd599fce4fa4817128461c865e009109d34`. No runtime rebuild occurred.

## Preparation and entry selection

The user authorized selecting exported `@opencode/server/process` instead of the
CLI web-UI wrapper. The isolated launcher imports `ServerProcess` from that export
and `NodeServices` from `@effect/platform-node`; it runs `ServerProcess.start`
inside `Effect.scoped`, providing `NodeServices.layer`.

Source assessment: `packages/server/src/process.ts:51-145` owns the real HTTP
listener, application boot and shutdown latch; `routes.ts:111-145` configures
application services through ordinary `ServerOptions`. The launcher supplies:

- app version `0.0.0-beta-19425`, host `127.0.0.1`, port 4096;
- probe-only password from guest environment;
- durable database `/runtime-probe/opencode.sqlite` using the existing disk adapter;
- `models.fetch: false`, `config.project: false`, snapshot disabled through config;
- `fs.filewatcher: false`, `fs.fff: false`.

The supported lifecycle callback attaches stdin EOF to the upstream shutdown
effect and removes its listener on cleanup. The launcher awaits `server.shutdown`
and prints a completion marker only after its Effect scope closes. This does not
implement CLI registration or a replacement HTTP stop route. Its shutdown path
was not reached in this attempt.

The recipe retains Node-target bundling, published jsonc-parser ESM resolution
and three original tree-sitter WASM copies. Dependency links point exclusively
into the isolated installed candidate. No application/dependency/runtime source
edits, externalization, stubs, web-asset plugin or old packager were used.

Commands, each run once:

```sh
# Isolated source:
/opt/homebrew/bin/bun install --frozen-lockfile
# Isolated experiment:
/opt/homebrew/bin/bun ./build.ts
# From the integration directory, using the absolute retained script:
/Users/kkrausse/.nvm/versions/node/v24.7.0/bin/node <isolated-root>/probe.mjs
```

Installation exited 0: 2,466 packages, 6.14 seconds; ordinary upstream
`fix-node-pty` postinstall and Husky prepare ran. Source status remained clean.
Bun was **1.4.0+34cbb9a40**, while the candidate declares **1.4.2**. Frozen install
and this build passed under the observed version; declared-toolchain qualification
is not established. Native Node host was **24.7.0**.

## Artifact identity

Output directory: `<isolated-root>/.runtime/opencode-bun-server`.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `server.js` | 28,419,496 | `55be88221d3d21dc373fb7ad7f80fdda3974a4a0be6453001e8e3df0957fc4fb` |
| `ffi-rs.darwin-arm64-xwnmxr1d.node` | 721,896 | `50158069dfc4fcef50af699b84f41b746eeeda076b43950c51828e1eb62f9bc7` |
| `tree-sitter.wasm` | 205,488 | `f38dcc4b43b818f9a0785bc1c6d5611a75ac4cdd428ff3f02757c34ca4e46d7f` |
| `tree-sitter-bash.wasm` | 1,380,769 | `364f0a2cd385c792239423026ef442dbd073d34c396b7bc9e5932426b8e4aa5d` |
| `tree-sitter-powershell.wasm` | 983,236 | `1d30b5a21866354aa2eb94845556f1e19126ff00e3335048719a0e6435b1c154` |

All three WASM hashes match their installed originals. Emission/mounting of the
native file is not evidence that native execution works.

## Actual execution and first failure

The candidate probe checks exact source revision/tree/clean status/lock, exact
runtime revision/clean status, and the full emitted file set, sizes and hashes.
It uses the unchanged integration SQLite FS worker and runtime workers. It waits
for the launcher's post-`start()` marker, then would issue one unauthenticated
health request (401 required), one authenticated health request (200, healthy,
matching version/PID required), send stdin EOF, and require scoped completion,
natural exit 0/null signal, empty worker errors and empty guest stderr.

Observed checkpoints:

```text
OPENCODE_CANDIDATE_INPUT_PASS
OPENCODE_CANDIDATE_STORAGE .../storage-UV2GZR
OPENCODE_CANDIDATE_MOUNT ... (all five outputs)
OPENCODE_CANDIDATE_COMMAND bun /app/server.js
OPENCODE_CANDIDATE_LISTEN 4096
OPENCODE_CANDIDATE_TIMEOUT
```

Host exit **124** at the 180-second deadline. No ready marker, health request,
shutdown request, natural guest exit or explicit worker-cleanup checkpoint was
observed. Deadline termination ended the host process and its workers. The usual
headless OPFS warning appeared; this setup uses the existing disk adapter, so
that warning alone does not diagnose the timeout.

**Classification: uncertain startup/lifecycle boundary**, not yet an established
Vivari compatibility defect. Upstream `process.ts:62-79` binds/serves and invokes
the lifecycle before application boot at lines 90-145; the listener checkpoint
does not establish which later stage completed. No native application comparison
or browser acceptance was performed. The old browser receipt validator and old
headless script were not invoked or weakened.

**Smallest next task:** one separately authorized diagnostic of the retained
artifact's post-listen/pre-ready stall, distinguishing lifecycle/stdin behavior
from application-service boot, with a native comparison under isolated homes and
storage. Keep the artifact fixed and add only boundary observations before
considering runtime changes.

Qualified outputs remain preserved: old local JS hashes to `765dd1b6…`, and the
clean `clean-build.x7j1u24y` JS still hashes to
`1281158d5c583e49b5e20eab2705b35fb902fb729dd2635cf0d29f8c6a0eb115`.
Only this new report is tracked; launcher, harness and build inputs remain in the
retained isolated root.
