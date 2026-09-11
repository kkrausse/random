# P1 runtime-owned HTTP streaming — implementation handoff

September 11, 2026. **P1 accepted**, including the complete OpenCode regression.

## Qualified source and receipts

- Runtime fork: `../vivari`, branch `browser-runtime`.
- Qualified clean revision: `48d4ca12fd478a6e28b0838830a4724ee771213e`.
- Runtime distribution: `028a96fdd9e2c86963e9ca4f2a46f41f16fe40996011caec70d702b45e731aa7`.
- OpenCode package remains the normal, non-trace server-only package at
  `d7a7256bb6b0952f486c95718cfbf460b1570a56`; all 19 delivered assets verified.
- Model: `muse-spark-1.3-contributor-free`.
- HTTP browser gate: `http://127.0.0.1:43930/http-stream`, session `amber-raven-991`.
- OpenCode gate: `http://127.0.0.1:43931/`, session `amber-falcon-005`.
- Local ignored receipts: `doc/logs/opencode-server/http-stream-2026-09-11.json`
  and `doc/logs/opencode-server/acceptance-p1-2026-09-11.json`. These contain only
  results and selected checkpoints, without credentials or model reasoning.

`vivari/runtime-source.json` now pins the qualified runtime. These origins have
been used; select new ports for another fresh qualification.

## Implementation

```text
Endpoint.fetch(Request)
  ↕ per-request MessagePort: metadata / chunks / credits / EOF / error / cancel
Kernel worker: validate listener incarnation, bind request to owner PID
  ↕ out-of-band worker messages
Runtime bridge in the EXISTING listener worker
  → Node http.request → local virtual socket → Node HTTP server → application
```

No additional guest service or worker is launched. Each request owns an ordinary
HTTP client connection (`agent: false`) and stream state inside the server worker.
Temporary HTTP scripts, base64 argv bodies, HTTP stdout framing and the 8 MiB
total upload limit are removed. Public Endpoint/Runtime API shapes are retained.

Key fork files:

- `packages/runtime/http-stream.js`: HTTP client, streaming pump, cancellation.
- `packages/runtime/index.js`, `boot.js`, both process-worker entries: controlled
  event-loop dispatch and explicit request liveness.
- `packages/kernel-host/kernel.js`: ownership, routing, admission, cleanup.
- `packages/core/src/workers/kernel-worker.ts`: listener-generation validation.
- `packages/runtime/node/bindings/net.js`: local TCP/Pipe async write completion.

Embedding: `workspace-api/src/browser/{endpoint,http-stream,preview}.ts`, plus
`runtime.ts`. Generic fixtures/checks are fork-owned; application/browser harnesses
remain in the integration repo.

### Streaming and lifetime contract

- Independent upload/download windows allow one **64 KiB** chunk each, including
  messages in transit. Upload credits follow Node's write callback; response
  credits follow actual consumer pull. Headers resolve fetch immediately.
- Local sockets admit at most 64 KiB to the peer inbox and delay write completion
  until consumed. This reaches normal Node `write()`/`drain` behavior instead of
  moving buffering out of the bridge into an unbounded socket queue.
- A caller-supplied upload chunk or application's current socket write can exceed
  the transport window and is retained while sliced. Application code must obey
  stream backpressure; arbitrary producer-owned queues are not bounded by this.
- Supervisor admission caps active HTTP requests at 128. Request metadata is
  capped at 65,536 serialized characters; response parsing at 64 KiB headers.
  Binary bodies are raw bytes; repeated headers cross as pairs, subject to Fetch's
  browser restrictions (e.g. constructed Response filters Set-Cookie).
- Body cancellation/abort destroys the real connection, not the server. Early
  responses cancel unfinished uploads. Mid-body failures error the response.
- `server.close()` retires the listener/Endpoint for new requests but **drains
  accepted responses**. Bridge requests ref the event loop until drained/cancelled.
  Process exit or listener replacement fails active channels. Explicit endpoint
  disposal and runtime stop cancel requests even on retired listeners.
- An unread body retains bounded space and a request slot until cancellation or
  owner shutdown; there is no implicit idle timeout or garbage-collection contract.
- Programmatic expose/fetch registers no SW. Preview attachment registers it lazily
  before navigation; disposal during registration does not navigate a stale frame.

The shutdown distinction was found by the real OpenCode regression: the first
implementation killed the accepted stop response on listener close. The focused
shutdown test now waits for Endpoint.closed, drains the response, and requires a
clean process exit. This fixed both graceful stops in the full server workflow.

## Verification completed

- Native Node 24.7.0 and guest-worker `net-backpressure` passed; all seven fork
  runtime contracts and `bun run verify` passed.
- `workspace-api`: typecheck, unit tests, full real-worker contract, library build,
  and isolated tarball consumer checks passed. Consumer checks include NodeNext
  declarations, React/SSR, independent-copy preview attachment and asset relocation.
  The smoke fixture now uses Node 24 types rather than unused, incompatible latest
  Bun types; its preview checks await lazy registration and verify disposal races.
- Real-browser bridge checks passed: repeated headers, HEAD/204, live SSE with eight
  concurrent JSON calls, 2 MiB binary streaming echo, slow upload/abort, 32 MiB
  download, pre-header cancellation, mid-body failure and early response cleanup.
- An unread 32 MiB response stopped the producer at **131,072 bytes** in both
  headless workers and Chromium, then resumed and delivered every byte.
- Browser checks also passed no-SW programmatic HTTP, lazy preview navigation,
  graceful response drain, listener replacement and active-request process exit.
- Headless checks assert unchanged PID allocation across HTTP calls and zero
  retained HTTP channels after process exit.
- Complete `serverBaseline.qualify()` passed: readiness/session creation, real
  model SSE, successful read/edit/grep/glob, exact edited bytes, two clean exits
  `{exitCode:0, signal:null, forced:false}`, new service/listener identities,
  old-endpoint rejection, session/edit retention, runtime/workspace cleanup.

## Headless requalification at `80d5cdd` (2026-09-11)

One offline run of `bun run test:workers` from `workspace-api` completed with
exit 0 and `RESULT PASS (real headless workers; browser-only gates remain separate)`.
The existing runner bundles the test harness and launches native
`bunx --package node-bin-darwin-arm64@24.18.0 node tests/.headless.mjs`;
the selected binary reported `v24.18.0`. The offline contract has a 90-second
deadline; this invocation also had a 120-second outer timeout. No selector is
supported, so the existing offline suite ran once, with `PREPARED_APPS` and
`APP_RESTORE` unset.

Provenance checked through `vivari/scripts/runtime-source.mjs`, including after
the run at `2026-09-11T20:55:00.868Z`:

- Resolved fork `/Users/kkrausse/Documents/repos/kkrausse/vivari`, clean HEAD
  `80d5cdd599fce4fa4817128461c865e009109d34`.
- Existing `vivari/.runtime/patched-build.json`: same clean revision, built
  `2026-09-11T18:36:31.189Z`, development receipt (`release: false`), SHA-256
  `0600a75b9789e31eb52924f8315c60fc6de891899550cfb0065ea96778ba0ad4`.
  All 37 receipted native output hashes matched the current fork files.
- Existing `workspace-api/dist/runtime/distribution.json`: version
  `098e0b60a0ff8703994ea681d9c974ae9267bfe5dbdd799e87ff00982ff938a3`,
  matching revision and build-receipt hash. The headless adapter loads fork
  source and existing native artifacts; this is provenance context, not an
  execution of the browser distribution.

Fresh HTTP checkpoints all passed: JSON/repeated headers/HEAD/204; live SSE with
eight concurrent JSON requests and cancellation; byte-exact 2 MiB streaming echo;
32 MiB response stall/resume/drain; slow upload backpressure and source cancellation
on abort; mid-body error, pre-header abort, unread response cancellation reaching
the guest connection, and early-response upload cleanup. Shared checks returned
`{ status: 'PASS', stalledProducerBytes: 131072 }`, matching the older headless
stall observation. The embedding checks also passed unchanged PID allocation,
graceful listener close with accepted-response drain and clean exit, listener
replacement, active-SSE process stop with reader rejection, closed-endpoint
rejection, and **zero retained HTTP channels**.

The remaining existing offline checkpoints passed: shared binary VFS, exact
argv/cwd/env and byte streams, stdin EOF, child byte fidelity, runtime stop/port
cleanup, filesystem reattachment, bounded output overflow, and local ripgrep WASM
contracts. The run emitted the expected main-thread OPFS SQLite VFS availability
notice. It used no browser, host live OpenCode, credentials, or real model.

This adds headless HTTP evidence at `80d5cdd`; the original browser HTTP acceptance
above remains evidence at `48d4ca12fd478a6e28b0838830a4724ee771213e`. The focused
Chromium requalification below supplies the newer browser transport evidence.
These results do not qualify generic stdout credits or the other P2 process-stream
contracts.

## Focused Chromium requalification at `80d5cdd` (2026-09-11)

**PASS**, once, completed `2026-09-11T21:07:59.159Z`. Integration checkout started
clean at `ed260fc6b923e7025f9d7ac5b1f66d3865240afb`. Runtime source resolved through
`vivari/scripts/runtime-source.mjs` to the canonical fork; before/after inspection
confirmed clean HEAD `80d5cdd599fce4fa4817128461c865e009109d34`. The existing
development build receipt and distribution match the headless provenance above;
the receipt SHA-256 was rechecked as
`0600a75b9789e31eb52924f8315c60fc6de891899550cfb0065ea96778ba0ad4` and matches
`distribution.json.runtimeBuildSha256`.

Exact existing entrypoint: `vivari/probes/http-stream.ts`, served by
`vivari/scripts/serve-opencode-server.ts`; shared assertions are the fork's
`scripts/lib/http-stream-checks.mjs`. The host has no HTTP one-shot report mode.
From `vivari`, run `PORT=0 bun scripts/serve-opencode-server.ts`; this invocation
allocated fresh origin `http://127.0.0.1:56865`. The host bundles its existing probes
in memory and serves the existing runtime distribution. No app/runtime build or
pin change was performed.

Browser Control CLI used existing session `brisk-walrus-245`, one navigation,
and the documented asynchronous result convention with a retained completion
promise (no agent polling or sleeps):

```sh
browser-control execute --session brisk-walrus-245 'await page.goto("http://127.0.0.1:56865/http-stream"); return await page.evaluate(() => { window.httpResult = {status:"running"}; window.httpCompletion = window.qualifyHttpStreaming().then(result => window.httpResult = result, error => window.httpResult = {status:"FAIL",error:String(error)}); return {url:location.href, started:true, isolated:crossOriginIsolated, userAgent:navigator.userAgent}; })'
browser-control execute --json --session brisk-walrus-245 'return await page.evaluate(async () => ({result:await window.httpCompletion,log:document.querySelector("pre").textContent,url:location.href,completedAt:new Date().toISOString()}))'
```

Both commands exited 0. The completion command ran asynchronously with a
120-second outer bound and returned `ok: true`, no warnings, zero console/page
errors, and:

```json
{"status":"PASS","stalledProducerBytes":131072,"runtime":"098e0b60a0ff8703994ea681d9c974ae9267bfe5dbdd799e87ff00982ff938a3"}
```

Actual passing assertions/checkpoints:

- JSON, repeated `x-repeat` headers, HEAD/204 bodylessness; live SSE first event
  alongside eight concurrent JSON requests, then reader cancellation.
- Byte-exact 2 MiB streaming echo, including EOF; unread 32 MiB response stalled
  at 131,072 producer bytes (within the 1 MiB assertion budget), then resumed and
  drained all bytes with fidelity.
- Slow upload read-ahead within 2 MiB, abort rejection and upload-source
  cancellation; mid-body failure rejects rather than becoming EOF; pre-header
  abort; unread response cancellation closes a guest connection; early response
  cancels the unfinished upload.
- Programmatic HTTP registers no Service Worker; lazy preview registration and
  navigation produce `HTTP_PREVIEW_PASS`.
- Listener close resolves `Endpoint.closed` while the accepted shutdown response
  drains exactly `graceful`; server exits with code 0. Replacement has a new URL
  and the retired endpoint rejects requests.
- Stopping the replacement process rejects its active SSE reader. The returned
  promise also completed the probe's `runtime.stop()`, workspace flush and close.

Browser context reported cross-origin isolation and Chrome `152.0.0.0` on macOS.
Evidence is retained in the CLI session journal
`~/.browser-control/sessions/brisk-walrus-245/journal.jsonl` and the completion
command's result above; the fresh origin is now used.

Limits: this focused probe does **not** assert unchanged PID allocation or zero
retained HTTP-channel counts; those remain the separately passing headless
assertions. Connection cancellation and active-reader rejection are the browser
cleanup evidence. Repeated Set-Cookie is conditional in the shared contract and
browser Fetch filters it, so no browser cookie-fidelity claim is made. OPFS is used
by the workspace, but full page reload/reopen durability and exhaustive storage/SW
lifecycle are not asserted here. The graceful-exit assertion checks exit code,
not the full headless exit tuple. No OpenCode server/model workflow, credentials,
host live OpenCode, or P2 process-stream qualification was exercised. The original
full OpenCode acceptance remains at its recorded older revision.

## Reproduce / continue

From `random/browser-container-poc/vivari`, with the canonical fork checked out:

```sh
bun scripts/build-runtime.ts --release --revision 48d4ca12fd478a6e28b0838830a4724ee771213e
bun ../workspace-api/scripts/distribution.ts
PORT=43932 bun scripts/serve-opencode-server.ts
```

Use Browser Control CLI only. On a fresh origin, `/http-stream` exposes
`window.qualifyHttpStreaming()`. Start it asynchronously and retain the result:

```js
window.httpResult = { status: 'running' }
window.qualifyHttpStreaming().then(
  result => window.httpResult = result,
  error => window.httpResult = { status: 'FAIL', error: String(error) },
)
```

Run OpenCode on another fresh origin at `/`, using the unchanged
`startServerBaseline()` then `serverBaseline.qualify()` workflow in the
[baseline handoff](opencode2-server-baseline-handoff.md). Existing package snapshot
and packaging prerequisites described there still apply.

**Next: P2 process/stream semantics, alongside direct upstream execution.** The
[OpenCode case study](opencode-runtime-case-study.md) defines the install-and-run
goal with runtime-owned shims and no prerequisite package-hacking scripts. P1
acceptance still uses custom packaging; it does not qualify that new direct path.
HTTP local-loopback flow
control is implemented; execution stdout overflow credits, acknowledged stdin,
cross-process pipe backpressure, final-output ordering and child-tree cleanup
still need their own contracts. Legacy buffered SW HTTP/WS/EventSource paths,
redirect following, browser cookie jars and SQLite transport are not replaced by
this milestone. The OpenCode acceptance covers server-process restart inside one
runtime, not page reload/full runtime reopen.
