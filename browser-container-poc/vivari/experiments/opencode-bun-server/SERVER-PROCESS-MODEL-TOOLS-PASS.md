# September 11: unchanged beta-19425 model/tools and OPFS conversation retention PASS

**PASS — one real-browser attempt, one genuine model prompt, four completed
upstream local tools, two natural server lifetimes, host-accepted receipt and
host exit 0.** The exact artifact from [browser startup](SERVER-PROCESS-BROWSER-PASS.md)
and [retention](SERVER-PROCESS-RETENTION-PASS.md) now passes model-driven
read/edit/grep/glob and retention of the resulting conversation and edited file.

## Check results

| Check | Result and observed evidence |
| --- | --- |
| Artifact/distribution | **PASS** — all five original application files and the existing runtime distribution verified before delivery; browser hash/read-back checks; post-run hashes unchanged |
| Real browser storage | **PASS** — initially empty origin, durable default OPFS workspace at both opens |
| Supported model setup | **PASS** — global configuration document returned by `/api/config`; selected enabled model with tools returned by `/api/model` after supported plugin activation wait |
| Real model response | **PASS** — provider `opencode`, model `muse-spark-1.3-contributor-free`; five genuine HTTP 200 `/responses` POSTs, one prompt, five completed assistant messages, five text blocks/294 characters, terminal `session.execution.succeeded` |
| Read | **PASS** — exactly one local completed call on `/workspace/combined-probe/baseline.txt`, exact numbered `BASELINE_BEFORE` output |
| Edit | **PASS** — exactly one local completed `edit`, exact old/new strings, public filesystem verification of `BASELINE_AFTER\n` |
| Grep | **PASS** — exactly one local completed `grep`, `BASELINE_AFTER`, exact target/limit 10, exact one-match output |
| Glob | **PASS** — exactly one local completed `glob`, `baseline.txt`, exact directory/limit 10, exact one-path output |
| Tool correlation | **PASS** — 12 retained Started/Called/Success records correlated by tool and assistant IDs; 16 total tool SSE events; `executed:false` means local rather than provider execution |
| Conversation retention | **PASS** — original model session's one user + five completed assistant messages, four completed tool records, stable content/input/finish hashes identical after reopen |
| Edited-file retention | **PASS** — exact edited bytes after generation; unchanged hash before second Runtime.start and exact bytes after second health; no reseeding |
| Earlier retention guarantees | **PASS** — additional genuine session, API-managed instruction entry and `/retention.txt` survived both lifetimes unchanged |
| Shutdown/cleanup | **PASS** — SSE aborted/joined, EOF, upstream scope-completion marker, natural exit 0/signal null/forced false in both lifetimes; public runtime.stop + workspace.flush + workspace.close and output join completed |

No check is FAIL or BLOCKED. No generic runtime capability blocker was encountered.
This result qualifies same-page close/reopen, not page-reload retention.

## Exact V2 contract and supported packaging

Docs read before implementation:

- <https://opencode.ai/v2/docs/config>
- <https://opencode.ai/v2/docs/providers>
- <https://opencode.ai/v2/docs/api>

The actual beta-19425 source was checked rather than inferring V1 configuration:

- `packages/core/src/config.ts` and `config/discovery.ts`: `project:false`
  disables project discovery; global configuration still loads.
- `packages/core/src/models-dev.ts`: the embedded snapshot remains available
  with `fetch:false`. This candidate's snapshot does **not** contain Muse Spark.
- `packages/core/src/plugin/provider/opencode.ts:210–224`: the upstream provider
  enables public free-model access with `apiKey:"public"` when no private
  connection is configured.
- `packages/schema/src/config.ts`: configuration entries are documents with
  `path` and `info`; `/api/config` returns the entry array directly.
- `packages/protocol/src/groups/model.ts`: model list uses the location response
  envelope and may precede plugin settlement. We await
  `POST /api/plugin/await-activation?directory=/workspace` first.
- `packages/schema/src/model.ts`: model references use `{providerID,id}`.
  `packages/protocol/src/groups/session.ts`: create, prompt and context APIs.
- `packages/schema/src/session-event.ts`, `session-message.ts` and the real
  read/edit/grep/glob implementations retain the shapes asserted by the existing
  combined-tool and stable-history validators.

Before the browser run, the real Zen `/v1/models` endpoint returned HTTP 200 and
listed `muse-spark-1.3-contributor-free`. Ordinary global delivery installs
`/workspace/.server/config/opencode/opencode.json` with:

- root model `opencode/muse-spark-1.3-contributor-free`;
- explicit supported `providers.opencode.models` entry using
  `@opencode/ai/providers/openai`, tools capability, context/output limits from
  the previously accepted catalog, and HTTP transport (`websocket:false`);
- `providers.opencode.settings.baseURL` pointing to the existing host model
  proxy, which transparently streams to `https://opencode.ai/zen/v1`;
- allow rules for read/edit/grep/glob and `snapshots:false`.

Public access was used; no private credentials were loaded or delivered. The
proxy retains method/path/status only, not headers or provider request/response
bodies. The upstream application constructs the real model requests and executes
the real tools. No synthetic messages or model outputs are injected.

Search uses the nine unchanged files of the existing `ripgrep@0.3.1` npm package,
hash-checked and read-back checked, plus the existing ordinary bin symlink/chmod
installer. Both installer executions emitted `OPENCODE_RIPGREP_INSTALL_PASS`,
empty stderr and natural exit 0. `PATH=/direct/node_modules/.bin:/bin` and the
package-supported `RIPGREP_NODE_WASI=0` select its JavaScript/WASM execution path.
The app and generated sources were not edited or rebuilt. No runtime change,
application transform, replacement API/tool, or shared-pin promotion was made.

## Run, model and filesystem evidence

- Run: `59e21309-e582-4069-ac2b-76c13a561be1`.
- Origin: `http://127.0.0.1:64205/`.
- Browser Control CLI session: `amber-walrus-295`; one navigation and one bounded
  wait; rendered `FINAL PASS`. The dedicated session was deleted afterward.
- Host: `sh_092ef4392001vsl5CrosdHz7gI`, completed automatically with exit 0.
- Model session: `ses_f6d106805ffeml14luOH0IcZDu`.
- Previous-guarantee retention session: `ses_f6d103c12ffeKHxkkQeYgQoB5F`.

The final model text's JSON-string SHA-256 is
`dbf05ee6ef9bed871ce2d3d74a527072fc58e46cfbad16aa4bfc50ccedbb6679`, independently
matching `"COMBINED_PROBE_OK"`. The acceptance gate requires successful real
completion and nonempty model text; exact final-marker equality is an additional
post-run observation. Intermediate prose and reasoning are retained as hashes.

| Data | Bytes / SHA-256 |
| --- | --- |
| Initial `BASELINE_BEFORE\n` | 16 / `56e029ebb3be5756ba86df9eb8345ff54e07a90d43db668e16ea80a7fc804e77` |
| Final `BASELINE_AFTER\n` | 15 / `e3866f28b5008d611653f340104d6f68a6bfd7451a0a2b888edeb1edd88c5b73` |
| Stable conversation projection, before and after | `9705e571b6c353b103c6c086b6e2b4cfba516d0a3211b29cebb4563b2f0f0f4e` |
| Earlier-guarantee `/retention.txt` | `d1dec53927bf2ea33a485fe2ac3818e2d07f8fd17049a1f75040e6640c1d3942` |

The edit event's human-readable receipt content is explicitly a sanitizer label
(`validated local edit success`), not raw model/tool output. Its genuine completed
context record's input and full output hashes are retained and identical after
reopen; the actual resulting file is verified independently through workspace.fs.

Model qualification started at `1789171569751`, tools/history verified at
`1789171581923`, first workspace closed at `1789171582203`, edited file checked
before second runtime at `1789171584783`, retained conversation verified at
`1789171595948`, and final cleanup joined at `1789171597068` (Unix milliseconds).
The complete run took about **40.6 seconds** from browser provenance verification.
Model execution has the existing 180-second bound; browser 300 seconds, host
360 seconds, individual cleanup operations five seconds.

Both listeners used port 4096 with fresh identities:
`28f3322b-2a7c-4923-8cec-fc8707be9563:1` then
`5f06b43d-e492-4f13-9602-c1737ea48b00:1`; the old endpoint rejected `CLOSED`.
The first boot applied 46 database migrations (251 ms); no second bootstrap
appeared. All five provider POSTs returned 200; the reopened phase sends no prompt.

## Immutable identities and durable outputs

Retained root:

```text
/private/var/folders/t_/x48jtnps7n5_0g_pt9xpvbg00000gn/T/opencode/server-process-candidate.0co24kti
```

- Source: `.runtime/opencode-v2-source`, clean
  `20aff6d9f643afe9abf8a048e68f019d049f5329`.
- App: `.runtime/opencode-bun-server/server.js`, 28,419,496 bytes,
  `55be88221d3d21dc373fb7ad7f80fdda3974a4a0be6453001e8e3df0957fc4fb`.
- Build receipt: `d6dcd8f0458d7bb3238229eebb0d01766eb4bd8861abc8e74646fe65fe8d7949`.
- Runtime fork: clean `80d5cdd599fce4fa4817128461c865e009109d34`.
- Distribution: `browser-container-poc/workspace-api/dist/runtime`, version
  `098e0b60a0ff8703994ea681d9c974ae9267bfe5dbdd799e87ff00982ff938a3`.
- Distribution manifest: `bb4ea1f22640c31ab9dc25c0790dda74e3c096061f4b9612f74bc9f09be37816`.
- Runtime receipt: `0600a75b9789e31eb52924f8315c60fc6de891899550cfb0065ea96778ba0ad4`.
- Browser harness bundle: `915790483b9e3f717421c86f8ca568736a446d0f27f159dec16a19639336b88a`.

The host checks original source/tree/lock/recipe/output identities, clean runtime
source, distribution derivation and all requested runtime bytes. Fourteen worker
requests used the same five unique worker assets listed in the startup report;
extra process workers execute ordinary ripgrep installation and searches.
Post-run checks reconfirmed all app hashes, source cleanliness, distribution
manifest/runtime receipt, and every requested runtime asset. Offline replay of
both host acceptance validators against the persisted receipt also passed.

Evidence root relative to `browser-container-poc/vivari`:

```text
.runtime/browser-direct/59e21309-e582-4069-ac2b-76c13a561be1/
```

| File | SHA-256 |
| --- | --- |
| `receipt.json` | `2815d537af4424e5bc81be48649e467f4bfd53f910f61ca04bb0b15b6ca282a4` |
| `stdout.bin` | `a83d5c8713bd3dbf4b37e7e74b2bff827ff455872af1a2f5c525356eaac8660e` |
| `stderr.bin` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `stages.jsonl` | `3b173ce75b770593122769f230945fcefb13750983384ce3498d4758e7be5133` |

Stdout **4,304 bytes / 23 chunks**, stderr **0 bytes**; received = acknowledged =
persisted, both iterators ended, no stream/sink errors. The log includes the real
`rg` subprocess argv and an informational interrupted `/api/event` fiber when the
completed SSE subscription is aborted; this is not failed model execution.
Browser diagnostics contained the existing SQLite initialization deprecation
warning. Host output/stages are incrementally fsynced and the receipt is atomic.

Cleanup completed through public APIs, with no forced execution stop. The host
stopped, the dedicated browser page was closed, and its OPFS origin was preserved.

## Harness changes, checks and next handoff

- `probes/opencode-direct-model.ts`: supported configuration delivery, catalog
  verification, real combined execution, completed conversation projection and
  before/after equality, sanitized diagnostic classification.
- `probes/opencode-direct-browser.ts`: `--model-tools` integrates model work into
  the existing two-lifetime retention harness, retaining its earlier checks.
- `scripts/serve-opencode-direct-browser.ts`: unchanged support-package delivery,
  existing real provider streaming proxy and method/path/status evidence.
- `scripts/opencode-direct-model-validation.ts` and `.test.ts`: require real
  model completion, correlated local tools, exact edited bytes and retained
  conversation alongside the existing startup/retention validator.

```sh
bun test scripts/opencode-direct-model-validation.test.ts \
  scripts/opencode-direct-browser-validation.test.ts scripts/opencode-bun-retention.test.ts
bun scripts/serve-opencode-direct-browser.ts <retained-root> --model-tools
```

Focused checks: **10 tests passed, 46 assertions**. These include rejection of
prose-only results, foreign/provider-executed or incomplete tools, changed
conversation, reseeded files, failed provider responses, forced exits, incomplete
cleanup, output loss and missing retention checkpoints. `git diff --check` passed.
`bun x tsc --noEmit` passed; a TypeScript API check adding both browser probes to
the configured roots also passed. This required explicit types in the harness
and existing retention test, plus ArrayBuffer-backed Response delivery for the
host's TypeScript DOM signatures. The emitted browser harness still has exactly
the live-run hash above. A focused post-run Response-body check preserved every
app/ripgrep byte hash, and receipt acceptance replay passed; no second model run
was needed for these typing corrections.

**Next bounded task:** qualify one genuine model-facing custom tool through this
candidate's supported V2 plugin extension API, using the same immutable inputs
and public lifecycle harness. Inspect the exact plugin/config contracts first;
require real model invocation and a completed correlated tool record with an
independent filesystem assertion. Keep generic platform capabilities in Vivari
and ordinary plugin/package delivery in the consumer. This pass completes the
authorized built-in read/edit/grep/glob increment; it does not promote a pin or
qualify custom extensions, page reload, or general process backpressure.
