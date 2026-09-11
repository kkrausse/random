# September 11: unchanged direct server/process browser OPFS PASS

**PASS — one real-browser attempt, final host receipt accepted, host exit 0.**
The retained beta-19425 direct-server artifact completed fresh OPFS startup,
missing/valid authentication checks through the public runtime HTTP endpoint,
EOF-triggered scoped shutdown, natural guest exit and public cleanup.

Run `be610c7d-daec-44c6-baf3-b97da578a609`; origin
`http://127.0.0.1:63477/`; Browser Control CLI session `lucky-panda-953`.
The session made exactly one navigation to the qualification page. The final
rendered page said `FINAL PASS`; the session was then deleted. Background host
`sh_092da6b63001WU8Kc0EH7U25ep` completed automatically with exit 0. No completion
polls, retries, application rebuilds, runtime edits or nested delegation.

## Execution evidence

| Checkpoint | Observed result |
| --- | --- |
| Origin isolation | Empty origin OPFS before boot; empty default workspace; cross-origin isolated |
| Real OPFS | `Workspace.open({id:'default', storage:opfsStore(...)})`; persistence status durable |
| Application delivery | All **five** original assets fetched, length/hash checked, installed, read back and rechecked |
| Database preparation | Ordinary marker installation creates `/runtime-probe`, matching the unchanged artifact's fixed database path; path is included by runtime OPFS persistence policy |
| Process | `runtime.node({entry:'/bin/bun.js', args:['/app/server.js'], ...})`, live concurrent output drains |
| Listener | Public `runtime.expose(4096)` produced a real endpoint |
| Bootstrap | **46 migrations**, completed in 237 ms according to the guest log |
| Ready | `OPENCODE_SERVER_PROCESS_READY` received and persisted |
| Missing authentication | `endpoint.fetch('/api/health')` returned **401** |
| Valid authentication | **200**, `healthy:true`, version `0.0.0-beta-19425`, PID 1 |
| Shutdown | Public `execution.closeStdin()`; subsequent scope-completion marker observed |
| Natural exit | `exitCode:0`, `signal:null`, `forced:false` |
| Output | Both iterators ended, no stream errors; drains joined |
| Public cleanup | `runtime.stop`, `workspace.flush`, `workspace.close` completed |
| Forced stop | Not needed |

Browser timestamps (Unix milliseconds): OPFS fresh/durable `1789170205712`,
listener `1789170220377`, ready `1789170220831`, authenticated health
`1789170221004`, EOF posted `1789170221008`, scope complete `1789170221028`,
natural exit `1789170221033`, output-join cleanup `1789170221044`.

The configured password was probe-only and is not logged in the receipt.
No CLI registration, managed-stop route, replacement server route or fake
transport was used. EOF posting itself has no public acknowledgment; the later
upstream completion marker and natural exit establish shutdown behavior here.

## Runtime distribution actually consumed

- OpenCode source: clean `20aff6d9f643afe9abf8a048e68f019d049f5329`.
- App JS: 28,419,496 bytes, SHA-256
  `55be88221d3d21dc373fb7ad7f80fdda3974a4a0be6453001e8e3df0957fc4fb`.
- Runtime fork: clean `80d5cdd599fce4fa4817128461c865e009109d34`.
- Existing distribution version:
  `098e0b60a0ff8703994ea681d9c974ae9267bfe5dbdd799e87ff00982ff938a3`.
- Served distribution manifest SHA-256:
  `bb4ea1f22640c31ab9dc25c0790dda74e3c096061f4b9612f74bc9f09be37816`.
- Runtime build receipt SHA-256:
  `0600a75b9789e31eb52924f8315c60fc6de891899550cfb0065ea96778ba0ad4`.

The host compared the embedded build receipt to the retained runtime receipt,
verified current active distribution assets, checked the existing service-worker
delivery transformation and recomputed the distribution version. Every requested
runtime asset was hashed against the distribution's build receipt before serving.
The browser independently verified its fetched manifest hash and version/revision.
This is distribution-byte evidence, not an inference from the source checkout.

Actual runtime asset requests recorded by the host:

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `kernel-worker-Dmy-e65G.js` | 1,439,193 | `58a75966fa0ad064fffafc857db16a3f3a066fc9296ba9ae69ea9c522003218b` |
| `fs-worker-CYb_t2-r.js` | 1,953,497 | `8fd40f553d7640986ddaed9127e786b7e996a4140e7ad97570e0165d7ce42b24` |
| `fetcher-worker-CxT7BEmg.js` | 8,216 | `c91652614cf1a79594dec5cbfc7b286f76cc6b73a3549d6da9b63bc09e291ac6` |
| `sqlite3-opfs-async-proxy-DIHjN6DZ.js` | 15,929 | `12b73d0f4b16ea950f16ee26c1547f0126e143df63e04f5be115f05bfc758dd1` |
| `process-worker-BnzBLkVx.js` | 2,973,471 | `055132f08636894f6b8f49660e00eeafa23104733d4ef35debd3339b8e9eca09` |

All paths are under `runtime/assets/`. The service-worker asset was validated
but was **not requested** in this endpoint-fetch-only run; iframe/preview service
worker behavior is not claimed.

## Output and durable host receipts

Relative to `browser-container-poc/vivari`:

```text
.runtime/browser-direct/be610c7d-daec-44c6-baf3-b97da578a609/
```

| File | Evidence | SHA-256 |
| --- | --- | --- |
| `receipt.json` | final host-accepted PASS, full provenance, browser result, runtime requests and cleanup | `0d574b00b041984440db316f784d755f658628e082e3265e24cae85bacf9afa2` |
| `stdout.bin` | **382 bytes**, 5 chunks, browser received = acknowledged = host persisted | `b7d9ba133b866b3fe3e1363895f5509c0115e61f69be6ffadaec1a717b40ef28` |
| `stderr.bin` | **0 bytes**, ended normally | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `stages.jsonl` | incrementally persisted browser checkpoints | `08a00dd619b2c26d7a0e1842a702349e386a77ef1d71656bf51e0ed5ddbd5b01` |

Each channel uploads sequentially with an explicit byte offset while stdout and
stderr drain concurrently. Host acknowledgments follow complete writes and
fsync. Rejected uploads, offset disagreement and stream errors fail the attempt.
The final host verifier checks browser counts/hashes against its own log files,
ended streams, ordered lifecycle stages, auth outcomes, unchanged app identities
and complete cleanup. No primary, secondary, stream or sink errors were recorded.

The browser operation has a 120-second bound and five-second bounds on individual
cleanup operations. The host's 180-second deadline retains received logs and last
durable stages, with missing browser cleanup explicitly unreported. These failure
paths are implemented; this single browser attempt exercised the happy path.
Private worker exit/messageerror events are not exposed by the public API and
are not fabricated as receipt fields. Public cleanup and output join completed;
received-to-persisted byte equality is not an end-to-end losslessness claim.

Browser Control reported a cosmetic `favicon.ico` 404 and a SQLite WASM
initialization deprecation warning. Neither was a guest stream or application
execution failure. The dedicated page was closed after completion, and the host
server stopped; existing browser tabs and OPFS origins were preserved.

## Harness changes and focused checks

- `probes/opencode-direct-browser.ts`: one direct-server browser lifecycle using
  public Workspace/Runtime/Endpoint APIs and acknowledged concurrent log delivery.
- `scripts/serve-opencode-direct-browser.ts`: candidate/distribution integrity,
  fresh-origin hosting, exact output sinks, stages and final receipt.
- `scripts/opencode-direct-browser-validation.ts`: host acceptance checks.
- `scripts/opencode-direct-browser-validation.test.ts`: **3 tests passed**,
  **10 assertions**, covering complete acceptance and rejection of missing/early
  readiness/EOF, forced exit, incomplete cleanup, byte/hash loss, unjoined streams,
  wrong runtime and incorrect authentication. These are synthetic host-validator
  checks, not additional browser/application executions.

Commands:

```sh
bun test scripts/opencode-direct-browser-validation.test.ts
bun scripts/serve-opencode-direct-browser.ts \
  /private/var/folders/t_/x48jtnps7n5_0g_pt9xpvbg00000gn/T/opencode/server-process-candidate.0co24kti
# Browser interaction exclusively via browser-control execute --session lucky-panda-953.
```

Only the browser harness was bundled, SHA-256
`70ec4fc5a9208a3915bae2e354519e806158bec0d1b96ca923d13b540cbe9552`.
The application, runtime, prior failed logs and headless receipts were preserved.
The old clean qualified artifact still hashes to `1281158d…`.

**Scope:** browser OPFS startup/authenticated health/EOF shutdown only. No tool,
model, chat, session-retention, reopen or page-reload qualification. **Next bounded
task:** separately authorize one same-page OPFS reopen/retention lifecycle for this
exact artifact, before broader tool/model qualification or shared-pin promotion.
