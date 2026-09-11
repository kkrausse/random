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

**Next agreed milestone: P2, process/stream semantics.** HTTP local-loopback flow
control is implemented; execution stdout overflow credits, acknowledged stdin,
cross-process pipe backpressure, final-output ordering and child-tree cleanup
still need their own contracts. Legacy buffered SW HTTP/WS/EventSource paths,
redirect following, browser cookie jars and SQLite transport are not replaced by
this milestone. The OpenCode acceptance covers server-process restart inside one
runtime, not page reload/full runtime reopen.
