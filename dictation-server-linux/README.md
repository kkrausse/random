# Dictation Server (Linux / NVIDIA)

The Linux port of [`../dictation-server`](../dictation-server/README.md): the same
loopback HTTP/WebSocket streaming transcription service and the same
[protocol v1](../dictation-server/docs/protocol.md), for an x86-64 Linux host
with an NVIDIA GPU. One small Python file (`server.py`) calls
[transcribe.cpp](https://github.com/handy-computer/transcribe.cpp) **0.3.1**
(ggml) through its C ABI with `ctypes`, on the **Vulkan** backend, with the F16
GGUF of [`parakeet-unified-en-0.6b`](https://huggingface.co/handy-computer/parakeet-unified-en-0.6b-gguf),
behind `websockets`. There is no PyTorch, CUDA or cuDNN: the host needs only the
NVIDIA driver and the system `libvulkan.so.1`.

Inference is the model's buffered streaming, as in NeMo's reference loop: each
new chunk is encoded together with 5.6 s of left context and its right context
under the model's chunked attention mask, only the chunk's encoder frames are
decoded, and the RNN-T decoder state carries over. Earlier audio is never
re-transcribed. The default context is (70, 7, 7) encoder frames, the same
1.12 s configuration as the Mac service.

Measured on an RTX 2080 Ti (driver 580), `scripts/measure.ts`:

| | |
| --- | --- |
| `run.sh` launch to model ready | 0.98–1.14 s (health answers after 0.1 s) |
| GPU memory | 1.2 GB |
| Process memory | 250 MB, 283 MB after a five-minute recording; flat over repeats |
| Inference per 560 ms chunk, audio arriving in real time | median 106 ms, worst 180 ms, the same in minute 4 as in minute 1 |
| Stop to final transcript | 0.1–0.35 s |

## Setup and run

```sh
curl -LsSf https://astral.sh/uv/install.sh | sh   # once, if uv is missing; no sudo
./setup.sh                                        # or: ./setup.sh /big/disk/dictation
./run.sh --port 9876
```

`setup.sh` puts everything large in `.cache/` (about 1.3 GB). Given a directory,
it makes `.cache` a symbolic link to it instead. It

1. downloads the release's 21 MB CPU+Vulkan tarball and the 1.2 GB weights and
   checks both against the SHA-256 digests upstream publishes (GitHub release
   asset digest, Hugging Face LFS object id), which are pinned in the script;
2. builds `.venv` from `uv.lock`: `websockets` on the system Python (3.12+);
3. transcribes the fixture once so the driver compiles its Vulkan pipelines
   (needs `ffmpeg`).

The third step matters. NVIDIA compiles Vulkan pipelines on first use and caches
them on disk. With an empty cache the service takes 2.9 s to load and the first
recording stalls for several seconds (13.7 s of audio took 7.2 s to transcribe
instead of 1.0 s). `run.sh` pins the cache to `.cache/shaders` with
`__GL_SHADER_DISK_CACHE_PATH`, so the directory `setup.sh` warmed is the one the
service uses whatever `XDG_CACHE_HOME` or `HOME` a systemd unit gives it. A
driver update invalidates the cache: rerun `./setup.sh` (it skips the downloads).

`run.sh` execs `.venv/bin/python server.py` directly. It needs no `uv` and no
particular `PATH`, so it works from a restricted systemd unit. The service only
loads local files; a missing library or weights file produces model state
`error` rather than downloading. Decoder state is reset between owners.
Finalization appends 400 ms of silence before flushing.

Options:

| Option | Default / meaning |
| --- | --- |
| `--host` | `127.0.0.1`; loopback addresses only |
| `--port` | `9876` |
| `--model-dir` | `.cache/models` here, holding `parakeet-unified-en-0.6b-F16.gguf`; accepts `~` |
| `--instance-id` | Generated UUID; supervisors supply and verify their own value |
| `--parent-pid` | Optional; exit if the parent disappears or changes |
| `--latency-ms` | `1120`, or `$DICTATION_LATENCY_MS`. `1120` or `2080` |
| `--idle-minutes` | `10`, or `$DICTATION_IDLE_MINUTES`. Exit after this long without a recording; `0` stays resident |

Latency is chunk plus right context. `/v1/status` reports what is running in
`modelId`, e.g. `parakeet-unified-en-0.6b-F16-transcribe.cpp-vulkan-streaming-1120ms`.
Only settings that keep the model's punctuation are offered. Its 480 ms and
320 ms settings keep the words but lose all punctuation and capitalisation on
the fixture, and transcribe.cpp rejects NeMo's 560 ms tuple (70, 2, 5) because
right context 5 is not in the model's training menu.

**Idle exit.** The process holds 1.2 GB of GPU memory for as long as it lives,
so it does not live long: after `--idle-minutes` with no recording open it stops
listening and exits with status 0. Starting again costs one second, and
`../bun-web-terminal` does that on the next mic tap. Run standalone, the process
simply ends; pass `--idle-minutes 0` to keep it.

Logs go to stderr (ggml prints a few lines about the device at start). Audio and
transcripts are not persisted or logged. One connection owns the decoder at a
time; a competing start receives `busy`. Disconnect/cancel drains the current
inference and resets before another recording may acquire it.

## Bun Web Terminal integration

On Linux `../bun-web-terminal` spawns `run.sh` as it spawns the Swift executable
on a Mac: on the first status or recording request, with its own instance ID and
parent PID, SIGTERM then SIGKILL on shutdown. Unlike the Mac service it is not
resident: when it exits idle, Bun starts a fresh one on the next request, with no
backoff (backoff applies to non-zero exits only). `DICTATION_EXECUTABLE`,
`DICTATION_PORT`, `DICTATION_MODEL_DIR`, and `DICTATION_URL` behave as
documented there; `DICTATION_LATENCY_MS` and `DICTATION_IDLE_MINUTES` are
inherited by the service from Bun's environment.

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

`bun scripts/measure.ts` starts its own service and prints the numbers above:
five cold starts, 20 consecutive recordings in one process, one 192 s real-time
recording with per-minute chunk times and memory before and after, and the idle
exit with GPU memory back at its baseline.

The managed lifecycle check in `../bun-web-terminal`
(`bun docs/verify-dictation-supervision.ts`) also runs against this service,
including the idle exit and a request that races with it.

## Why this runtime

The first version of this service ran the model in NeMo on PyTorch CUDA. It took
13 s to load, held 2.9 GB of GPU memory and needed a 6 GB venv, which ruled out
unloading when idle. A spike on the RTX 2080 Ti compared the alternatives at the
1120 ms setting (13.7 s fixture; transcripts compared with NeMo on four clips):

| Runtime, weights | Launch to ready | Per chunk, back to back | Per chunk, real time | GPU memory | Transcript vs NeMo |
| --- | ---: | ---: | ---: | ---: | --- |
| NeMo + PyTorch CUDA | 13.2–13.4 s | 28 ms | 34 ms | 2.9 GB | reference |
| transcribe.cpp, Vulkan, F16 (this service) | 0.96–1.13 s | 46 ms | ~100 ms | 1.2 GB | identical on 3, one word differs on the 4th |
| transcribe.cpp, Vulkan, Q8_0 | 0.65–0.71 s | 50 ms | ~107 ms | 0.74 GB | same as F16 |
| transcribe.cpp, CUDA, F16 | 0.90–0.95 s | 242 ms | 220 ms | 1.4 GB | identical on all 4 |
| ONNX Runtime 1.28 CUDA (parakeet-rs), fp32 | 2.46–2.67 s | 25 ms | 34 ms | 3.4 GB | identical on 1; punctuation differs on 2, words on 1 |
| same, fp16 encoder | 1.88–1.90 s | 17–19 ms | 22 ms | 2.4 GB | same as fp32 |
| ONNX Runtime CPU, fp32, 12 threads | 3.4–3.75 s | 340 ms | | none | not compared |
| transcribe.cpp, CPU, Q8_0 | 1.3 s | ~2 s | | none | not usable in real time |

What that table does not show:

- **transcribe.cpp is the only one that reproduces NeMo.** It applies the model's
  `chunked_limited_with_rc` attention mask. The third-party ONNX export
  (`bobNight/parakeet-unified-en-0.6b-onnx`) runs full attention inside each
  window, hence the differing punctuation and words. ONNX Runtime also needs
  2.6 GB of CUDA 13 and cuDNN 9 libraries. It is the fallback if per-chunk time
  ever matters more than start-up.
- **The Vulkan backend is slower per chunk when audio arrives in real time**
  (~105 ms, peaks to 180 ms) than back to back (46 ms). The cause was not found;
  the GPU clocking down between chunks is the suspect. It is far inside the
  560 ms chunk period.
- **Do not use transcribe.cpp's CUDA backend here.** Its output is correct but a
  chunk takes 242 ms and scales with CPU threads, so part of the encoder runs on
  the CPU. `TRANSCRIBE_NO_FLASH=1` brings it to 46 ms and makes the transcript
  empty. The prebuilt CUDA module also needs CUDA 12 libraries on the host.
- **Q8_0 weights** start in 0.7 s with 0.74 GB and gave the same four
  transcripts (upstream: 1.60 % vs 1.59 % offline WER). A possible next step;
  change `WEIGHTS` in `server.py` and the file and digest in `setup.sh`.
- **Pin the release.** The C ABI changes between releases (`main` already
  differs from v0.3.1), so `server.py` checks the library version and the size
  of every struct it passes. `pip install transcribe-cpp` currently resolves to
  an empty name-reservation package; use the GitHub release, as `setup.sh` does.
- ONNX Runtime details, should it be revisited: use
  `cudnn_conv_algo_search=HEURISTIC` (`DEFAULT` costs 290 ms per chunk); an fp16
  encoder needs on-disk shape inference before conversion and its own `Cast`
  nodes retargeted; each new window shape then costs ~105 ms once.

Where NeMo's 13–14 s went (warm disk, profiled before the switch): importing
NeMo 5.1 s (`lightning` 3.2 s and `torchmetrics` 2.1 s, pulled in even for
inference), importing PyTorch 1.0 s, building the model object ~4 s (2.6 s of it
random weight init that is immediately overwritten, the rest Hydra/OmegaConf),
reading the 2.4 GB fp32 checkpoint 1.2 s, copying to the GPU 0.9 s. Skipping the
init saved about 2 s; a pre-imported idle process was estimated at 4–5 s to
ready. Neither was pursued once the native runtimes measured ~1 s.

Not measured: word error rate on a test set, and start-up from a cold disk.
The spike's code and raw output are in git history under
`dictation-server-native-spike/` (commit `dcfa00e`).

## Notices

transcribe.cpp and ggml are MIT licensed; their notices are in the release
tarball's `licenses/` directory, which `setup.sh` keeps next to the libraries.
The model is under the [NVIDIA Open Model License](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license/)
(GGUF conversion by handy-computer) and is downloaded at setup, not
redistributed here. The fixture is the model card's sample from
[LibriSpeech](https://www.openslr.org/12) (CC BY 4.0). See also the
[Hex attribution](../dictation-server/THIRD_PARTY_NOTICES.md) for the lifecycle
and trailing-silence strategy this port inherits.
