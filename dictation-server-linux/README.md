# Dictation Server (Linux / NVIDIA)

The Linux port of [`../dictation-server`](../dictation-server/README.md): the same
loopback HTTP/WebSocket streaming transcription service and the same
[protocol v1](../dictation-server/docs/protocol.md), for an x86-64 Linux host
with an NVIDIA GPU. One small Python file (`server.py`) runs
[`nvidia/parakeet-unified-en-0.6b`](https://huggingface.co/nvidia/parakeet-unified-en-0.6b)
on CUDA with NeMo **3.0.0** and PyTorch **2.14.1+cu130**, behind `websockets`.
`uv.lock` pins the complete dependency graph; the PyTorch wheels bundle their own
CUDA libraries, so only the NVIDIA driver is needed on the host.

Inference is NeMo's reference buffered streaming for this model (the loop from
`examples/asr/asr_chunked_inference/rnnt/speech_to_text_streaming_infer_rnnt.py`,
run incrementally): each new chunk is encoded together with 5.6 s of left
context and its right context, only the chunk's encoder frames are decoded, and
the RNN-T decoder state carries over. Earlier audio is never re-transcribed.
The default context is (70, 7, 7) encoder frames, the same 1.12 s configuration
as the Mac service.

## Setup and run

```sh
curl -LsSf https://astral.sh/uv/install.sh | sh   # once, if uv is missing; no sudo
./setup.sh                                        # venv + model (~6 GB + ~2.4 GB)
./run.sh --port 9876
```

`setup.sh` creates `.venv` from the lockfile with a uv-managed Python 3.12, then
downloads the model's `.nemo` checkpoint from Hugging Face and extracts it into
`.cache/models/parakeet-unified-en-0.6b/` (`model_config.yaml`,
`model_weights.ckpt`, tokenizer files). Pass another directory as its argument
to keep the model elsewhere, and either symlink it to the default path or run the
service with `--model-dir`. Set `UV_CACHE_DIR` and `UV_PYTHON_INSTALL_DIR` first
if `~/.cache` and `~/.local/share` are on a small disk.

`run.sh` execs `.venv/bin/python server.py` directly. It needs no `uv` and no
particular `PATH`, so it works from a restricted systemd unit. The service
only loads local files; a missing model directory produces model state `error`
rather than downloading. Models stay loaded across recordings and decoder state
is reset between owners. Finalization appends 400 ms of silence before flushing.

Options:

| Option | Default / meaning |
| --- | --- |
| `--host` | `127.0.0.1`; loopback addresses only |
| `--port` | `9876` |
| `--model-dir` | `.cache/models/parakeet-unified-en-0.6b` here; accepts `~` |
| `--instance-id` | Generated UUID; supervisors supply and verify their own value |
| `--parent-pid` | Optional; exit if the parent disappears or changes |
| `--latency-ms` | `1120`, or `$DICTATION_LATENCY_MS`. One of the model card's settings: `2080`, `1120`, `560`, `320`, `240`, `160` |

Latency is chunk plus right context. `/v1/status` reports the running setting in
`modelId`, e.g. `parakeet-unified-en-0.6b-streaming-1120ms`. Every setting runs
far faster than real time on an RTX 2080 Ti (about 28 ms per chunk), so lower
values only cost accuracy: on the verification sample `560` gave the same words
as `1120` but dropped a period and a comma, which is why `1120` is the default.

Health is available within a second of launch, while PyTorch and the model are
still loading (about 13 s). Logs go to stderr. Audio and transcripts are not
persisted or logged. One connection owns the decoder at a time; a competing
start receives `busy`. Disconnect/cancel drains the current inference and resets
before another recording may acquire it. The process uses about 2.9 GB of GPU
memory.

## Bun Web Terminal integration

On Linux `../bun-web-terminal` spawns `run.sh` exactly as it spawns the Swift
executable on a Mac: on the first status or recording request, with its own
instance ID and parent PID, kept resident, SIGTERM then SIGKILL on shutdown.
`DICTATION_EXECUTABLE`, `DICTATION_PORT`, `DICTATION_MODEL_DIR`, and
`DICTATION_URL` behave as documented there; `DICTATION_LATENCY_MS` is inherited
by the service.

## Verification

```sh
./run.sh --port 19876
# In another terminal:
bun scripts/verify.ts http://127.0.0.1:19876
```

The check streams a real 13.7 s LibriSpeech utterance
(`fixtures/librispeech-sample.flac`, decoded with `ffmpeg`) in 80 ms Float32
chunks in real time and verifies incremental partials, acknowledgments,
final-tail retention, ordering, busy handling, consecutive-recording isolation,
cancellation, invalid audio, queue overload, and that a second pass reproduces
the transcript. It needs the real model and GPU.

The managed lifecycle check in `../bun-web-terminal`
(`bun docs/verify-dictation-supervision.ts`) also runs against this service.

## Notices

The model is under the [NVIDIA Open Model License](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license/)
and is downloaded at setup, not redistributed here. The fixture is the model
card's sample from [LibriSpeech](https://www.openslr.org/12) (CC BY 4.0). See
also the [Hex attribution](../dictation-server/THIRD_PARTY_NOTICES.md) for the
lifecycle and trailing-silence strategy this port inherits.
