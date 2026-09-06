# Streaming dictation protocol v1

The local service binds to loopback HTTP. WebSocket framing is provided by Vapor
and WebSocketKit. Each WebSocket represents exactly one recording.

## HTTP

- `GET /healthz`: `{ "instanceId": "…", "version": "1", "status": "alive" }`.
  This is liveness, not model readiness. A supervisor must match its launch ID.
- `GET /v1/status`: `{ "version": 1, "state": "loading|ready|busy|error",
  "modelId": "parakeet-unified-en-0.6b-streaming-1120ms",
  "audio": { "sampleRate": 16000, "channels": 1, "format": "f32le" },
  "limits": { "frameBytes": 6400, "queueBytes": 128000, "seconds": 300 } }`.

## WebSocket `/v1/stream`

First send a text frame:

```json
{"type":"start","version":1,"recordingId":"2bb30c92-49f5-436f-a15e-389457f77ad8","sampleRate":16000,"channels":1,"format":"f32le"}
```

`recordingId` must be a UUID. Wait for `ready` before sending audio. A connection
may get `loading` first, and can cancel during loading. Every service event has
the recording ID and a strictly increasing `sequence` starting at zero:

```json
{"type":"loading","recordingId":"…","sequence":0}
{"type":"ready","recordingId":"…","sequence":1}
{"type":"partial","recordingId":"…","sequence":2,"text":"Hello"}
{"type":"partial","recordingId":"…","sequence":3,"text":"Hello world"}
```

Send binary frames of **16,000 Hz, mono, little-endian Float32** samples. Frames
must be nonempty, divisible by four, finite, and at most 6,400 bytes (100 ms).
Recommended packet size is 5,120 bytes (80 ms). Queued plus in-flight audio is
capped at 128,000 bytes (two seconds); a recording is limited to five minutes
of wall time and audio. Outgoing cumulative events have a bounded 256 KB queue.
Invalid state/format and overload terminate the connection rather than dropping
chunks and continuing.

After draining the capture worklet/resampler and sending the final binary frame:

```json
{"type":"stop","recordingId":"…"}
```

Prior audio is processed in order. The decoder finishes once and responds:

```json
{"type":"final","recordingId":"…","sequence":4,"text":"Hello world."}
{"type":"done","recordingId":"…","sequence":5}
```

No partials follow final. Decoder reset completes before done. The service closes
the connection after done. To abandon a recording, send
`{"type":"cancel","recordingId":"…"}` or close the connection. Pending text
is discarded, inference already in flight finishes, and reset precedes lending
the decoder again. No final/done is emitted for a canceled recording.

Errors are terminal:

```json
{"type":"error","recordingId":"…","sequence":2,"code":"busy","message":"busy"}
```

Codes include `busy`, `invalid_start`, `invalid_control`, `invalid_state`,
`invalid_audio`, `overload`, `duration_limit`, `inference_failed`, `reset_failed`,
and `unavailable`. Framing-level failures can instead close the WebSocket directly.
An invalid initial start can have an empty recording ID. A competing start cannot
replace the owner. A failed decoder reset leaves the service in error until restart.

Partials and final are **cumulative transcripts**, not deltas. Prefix stability
is not guaranteed by the API. Consumers must handle revisions and deduplicate
final output according to their insertion policy. Reconnection always means a
new recording; sequence numbers do not promise exactly-once terminal delivery.

## Bun browser boundary

Bun exposes `GET /api/dictation/status` and `WS /api/dictation/stream` under its
existing same-origin policy. Browser start also includes `sessionId` and
`attachmentId`; the latter is the UUID received in the terminal socket's `ready`
event. Bun verifies the current attachment, subscribes to its loss, and strips
both fields before forwarding start to Swift. Terminal bytes use the separate
terminal socket. Dictation events keep the service schema and order.

The browser status response includes `available`, `state`, `modelId`, `audio`, and
limits when the service is reachable. An unavailable service returns a generic
message and audio format, never a model path or transcript. Bun may add terminal
errors such as `attachment_lost`, `unavailable`, `protocol_error`, `invalid_input`,
`service_closed`, `service_error`, or `timeout` and closes the recording. It never
buffers transcripts for a new terminal attachment.
