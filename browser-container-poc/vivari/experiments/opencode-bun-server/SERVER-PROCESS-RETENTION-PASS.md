# September 11: unchanged beta-19425 same-page OPFS retention PASS

Follow-up: [real model-driven read/edit/grep/glob and conversation retention PASS](SERVER-PROCESS-MODEL-TOOLS-PASS.md)
on the exact same unchanged candidate, preserving all checks below.

**PASS — one real-browser attempt, two natural server lifetimes, host-accepted
receipt, host exit 0.** This extends the exact direct-server artifact qualified by
`89bfa12651077107f13ca72482d3b28499f908fa` through full same-page Workspace/Runtime
close and reopen. No generic capability blocker was encountered.

## Established checks and this increment

- [Direct browser baseline](SERVER-PROCESS-BROWSER-PASS.md): beta-19425 startup,
  authentication, EOF shutdown and real OPFS, without retention.
- [Older combined qualification](../../../doc/opencode-direct-startup.md):
  `d7a7256` / JS `1281158d…` passed real read/edit/grep/glob and retention. That
  application result does not qualify beta-19425; its runtime distribution is shared.
- This increment creates a genuine upstream session and durable API-managed
  instruction entry, saves workspace data, tears down the entire workspace/runtime,
  and retrieves identical session/entry/file data through newly opened public APIs.
  It exercises no model request or conversation history. Page reload is separate.

V2 API documentation: <https://opencode.ai/v2/docs/api>. Exact retained candidate
contract checked in `packages/protocol/src/groups/session.ts`: create at 170–185,
instruction list/put at 578–607. Routes used:

```text
POST /api/session {title, location:{directory:"/workspace"}}
PUT  /api/session/<id>/instructions/entries/retention {value:{runID,purpose}}
GET  /api/session/<id>/instructions/entries
GET  /api/session/<id>
```

The PUT is the upstream durable instruction-entry API, not a fabricated message,
imported transcript, model response, or replacement route. The returned entry JSON
was read back before shutdown and compared exactly after reopen.

## Actual lifecycle evidence

Run `7d13ab35-5c4e-4d81-9b3c-36ecab9872fc`; origin `http://127.0.0.1:63920/`;
Browser Control CLI session `quiet-tiger-136`. Exactly one page navigation, then
one bounded wait for rendered `FINAL PASS`. Host shell
`sh_092e738ac001bszl4xJLgAMy3X` completed automatically with exit 0.

| Check | Observed |
| --- | --- |
| Storage | Initially empty origin; default OPFS durable at both opens |
| First bootstrap | 46 migrations, 226 ms; no second bootstrap in stdout |
| Assets | All five retained app files fetched, hash-checked, installed and read-back checked in both lifetimes |
| Authentication | Missing auth 401 and authenticated healthy beta-19425/PID 1 in each lifetime |
| Session | `ses_f6d186956ffe7sQQd0FnfxMi5t` at `/workspace` |
| Title before/after | `OPFS retention 7d13ab35-5c4e-4d81-9b3c-36ecab9872fc` |
| Durable instruction | Key `retention`; JSON value contains this run ID and purpose `same-page OPFS retention qualification`; exact equality after reopen |
| Workspace data | `/workspace/retention.txt`, run-specific two-line data; no reseeding on reopen |
| File SHA-256 | `144e7cbb75fdacffc4b6fccbdae8fd2bd61485839f7e3057850f9a3867f03324`, matched before second Runtime.start and after second health |
| First teardown | EOF, scope-completion marker, natural exit, output join, runtime.stop, workspace.flush, workspace.close |
| Old endpoint | Public fetch rejected `CLOSED` |
| Fresh endpoint | Listener identity changed from `30f34f69-7425-424e-9d57-ed6240c4d6dd:1` to `e4e29269-6d00-4028-8aa6-bfe9fc4e4168:1` |
| Both exits | `exitCode:0`, `signal:null`, `forced:false` |
| Final cleanup | runtime.stop, workspace.flush, workspace.close, joined output; no forced stop |

First workspace close occurred at `1789171047375`; second durable open at
`1789171050674`; retention verified at `1789171063386`; final joined cleanup at
`1789171063701` (Unix milliseconds). Ordinary `/app` delivery runs again because
application asset restoration is distinct from saved workspace/session data. The
`/runtime-probe` database directory marker is installed only on the initial boot.

## Candidate and distribution identities

Retained root:

```text
/private/var/folders/t_/x48jtnps7n5_0g_pt9xpvbg00000gn/T/opencode/server-process-candidate.0co24kti
```

- App directory: `<root>/.runtime/opencode-bun-server` (five original files).
- Source: `<root>/.runtime/opencode-v2-source`, clean
  `20aff6d9f643afe9abf8a048e68f019d049f5329`.
- Build receipt: `<root>/build-receipt.json`, SHA-256
  `d6dcd8f0458d7bb3238229eebb0d01766eb4bd8861abc8e74646fe65fe8d7949`.
- `server.js`: 28,419,496 bytes, SHA-256
  `55be88221d3d21dc373fb7ad7f80fdda3974a4a0be6453001e8e3df0957fc4fb`.
- Distribution: `browser-container-poc/workspace-api/dist/runtime`, version
  `098e0b60a0ff8703994ea681d9c974ae9267bfe5dbdd799e87ff00982ff938a3`.
- Runtime fork: `80d5cdd599fce4fa4817128461c865e009109d34`.
- Manifest SHA-256:
  `bb4ea1f22640c31ab9dc25c0790dda74e3c096061f4b9612f74bc9f09be37816`.
- Runtime receipt SHA-256:
  `0600a75b9789e31eb52924f8315c60fc6de891899550cfb0065ea96778ba0ad4`.

The existing host checks source/tree/lock/recipe/build/output identities, runtime
cleanliness, distribution derivation and every requested runtime asset hash. The
browser verifies the served manifest and app bytes. Both lifetimes requested the
same five worker assets listed in the baseline report. After completion, all app
hashes, source cleanliness, distribution manifest and runtime receipt matched again.

## Durable output and acceptance

Evidence root relative to `browser-container-poc/vivari`:
`.runtime/browser-direct/7d13ab35-5c4e-4d81-9b3c-36ecab9872fc/`.

| File | SHA-256 |
| --- | --- |
| `receipt.json` | `747fc4303ded44c02ecc36db1caeded4cb1b326fde4a0c0469f66b3e795d3101` |
| `stdout.bin` | `0f385827153c53dd7b8cbdc2b28de3a3c776c79c760714bdd99bc6b8f4b29624` |
| `stderr.bin` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `stages.jsonl` | `27310e3a80bebc476f243f75925a4c3ecfd6cb5e29618d0a44357b4a360e9a85` |

Combined stdout: **2,347 bytes / 16 chunks**, received = acknowledged = persisted;
stderr: **0 bytes**. Both lifetimes' iterators ended, with no stream/sink errors.
Each output upload and stage is durably acknowledged. The host validates ordered
two-lifetime checkpoints and exact retained data in addition to baseline checks.
The receipt includes both natural exits, complete cleanup and ten worker requests.
The page's retention-created detail holds the live retention object, so its final
receipt copy includes later exit fields; `stages.jsonl` preserves the original
incremental checkpoint (`exits:[]`, `oldEndpoint:"pending"`).

Browser bound 180 seconds; host bound 240 seconds; individual cleanup bounds five
seconds. This attempt completed in about 32 seconds after browser provenance.
Only the qualification harness was bundled (SHA-256
`0081d7d1f9f834466ecf968a9b5b46938a9a2ac71f2306bba968705636f4d131`).
Browser diagnostics were the same cosmetic favicon 404 and SQLite initialization
deprecation warning as the baseline. The dedicated browser session was deleted
after final acceptance, host stopped, and the test origin's OPFS was preserved.

## Reproduce and next fresh-agent handoff

From `browser-container-poc/vivari`:

```sh
bun test scripts/opencode-direct-browser-validation.test.ts
bun scripts/serve-opencode-direct-browser.ts <retained-root> --retention
```

Focused validator checks: **4 passed, 15 assertions**, including rejection of a
single-lifetime result, changed session identity, incomplete first close and forced
exit. `git diff --check` passed. No application, runtime, generated artifact or
shared pin changed.

**Next authorized bounded task:** use a fresh agent for real model-driven
read/edit/grep/glob on this exact retained artifact. Start with this report, the
baseline report and the existing combined checks in `probes/opencode-bun-server.ts`,
`scripts/serve-opencode-bun-server.ts` and `scripts/opencode-bun-retention.test.ts`.
Carry forward exact asset/distribution verification, public Runtime/Endpoint APIs,
durable concurrent output and EOF/natural shutdown. Inspect the candidate's V2
prompt/model/config contracts before adapting the older harness. This artifact
sets `models.fetch:false` and `config.project:false`: use genuine supported model
and global configuration APIs/delivery as needed, and stop with a precise blocker
if capability is missing. Require actual completed read/edit/grep/glob tool records
and exact filesystem outcomes; this retention-only session is not tool evidence.
