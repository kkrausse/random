# Dictation Server

A standalone, loopback HTTP/WebSocket streaming transcription service for Apple
Silicon macOS 14+. Swift 6 builds a resident FluidAudio **0.15.5** decoder behind
Vapor **4.110.1**. Transcripts are cumulative; applications choose their own text
insertion policy. No desktop microphone, clipboard, terminal, or Hex process API
is involved.

## Build and run

```sh
./build.sh
./run.sh --port 9876
```

The scripts build/run `.build/release/dictation-server`. `Package.resolved` locks
the complete dependency graph. Build requires the macOS SDK and Swift 6 toolchain
(verified with Xcode 16.2 / Swift 6.0.3). Runtime never invokes SwiftPM.

The model directory defaults to:

```text
~/Library/Application Support/FluidAudio/Models/parakeet-unified-en-0.6b/
```

It must already contain:

- `parakeet_unified_encoder_streaming_70_7_7_int8.mlmodelc`
- `parakeet_unified_decoder.mlmodelc`
- `parakeet_unified_joint_decision_single_step.mlmodelc`
- `vocab.json` (the existing cache also contains `config.json` and `metadata.json`)

Select/download the English 1.1-second streaming model in the local Swift Hex
installation first, or provision these assets separately. The service calls
`loadModels(from:)`, which loads only local files; a missing cache produces model
state `error` rather than downloading. The encoder uses context `(70, 7, 7)` and
CPU/ANE, matching the working Hex configuration. Models stay loaded across
recordings and are reset between owners. Finalization disables partial callbacks
and appends 400 ms silence before flushing.

Options:

| Option | Default / meaning |
| --- | --- |
| `--host` | `127.0.0.1`; loopback addresses only |
| `--port` | `9876` |
| `--model-dir` | Cache directory above; accepts `~` |
| `--instance-id` | Generated UUID; supervisors supply and verify their own value |
| `--parent-pid` | Optional; exit if the parent disappears or changes |

Health is available during model loading. Logs go to stderr. Audio/transcripts
are not persisted or logged by the service. One connection owns the decoder at a
time; a competing start receives `busy`. Disconnect/cancel drains the current
inference and resets before another recording may acquire it.

## Bun Web Terminal integration

By default `../bun-web-terminal` spawns the release executable on first status or
recording request, verifies its instance ID, and keeps it resident. It sends
SIGTERM on shutdown, then SIGKILL after a two-second grace period. A managed
parent watchdog also handles abrupt Bun death. Worker crashes end the recording;
fresh requests restart with bounded backoff and never replay audio.

To reuse a service you run yourself:

```sh
./run.sh --port 9876
# In bun-web-terminal:
DICTATION_URL=http://127.0.0.1:9876 bun start
```

In externally managed mode Bun neither spawns nor terminates the service. Phones
connect to Bun through the existing Tailscale HTTPS origin; there is no additional
Tailscale route or publicly exposed Swift port.

## Verification

```sh
swift test -c release
./run.sh --port 19876
# In another terminal, with Bun installed:
bun scripts/verify.ts http://127.0.0.1:19876
```

The integration check generates a temporary WAV using macOS `say`, feeds 80 ms
Float32 chunks in real time, and verifies final-tail retention, ordering, busy
handling, consecutive-recording isolation, cancellation, invalid audio, and queue
overload. It deletes the fixture afterward. It requires the cached real model.

See [protocol](docs/protocol.md), [verification results](../bun-web-terminal/docs/mobile-dictation-verification.md),
and [Hex attribution](THIRD_PARTY_NOTICES.md). Model/library licenses remain those
of their respective upstream projects.
