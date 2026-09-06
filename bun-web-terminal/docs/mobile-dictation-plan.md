# Mobile keyboard icons and server-side streaming dictation

Status: proposed implementation plan. Local setup inspected September 6, 2026.

## Goal and recommendation

Replace the mobile toolbar's **Keyboard** label with a keyboard icon and put a
microphone icon immediately beside it. Tap the microphone to start dictating
from the phone; tap again to stop and flush the last words. Transcription runs
on the Mac hosting Bun and inserts text at the terminal application's current
cursor, without submitting Enter.

Use a dedicated same-origin WebSocket endpoint in Bun backed by a resident Swift
worker using FluidAudio and the same cached streaming model as the local Hex
app. Start with live append-only insertion, following the existing Hex fork's
transcript handling. Show the unfinished word in a small preview above the bar.

## What is already here

- `src/mobile.ts`: toolbar construction, keyboard toggle, one-shot Ctrl, and
  `terminal.paste()` integration. Keep its explicit keyboard-focus behavior.
- `src/client.ts`: connects mobile controls to `TerminalConnection`; all
  `terminal.onData` input passes through the mobile one-shot Ctrl transform.
- `src/connection.ts`: sends terminal bytes only while attached and ready;
  currently drops input while disconnected. Dictation needs a readiness and
  attachment-generation signal so it never silently inserts into a new attachment.
- `src/server.ts`: Bun HTTP routing and `/ws/:sessionId` terminal socket, with
  same-origin checks. Its socket data/handlers currently assume every socket is
  a terminal attachment; add a discriminated socket kind for dictation.
- Tailscale Serve already provides HTTPS/WSS, needed for phone microphone access.

### Invalidated prior experiments

The user confirmed that `../hackwhisper` and `../dictation-server-test` are old
experiments whose approaches were invalidated. Do not use their implementations
as references, reuse their audio pipelines, or treat their backends as fallback
options. Base this implementation on the working local Hex fork and its pinned
FluidAudio dependency.

### Actual Hex installation

The running executable is `~/Documents/repos/Hex/.build/debug/HexApp`, a local
Swift fork. Its `Package.swift` pins FluidAudio **0.15.5**. This matters because
upstream Hex now advertises a Rust rewrite; that is not the running installation.

The saved selected model is
`parakeet-unified-en-0.6b-streaming-1120ms` (English). The fork uses
`StreamingUnifiedAsrManager` with attention context `(70, 7, 7)`.

These assets were found under
`~/Library/Application Support/FluidAudio/Models/parakeet-unified-en-0.6b/`:

- `parakeet_unified_encoder_streaming_70_7_7_int8.mlmodelc`
- `parakeet_unified_decoder.mlmodelc`
- `parakeet_unified_joint_decision_single_step.mlmodelc`
- `config.json`, `metadata.json`, and `vocab.json`

`lsof` showed no network sockets for the running Hex process, and a source search
of its app directory found no HTTP/WebSocket listener. There is no discovered
server API we can simply call. The model's presence on disk is verified; loading
it in a separate worker and its end-to-end phone latency remain to be tested.

Useful local reference files in `~/Documents/repos/Hex/`:

- `Hex/Clients/StreamingParakeetClient.swift`: load/prewarm, reset, partial callback,
  append 16 kHz mono Float32 audio, process, finish, cancel.
- `Hex/Clients/StreamingDictationClient.swift`: live dictation orchestration.
- `HexCore/Sources/HexCore/Logic/AppendOnlyTranscriptCursor.swift`: verifies each
  cumulative transcript extends the previous one; reports divergence.
- `HexCore/Sources/HexCore/Logic/StreamingTranscriptPipeline.swift` and
  `StreamingTextTransformer.swift`: release whole words and flush the final tail.
- `HexCore/Sources/HexCore/Models/StreamingModel.swift`: exact model configuration.

## Backend choice

**Recommended: independent resident Swift worker, shared on-disk cache.** Bun
owns the public endpoint and worker lifecycle. The worker owns CoreML inference
and keeps the model loaded between recordings. Pin FluidAudio to the locally
working version initially and verify cache-path configuration before loading.
Use a configurable model directory; do not hardcode this user's home directory.
Preserve attribution/license notices for any adapted Hex code.

This avoids tying phone dictation to Hex's desktop microphone, hotkeys, clipboard,
or focused Mac app. It reuses model files, not Hex's in-memory model instance;
measure the additional resident memory and simultaneous-use behavior.

If that memory cost is unacceptable, a later shared daemon could serve both Hex
and Bun. Adding an endpoint inside Hex could also reuse its loaded model, but
would require modifying that separate app, arbitrating its single decoder with
desktop dictation, and keeping the GUI app running. No such endpoint exists in
the inspected code.

## Data path

```text
Phone microphone
  -> getUserMedia + AudioWorklet + stateful resampler
  -> same-origin WSS /api/dictation/stream
  -> Bun validation/session ownership + bounded worker transport
  -> resident Swift / FluidAudio / cached Parakeet Unified
  -> cumulative transcript events
  -> browser append-only word pipeline
  -> terminal.paste(delta)
  -> existing terminal WebSocket -> tmux -> current application
```

The ASR service accepts audio and returns text over loopback HTTP/WebSocket.
Bun launches and supervises it, then connects as an ordinary API client. Logs
go to stderr; stdin/stdout are not the application transport. One active recording
per service initially; return `busy` for another request.

## Standalone service boundary

Put the service in a sibling project, provisionally `../dictation-server/`, with
its own Swift package, dependency lockfile, tests, README, and API documentation:

```text
random/
  dictation-server/
    Package.swift
    Package.resolved
    Sources/DictationServer/
    Tests/
    README.md
    docs/protocol.md
  bun-web-terminal/
    src/dictation-service.ts    # process supervisor + HTTP/WS client
    src/dictation-server.ts     # browser routes + terminal ownership
    src/dictation.ts            # browser recording controller
```

The service builds and runs independently. Bun calls its executable and API; it
does not import Swift sources. Keep terminal sessions, tmux, browser focus,
paste policy, and the append-only insertion pipeline in bun-web-terminal. The
service owns model loading, decoding, audio validation, recording isolation, and
ordered cumulative transcript events. Other applications can supply their own
text insertion policies.

### Local API (proposed v1)

- `GET /healthz`: process liveness, service instance ID, and protocol version.
  Available while the model warms up.
- `GET /v1/status`: model ID, loading/ready/busy/error state, supported audio
  format, and limits. Model readiness is distinct from HTTP liveness.
- `WS /v1/stream`: one recording per connection. JSON text messages for
  `start`, `stop`, and `cancel`; binary messages for 16 kHz mono Float32 LE audio.
  Return `loading`, `ready`, `partial`, `final`, `done`, and structured `error`
  events using the same ASR schema as the browser protocol below.
- The local `start` contains protocol version, recording ID, and audio format.
  Terminal session/attachment fields exist only at the Bun boundary: Bun validates
  and removes them before forwarding. Bun proxies audio and ASR events without
  maintaining a second custom binary framing format.
- A disconnect cancels that connection's recording, drains/cancels outstanding
  inference, and resets the decoder before another recording can acquire it.
  A competing recording receives `busy`; it cannot replace the active one.
- Use an established Swift HTTP/WebSocket server library; select and pin a
  compatible version during the service spike rather than writing HTTP framing.

### Launch and supervision

- Service CLI accepts `--host` (default `127.0.0.1`), `--port`, and `--model-dir`.
  Bun configures executable path and local port; runtime does not rebuild Swift.
- Bun starts one child, waits for `/healthz` with a bounded startup timeout, and
  reports model warmup separately. Concurrent requests share the same startup.
- Pass a unique instance ID at launch and verify it in health responses. A port
  collision must fail startup rather than accidentally adopting another service.
- Bun owns termination of its child: SIGTERM on shutdown, bounded wait, then
  forced termination if needed. Use an optional parent-PID watchdog in managed
  mode to handle abrupt parent death; standalone mode has no parent dependency.
- A crash fails the active recording. Restart with bounded backoff for a fresh
  request; never replay audio or resume a recording automatically.
- Provide an explicit externally managed URL mode for reuse: when configured,
  Bun connects to that service and does not spawn or terminate it. Managed local
  mode remains the default. Document this distinction in both projects.
- Keep the service on loopback for this integration. Phones use Bun's existing
  HTTPS/WSS origin, so deployment needs only the current Tailscale Serve route.

## Browser/server protocol (proposed v1)

- `GET /api/dictation/status`: availability, loading/ready/busy/error, model ID,
  supported audio format. No model paths or transcripts in this response.
- `WSS /api/dictation/stream`: separate from terminal byte transport; use the
  existing same-origin policy and validate terminal ownership when starting.
- Client sends `start` with protocol version, recording ID, terminal session ID,
  attachment identity, `sampleRate: 16000`, `channels: 1`, `format: "f32le"`.
- Server sends `loading` if necessary, then `ready` for that recording. Only
  transmit audio after ready; show loading distinctly from recording.
- Binary frames contain raw little-endian Float32 mono samples, initially grouped
  into approximately 40–100 ms packets. Reject malformed, non-finite, oversized,
  or out-of-state input. 16 kHz Float32 uses about 64 KB/s before framing.
- Server sends ordered `partial` events with recording ID, sequence number, and
  **cumulative** text. They are not text deltas or guaranteed final words.
- Client sends `stop` after its final audio frame. Drain worklet/resampler output
  before stop; worker drains all prior audio, finishes once, and sends `final`
  with cumulative text followed by `done`. No new partials after final.
- `cancel` discards pending audio/text and resets decoder state. Already inserted
  terminal text remains. Worker errors use a structured `error` event.
- Bound queues on browser, Bun, and worker; initially cap a recording at five
  minutes and queued audio at two seconds. On overload, terminate with a clear
  error rather than losing chunks and continuing with a corrupted transcript.
- No automatic audio replay or dictation resume after reconnect. Recording IDs
  and sequence numbers reject stale/duplicate callbacks within the active session;
  they do not claim end-to-end exactly-once PTY delivery across failures.

## Microphone and toolbar behavior

- Use small Lucide keyboard/microphone SVGs consistent with the existing plain
  DOM toolbar. Retain accessible labels, titles, comfortable touch targets, and
  keyboard focus styling. Make SVG decoration `aria-hidden`.
- Keyboard icon keeps the existing toggle. Microphone sits directly after it;
  active state uses `aria-pressed`, a visible indicator, and a Stop label.
- States: idle -> requesting permission/loading -> recording -> finishing -> idle,
  with explicit unavailable/error states and cancellation while starting.
- Resume/create the AudioContext from the user gesture. Do not focus the terminal
  textarea to start recording. Preserve software-keyboard visibility.
- Capture the **phone** microphone. Use an AudioWorklet and a stateful, filtered
  resampler from the actual AudioContext rate (often 44.1/48 kHz); requesting
  16 kHz does not guarantee it. Keep the graph processing without audible feedback.
- Release microphone tracks, worklet, and AudioContext on stop, cancel, error,
  navigation, or page suspension. Cancel on terminal disconnect/takeover and drop
  late callbacks. iOS background/lock behavior requires testing on a real phone.
- Reuse the existing notice presentation for permission errors and server status;
  a compact transcript preview can show the pending word and divergence errors.

## Inserting streaming text

Match the append-only approach already used in the Hex fork:

1. Validate cumulative transcript prefix growth. Buffer incomplete words and emit
   whitespace-terminated spans. Flush the last pending word once on final.
2. Paste each released span through `terminal.paste()` so Ghostty handles
   bracketed paste. Clear one-shot Ctrl before starting/inserting, since the
   existing `mobile.input()` transform could otherwise modify a one-character delta.
3. Deduplicate final text against what was already observed/released. The local
   Hex implementation disables partial callbacks during finish and pads 400 ms
   of silence to retain trailing words; verify that strategy with this worker.
4. If the model revises an already observed prefix, stop automatic insertion and
   retain/show the final transcript for recovery. Never guess terminal backspaces
   to rewrite earlier words: the current application may already have moved.
5. Bind recording to the current attachment generation and recheck readiness
   before each paste. Do not buffer text for a future terminal reconnect.
6. Insert plain dictated text without submitting Enter. Normalize unintended
   newlines/tabs to spaces and remove control characters, including ESC. Preserve
   punctuation and spacing across spans; do not prepend a space to every event.

“Current cursor” means the terminal application's cursor when each span arrives,
as with Hex. A generic terminal cannot reserve an editable insertion position
while the user navigates elsewhere. Stop dictation before changing contexts.

## Implementation sequence

### 1. Prove local model reuse

- Add sibling `../dictation-server/` as a minimal Swift package pinned to FluidAudio
  0.15.5, with an explicit build/run script.
- Load the cached 1.1-second encoder, feed a known audio fixture in timed chunks,
  and record partials/final output. Confirm no asset re-download is necessary.
- Measure cold load, warm start, first word, final flush, memory, and use alongside
  Hex. The model's nominal 1.12-second tier is not an end-to-end latency promise.
- Verify reset isolates consecutive recordings and finish retains the last word.

### 2. Add the transport and lifecycle

- Implement the standalone service's HTTP health/status and WebSocket stream API.
- Add `src/dictation-service.ts` for process startup/prewarm, HTTP/WS connections,
  queue limits, errors, and teardown; `src/dictation-server.ts` handles browser
  routing and terminal recording ownership.
- Extend `src/server.ts` with status and dictation routes plus socket-kind dispatch.
- Keep the worker resident across recordings; reset after each. On worker crash,
  fail the current recording and allow a fresh worker for the next start.
- On Bun shutdown, close the worker; unsupported hosts report dictation unavailable.

### 3. Connect the mobile UI

- Add `src/dictation.ts`, `src/audio-worklet.ts`, and a transcript pipeline module.
- Update client build/static serving for the worklet asset.
- Update `src/mobile.ts`, `src/client.ts`, `src/connection.ts`, and minimal styles
  for icons, recording state, connection identity, and streaming paste.
- Document worker build, configuration, model cache, and phone workflow in README.

### 4. Verify end to end

- Focused tests for audio resampling continuity, WebSocket message ordering, decoder
  reset, prefix divergence, duplicate final callbacks, Unicode/spacing, final
  one-word flush, cancellation, busy handling, and queue limits.
- Run `bun run typecheck`, `bun run test`, and worker-specific build/tests.
- Real phone over Tailscale HTTPS: permission allow/deny, first/warm recording,
  short last word, long speech, silence, rapid start/stop, rotation, keyboard
  open/closed, screen lock, network interruption, and second-tab takeover.
- Verify insertion in a shell and a full-screen editor: no missing/duplicated
  words, no unexpected Enter, correct bracketed paste, no one-shot Ctrl effect,
  no focus-induced keyboard popup, and no text after attachment loss.

## Decisions for the first implementation

- Dedicated Bun endpoint plus a standalone Swift HTTP/WebSocket service in sibling
  `dictation-server/`, with Bun supervising its process by default.
- Existing English Parakeet Unified 1.1-second model and cache.
- Tap-to-toggle recording with live whole-word insertion and final-tail flush.
- One active remote recording; clear busy feedback for concurrent requests.
- Measure model reuse and latency first; then wire the phone toolbar.

References: [FluidAudio](https://github.com/FluidInference/FluidAudio),
[legacy Swift Hex](https://github.com/kitlangton/Hex). The local fork and its pinned
dependency are the primary implementation references for this machine.
