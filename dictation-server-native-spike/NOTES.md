# Native runtime spike: parakeet-unified-en-0.6b streaming without Python

Question: can a native runtime run `nvidia/parakeet-unified-en-0.6b` in buffered streaming mode on
this box's GPU with a much faster cold start than `../dictation-server-linux/server.py` (~13 s)?

Answer: yes. Both candidates work on the RTX 2080 Ti. Measured 2026-10-05, raw output in
`results/2026-10-05-rtx2080ti.txt`.

| Runtime, weights | Launch → ready (warm disk) | Per chunk, back to back | Per chunk, real-time paced | GPU memory | Transcript vs NeMo (4 clips) |
| --- | ---: | ---: | ---: | ---: | --- |
| Python NeMo (today) | 13.2–13.4 s | 28 ms | 34 ms | ~2.9 GB | reference |
| transcribe.cpp 0.3.1, Vulkan, F16 GGUF | 0.96–1.13 s | 46 ms | ~100 ms (max 160–205) | 1.2 GB | identical on 3, one word differs on the 4th |
| transcribe.cpp 0.3.1, Vulkan, Q8_0 GGUF | 0.65–0.71 s (4 of 5 runs) | 50 ms | ~107 ms | 0.74 GB | same as F16 |
| transcribe.cpp 0.3.1, CUDA, F16 GGUF | 0.90–0.95 s | 242 ms | 220 ms | 1.4 GB | identical on all 4 |
| ONNX Runtime 1.28 CUDA (parakeet-rs), fp32 | 2.46–2.67 s | 25 ms | 34 ms | 3.4 GB | identical on 1, punctuation differs on 2, words differ on 1 |
| same, pre-optimised graph | 2.15–2.30 s | 26 ms | not run | 3.4 GB | same as fp32 |
| same, fp16 encoder | 1.88–1.90 s | 17–19 ms (new window shape: ~105 ms) | 22 ms | 2.4 GB | same as fp32 |
| ONNX Runtime CPU, fp32, 12 threads | 3.4–3.75 s | 340 ms | not run | none (2.6 GB RSS) | not compared |
| ONNX Runtime CPU, int8, 12 threads | 2.7 s (1 run) | 265 ms | not run | none (0.85 GB RSS) | "drafty" for "draughty" on the fixture |
| transcribe.cpp CPU (prebuilt module), Q8_0 | 1.3 s (1 run) | ~2 s | not run | none | not usable in real time |

"Ready" = model loaded and the first `[chunk | right]` window of silence transcribed, measured from
just before `exec()` with `/proc/uptime` (5 runs; CPU rows 1–3 runs). The first Q8_0 Vulkan run took
2.1 s: first use of those weights, so cold file and uncached pipelines. All at the 1120 ms config
(70, 7, 7), fed in 100 ms pieces. Chunk time is the median over the 13.7 s fixture.

## Recommendation

Build the real server on **transcribe.cpp with the Vulkan backend and the F16 GGUF**.

- About 1 s cold start, 13x faster than today and 2x faster than the best ONNX Runtime setup.
- It is the only candidate that reproduces NeMo's output: it applies the model's
  `chunked_limited_with_rc` attention mask, and upstream documents WER parity with NeMo's reference
  streaming loop. The ONNX export has no such mask (see below).
- Smallest footprint: 1.2 GB of GPU memory, and no CUDA or cuDNN libraries at all. Vulkan only needs
  the system `libvulkan.so.1` and the NVIDIA driver's ICD, both already present. The CPU+Vulkan
  release tarball is 21 MB.
- The C ABI is a real streaming API: `transcribe_stream_begin / feed / finalize / reset`, cumulative
  text after every feed, a `result_changed` flag. It maps one to one onto the WebSocket protocol.

Costs to accept:

- Per-chunk time is worse than Python when audio arrives in real time: about 100 ms, peaks to
  200 ms, against 34 ms. Back to back it is 46 ms. I did not find the cause (GPU clocking down
  between chunks is the obvious suspect; ONNX Runtime CUDA only goes 25 → 34 ms). It is still far
  inside the 560 ms chunk period, so partials arrive ~70 ms later than today.
- Vulkan pipelines are compiled on first use and cached by the NVIDIA driver in
  `$XDG_CACHE_HOME/nvidia/GLCache` (~1 MB). With an empty cache the first start takes 2.8 s and the
  first recording stalls once for 3.7 s and twice for ~0.8 s. The service needs a writable,
  persistent cache directory, and setup should run one throwaway stream to fill it. A driver
  update empties it.
- The 560 ms setting `(70, 2, 5)` that `server.py` offers is rejected (`invalid argument`): right
  context 5 is not in the model's training menu. The nearest are 480 ms `(70, 2, 4)` and 320 ms.
  At both, the fixture keeps its words and loses all punctuation and the capital in "He'll".
- Young project: v0.3.1 was released 2026-10-04 and `main` already has a different ABI hash and a
  `migrating-to-0.4.md`. Pin the release.

Q8_0 gets cold start down to ~0.7 s with 0.74 GB and gave the same four transcripts. Upstream
reports 1.60 % vs 1.59 % offline WER. It is a reasonable second step, not needed to meet the goal.

ONNX Runtime is the fallback if the real-time chunk latency turns out to matter: fastest inference,
but 2–2.5 s cold start, 2–3x the GPU memory, ~2.6 GB of CUDA 13 + cuDNN 9 libraries to ship, and
output that is not NeMo's.

Staying on Python with the import fixes (expected 3–4 s) is beaten by both.

## What was not verified

- No WER run. Transcript comparison is four clips (fixture, `jfk`, `dots`, `product-names` from
  transcribe.cpp's `samples/`).
- The Rust crate `transcribe-cpp` was read, not built. It compiles the C++ tree with CMake; its
  `vulkan` feature needs Vulkan headers and `glslc`, which are not installed here. Linking the
  prebuilt `libtranscribe.so` directly (as `tcpp-spike/main.c` does, ~12 functions) is what was
  tested.
- Cold-disk start was not measured.
- Cause of the real-time-paced slowdown on Vulkan.
- ONNX Runtime IO binding and CUDA graphs were not tried (window shapes change, which rules out
  CUDA graphs; the encoder output copy is small).
- Long recordings (minutes) and repeated record/reset cycles in one process.

## Candidate 1: ONNX Runtime via parakeet-rs (`ort-spike/`)

- `parakeet-rs` 0.3.8, `ort` 2.0.0-rc.13, which downloads a prebuilt static ONNX Runtime 1.28 with
  the CUDA 13 provider (`libonnxruntime_providers_cuda.so`, 79 MB, must sit next to the binary).
  Binary is 31 MB. Needs Rust >= 1.85 (edition 2024); `rustup` already had 1.95.
- `default-features = false` and ort's `tls-rustls` are required: the default pulls `native-tls`,
  which fails without `libssl-dev`.
- CUDA 13 and cuDNN 9 come from the Python server's venv
  (`.venv/lib/python3.12/site-packages/nvidia/{cu13,cudnn}/lib`, 2.6 GB) via `LD_LIBRARY_PATH`.
- Model: `bobNight/parakeet-unified-en-0.6b-onnx` on Hugging Face, a third-party export
  (2.5 GB fp32; int8 variant also there).
- API: `ParakeetUnified::transcribe_chunk(&[f32])`, `get_transcript()` (cumulative), `flush()`,
  `reset()`. Incremental, with decoder state carried across chunks. Any `(chunk, right)` multiple
  of 80 ms is accepted, including `(2, 5)`.
- Fidelity: the model config's default `att_context_size` is `[-1, -1]`, so the export runs full
  attention inside each `[left | chunk | right]` window instead of the chunked mask NeMo applies
  after `set_default_att_context_size`. Against NeMo: `jfk` identical; the fixture gains a trailing
  period; `dots` has `whatever, because` for `whatever. Because`; `product-names` has
  `Quirk Quid Quill Inc.` for `Quirk, Quid, Quill, Inc.`, `experienced` for `experience`,
  `outlier are` for `outlier, our` and a trailing period.

Cold start breakdown (fp32): encoder session 2.1 s, decoder session 0.06 s, first window 0.28 s.

Tricks tried:

| Setting | Effect |
| --- | --- |
| `cudnn_conv_algo_search = DEFAULT` | 290 ms per chunk. Conv takes 89 % of encoder time. Never use. |
| `HEURISTIC` | 25 ms per chunk, ~42 ms the first time each window shape is seen. |
| `EXHAUSTIVE` (ORT's and parakeet-rs's default) | Same as heuristic here, within noise. |
| `cudnn_conv1d_pad_to_nc1d = 1` | No gain; first window slower (440 vs 283 ms). |
| `prefer_nhwc = 1` | Slower: 31 ms per chunk, first window 516 ms. |
| `cudnn_conv_use_max_workspace = 0` | No change in memory (3418 MiB) or speed. |
| Graph optimisation level 0 / 1 / 2 / 3 | Session time 2.3 / 2.2 / 2.1 / 2.1 s. Level 0 costs 4 ms per chunk. |
| Save optimised graph, load it at level 0 | Encoder session 2.1 → 1.85 s. Writes a second 2.4 GB weights file. |
| fp16 encoder (`scripts/onnx-fp16.py`) | Encoder session 2.1 → 1.3 s, 17 ms per chunk, 2.4 GB GPU. Each new window shape costs ~105 ms (first 10 chunks of a recording), first window 550 ms. Same transcripts as fp32. |
| Decoder session on CPU | Slower: 32 vs 26 ms per chunk. |

fp16 conversion needs two fixes over stock `onnxconverter-common`: on-disk shape inference first
(the model is over 2 GB), then retargeting the graph's own eight `Cast(to=FLOAT)` nodes.

## Candidate 2: transcribe.cpp (`tcpp-spike/`)

- No build of ggml needed. The v0.3.1 GitHub release has
  `transcribe-native-0.3.1-linux-x86_64-cuda.tar.gz` (201 MB) with `libtranscribe.so` (2.2 MB),
  `libggml-vulkan.so` (43 MB), `libggml-cuda.so` (205 MB), `libggml-cpu.so`. A
  `linux-x86_64-cpu-vulkan` tarball (21 MB) exists for a Vulkan-only deploy; not tested, the Vulkan
  module used here came from the CUDA tarball.
- `tcpp-spike/main.c` is 230 lines against `include/transcribe.h` at tag `v0.3.1`. The header must
  match the release (`contract.json` carries the header hash).
- Models: `handy-computer/parakeet-unified-en-0.6b-gguf` (F32 2.5 GB, F16 1.2 GB, Q8_0 731 MB).
- Cold start breakdown (Vulkan, F16): loaded at ~0.9 s (backend init ~0.15 s, the rest is the model),
  first window 0.03 s.
  F32 loads in 1.5–2.8 s, so F16 is the right default.
- The CUDA module is linked against CUDA 12 (`libcudart.so.12`, `libcublas.so.12`). They resolved
  from `/usr/local/cuda-12.3/lib64`, which exists on this box (with `nvcc`, not on `PATH`).
- CUDA backend: correct output but 242 ms per chunk, and it scales with CPU threads (538 ms with one
  thread), so part of the encoder runs on the CPU. `TRANSCRIBE_NO_FLASH=1` makes it 46 ms per chunk
  and returns an **empty transcript** on F16, F32 and Q8_0. Do not use it on CUDA. On Vulkan
  the same variable gives the correct transcript at the same 45 ms.
- `TRANSCRIBE_CONV_*` overrides: no effect on CUDA (205–225 ms).
- The prebuilt CPU module is a conservative build; ~2 s per chunk.

## Not looked at

mudler/parakeet.cpp, CrispASR, sherpa-onnx: both primary candidates worked.

## Reproduce

Everything heavy lives under `~/devfs/cache/native-spike` (`env.sh`). About 11 GB of models.

```sh
cd dictation-server-native-spike
source env.sh

# models
mkdir -p $MODELS/unified-onnx $MODELS/gguf
for f in encoder.onnx encoder.onnx.data decoder_joint.onnx tokenizer.model; do
  curl -L -o $MODELS/unified-onnx/$f https://huggingface.co/bobNight/parakeet-unified-en-0.6b-onnx/resolve/main/$f; done
for q in F16 Q8_0 F32; do
  curl -L -o $MODELS/gguf/parakeet-unified-en-0.6b-$q.gguf \
    https://huggingface.co/handy-computer/parakeet-unified-en-0.6b-gguf/resolve/main/parakeet-unified-en-0.6b-$q.gguf; done

# audio: the fixture as 16 kHz wav, plus clips from transcribe.cpp's samples/
mkdir -p $SPIKE_CACHE/audio
ffmpeg -i ../dictation-server-linux/fixtures/librispeech-sample.flac -ar 16000 -ac 1 -c:a pcm_s16le $SPIKE_CACHE/audio/librispeech-sample.wav

ort-spike/build.sh        # cargo build, downloads ONNX Runtime
tcpp-spike/build.sh       # downloads the release + headers, gcc
cp $SPIKE_CACHE/src/transcribe.cpp-v0.3.1/samples/{jfk,dots,product-names}.wav $SPIKE_CACHE/audio/

# derived ONNX models
mkdir -p $MODELS/unified-onnx-opt
ort-spike/run.sh --quiet --conv-search heuristic --save-optimized $MODELS/unified-onnx-opt
ln -s $MODELS/unified-onnx/{decoder_joint.onnx,tokenizer.model} $MODELS/unified-onnx-opt/
uv venv --python 3.12 $SPIKE_CACHE/venv && uv pip install --python $SPIKE_CACHE/venv/bin/python onnx onnxconverter-common
$SPIKE_CACHE/venv/bin/python scripts/onnx-fp16.py $MODELS/unified-onnx $MODELS/unified-onnx-fp16

# single runs
ort-spike/run.sh --conv-search heuristic              # prints partials, final, timings
tcpp-spike/run.sh --backend vulkan                    # QUANT=Q8_0 to switch weights
ort-spike/sweep.sh "--conv-search default" "--conv-search heuristic --nhwc 1"
tcpp-spike/envsweep.sh
SPIKE_PROFILE=/tmp/prof ort-spike/run.sh --quiet && python3 scripts/profile-summary.py /tmp/prof-encoder_*.json

# everything in the table
scripts/measure-all.sh > results/run.txt 2>&1
scripts/measure-gpumem.sh                             # the GPU memory section on its own
```

Do not `pip install "transcribe-cpp[cu12]"` as the upstream README says: here uv resolved that to
the 0.0.0 name-reservation placeholder, which has no native code. Use the GitHub release.
