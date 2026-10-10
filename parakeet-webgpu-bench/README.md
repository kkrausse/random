# Parakeet 0.6b on native WebGPU runtimes vs the dictation service

How fast does NVIDIA Parakeet 0.6b run through a native (non-browser) WebGPU runtime on diesel2
(RTX 2080 Ti, driver 580, 12 cores), compared with what `../dictation-server-linux` uses today
(transcribe.cpp 0.3.1, ggml, Vulkan)? Measured 2026-10-09. Benchmark code only.

Short answer: ONNX Runtime's WebGPU provider (Dawn on Vulkan) works and really runs on the GPU, at
40–100x real time depending on clip length. transcribe.cpp on Vulkan is 2–3x faster on the
encoder, is ready 2.5–3.5x sooner and is what the service already has. Burn on wgpu imports and runs the encoder
correctly but is 10x slower than ONNX Runtime WebGPU.

## Results

Same model everywhere unless noted: `parakeet-tdt-0.6b-v2`, as istupakov's ONNX export (fp32) and
handy-computer's GGUF. Same three clips, raw 16 kHz mono f32: the first 7.0 s of the service's
LibriSpeech fixture, the whole 13.7 s fixture, and transcribe.cpp's `product-names.wav` (56.1 s).
One discarded warm-up, then 10 runs; cells are **median / worst** in ms. "enc" is the encoder
alone, "total" is mel + encoder + decode for the whole clip.

| Runtime | 7.0 s enc | 7.0 s total | 13.7 s enc | 13.7 s total | 56.1 s enc | 56.1 s total | x real time, 56 s |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| ORT 1.28 WebGPU EP (Dawn/Vulkan), fp32 encoder, decoder on CPU | 71 / 75 | 174 / 189 | 91 / 98 | 221 / 266 | 265 / 270 | 671 / 781 | 84 |
| same, fp16 encoder | 58 / 105 | 144 / 176 | 66 / 69 | 157 / 172 | 208 / 211 | 557 / 713 | 101 |
| same, fp32, decoder on WebGPU too | 46 / 47 | 427 / 445 | 63 / 64 | 749 / 772 | 261 / 265 | 2862 / 2978 | 20 |
| ORT 1.28 CPU EP, fp32, 12 cores | 432 / 497 | 494 / 554 | 1006 / 1311 | 1173 / 1523 | 4890 / 5250 | 5473 / 6021 | 10 |
| Burn 0.22, `wgpu` feature, fp32, encoder only | 543 / 576 | | 824 / 838 | | 2751 / 2758 | | |
| Burn 0.22, `vulkan` feature (SPIR-V), fp32, encoder only | 474 / 481 | | 742 / 744 | | 2535 / 2573 | | |
| transcribe.cpp 0.3.1 Vulkan, TDT v2 F16 GGUF | 23 / 23 | 76 / 124 | 32 / 33 | 117 / 121 | 84 / 103 | 388 / 435 | 145 |
| transcribe.cpp 0.3.1 Vulkan, TDT v2 F32 GGUF | 37 / 40 | 89 / 93 | 34 / 34 | 120 / 126 | 84 / 84 | 381 / 513 | 147 |
| transcribe.cpp 0.3.1 Vulkan, unified F16 GGUF, offline (the service's weights) | 25 / 25 | 80 / 99 | 34 / 36 | 125 / 139 | 86 / 120 | 442 / 564 | 127 |

| Runtime | Process start to model loaded | First 7 s transcribe in the process (encoder part) | GPU memory after load / peak | RSS peak |
| --- | ---: | ---: | ---: | ---: |
| ORT WebGPU, fp32 | 4.4 s (encoder session 4.0 s) | 382 ms (282) | 2376 / 2721 MiB | 375 MiB |
| ORT WebGPU, fp16 | 3.1 s (2.8 s) | 531 ms (474) | 1196 / 1494 MiB | 383 MiB |
| ORT WebGPU, fp32, decoder on WebGPU | 4.0 s | 640 ms (184) | 2417 / 2938 MiB | 338 MiB |
| ORT CPU, fp32 | 3.2 s | 493 ms (436) | none | 2900 MiB |
| Burn `wgpu` | 4.4 s | encoder 1094 ms | 3867 / 4534 MiB | 526 MiB |
| Burn `vulkan` (SPIR-V) | 3.2 s | encoder 951 ms | 2489 / 2868 MiB | 532 MiB |
| transcribe.cpp Vulkan, TDT F16 | 1.2 s | 91 ms (38) | 1188 / 1209 MiB | 273 MiB |
| transcribe.cpp Vulkan, TDT F32 | 6.7 s | 110 ms (52) | 2366 / 2463 MiB | 278 MiB |
| transcribe.cpp Vulkan, unified F16 | 2.6 s | 92 ms (38) | 1190 / 1213 MiB | 272 MiB |

Peak is over all three clips; the 56 s clip sets it. Load times are from a warm page cache and
vary a lot with what else is reading the disk (the two F16 GGUF rows differ only by that).

**Cold start and the on-disk pipeline cache.** Process start to the first transcript of the 7 s
clip, with NVIDIA's shader cache (`__GL_SHADER_DISK_CACHE_PATH`) emptied first, then three more
processes that find it:

| Runtime | Empty cache | Next three processes |
| --- | ---: | ---: |
| ORT WebGPU fp32 | 4.9 s (first run 746 ms) | 4.5, 4.5, 4.8 s (first run 230–270 ms) |
| ORT WebGPU fp16 | 3.7 s (first run 845 ms) | 3.1, 3.5, 4.1 s (first run 360–660 ms) |
| transcribe.cpp Vulkan, TDT F16 | 8.2 s (first run 6.8 s) | 1.4, 1.3, 1.3 s (first run 86–91 ms) |

The driver cache matters much less to ONNX Runtime (0.5 s) than to ggml (7 s), but ONNX Runtime
pays 200–600 ms on the first inference of every process regardless (Dawn rebuilds its pipelines;
ORT has no pipeline cache of its own on disk), and session creation, not shaders, is its long pole.

**The service's unit of work** (unified F16, buffered streaming: 5.6 s left + 560 ms chunk +
560 ms right, a ~6.7 s window per chunk, only the chunk's frames decoded):

- `tcpp_bench.py --stream`, own process, chunks fed back to back, quiet machine: median 46 ms,
  worst 93 ms per full-window chunk on the 13.7 s clip (14 chunks x 10 runs); 45 ms median, 346 ms
  worst on the 56 s clip. This reproduces the 46 ms in the service's README.
- The live service on :9876, from a client (`scripts/live.ts`), machine moderately busy: 49 ms
  median per full-window chunk back to back on the 7 s clip; 86 ms median (worst 553) on the
  13.7 s clip, and 177–199 ms when paced in real time. See the caveat on load below.
- ONNX Runtime WebGPU was not run as a streaming loop. Its cost for the same unit would be mel
  (about 8 ms) + a 7 s encoder pass (46–71 ms fp32, 58 ms fp16) + decoding seven frames on the CPU
  (a few ms): an estimate of 60–85 ms per chunk against 46 ms measured for transcribe.cpp.

### What ran where

- **ORT WebGPU encoder**: 1512 nodes on `WebGpuExecutionProvider` (all MatMul 289, Conv 77,
  LayerNormalization 120, Softmax 24, Add, Mul, Transpose, Reshape, Where, Pad, Slice, ...), 495 on
  `CPUExecutionProvider`. The CPU ones are the shape arithmetic ORT keeps on the CPU on purpose
  (Unsqueeze 176, Gather 150, Concat 101, Slice 26, Squeeze 24 and a handful of others on shape
  tensors); they take about 5 ms per run in the profile. No silent fallback: the process holds
  2.4 GB of GPU memory in `nvidia-smi` and the encoder is 6–18x faster than the CPU provider.
  With the fp16 encoder: 1490 on WebGPU, 495 on CPU, 1.2 GB.
- **Decoder + joint** (26 nodes): all on CPU by default. Placed on WebGPU, all 26 run there and it
  is about 4x slower end to end (7 ms per token step instead of 1–2 ms), because greedy TDT
  decoding is one tiny session run and GPU read-back per token.
- **Mel front end** (`nemo128.onnx`, 35 nodes): CPU in every ORT row.
- **transcribe.cpp**: everything on `Vulkan0`, including the per-token decoder; mel on CPU.
- Encoder time on ORT WebGPU grows slowly with length (71 ms for 7 s, 265 ms for 56 s) and fp16
  barely helps: at short lengths it is bound by dispatching ~1500 kernels, not by GPU arithmetic.
  The fp32 encoder is also faster (46 vs 71 ms at 7 s) when the decoder keeps the GPU busy between
  encoder runs; cause not established (the same idle-GPU effect the service README notes).

### Transcripts

All TDT v2 rows (ORT WebGPU fp32 and fp16, ORT WebGPU decoder, ORT CPU, transcribe.cpp F16 and F32)
give byte-identical text on all three clips, stable across runs:

> going along slushy country roads and speaking to damp audiences in drafty schoolrooms day after day for a fortnight. He'll have to put in an appearance at some place of worship on Sunday morning, and he can come to us immediately afterwards.

> Welcome to QuirkQuidQuill Inc., where finance meets innovation. Explore diverse offerings from the P3 Quattro, a unique investment portfolio quadrant, to the O3 Omni, a platform for intricate derivative trading strategies. Delve into unconventional bond markets with our B3 Bond X and experience non-standard equity trading with E3 Equity. Personalize your wealth management with W3 RAPZ and anticipate market trends with the O2 Outlier, our forward-thinking financial forecasting tool. Explore venture capital world with U3Unifund or move your money with the M3 Mover, our sophisticated monetary transfer module. At QuirkQuidQuill Inc., we turn complex finance into creative solutions. Join us in redefining financial services.

The unified model (a different model, the one the service runs) says "draughty" for "drafty",
"Quirk Quid Quill Inc.", and offline drops the punctuation of the 13.7 s clip; streaming, it gives
the service's usual text. Burn's encoder output matches ORT CPU to 2e-4 absolute (values up to
0.8) on all three clips; it was not decoded to text.

### Not like for like, not measured, and failures

- **Machine load.** Other work (Rust and C++ builds, several Chrome instances) had 5–10 of the 12
  cores busy for most of the session. The tables above are from a pass taken while it was quiet
  (`results/machine-load.txt` has the CPU pressure at the start of each row, and the last line for a
  name is the run that is in `results/`; the tcpp rows are from 22:49–22:51, the ORT and Burn rows
  from 22:51–22:56). `bench.sh` runs the benchmarks in a
  high-weight systemd slice, which helps but does not isolate them. CPU-bound numbers (ORT CPU,
  decoder times, load times, worst cases) are the least reliable.
- **`scripts/measure.ts` of the service did not give usable numbers.** Run twice on a spare port
  (it starts its own instance, it does not touch :9876) while the machine was loaded: ready in
  1.5–2.2 s, 2.2–6.2 s wall per 13.7 s recording, then the 192 s real-time recording failed with
  `AssertionError: overload` both times. Output is in `results/service-measure.txt`. The service
  README's own figures (ready 1.0–1.1 s, 106 ms per chunk in real time) were taken on a quiet
  machine and were not reproduced here; the real-time figures from `live.ts` above are inflated by
  the same load.
- **Service vs ORT is two models.** The service runs `parakeet-unified-en-0.6b` with a chunked
  attention mask; the ORT and Burn rows are `parakeet-tdt-0.6b-v2`. Same 0.6b FastConformer encoder
  size; the transcribe.cpp TDT rows are the like-for-like comparison, and the unified offline row
  shows the two models cost the same in transcribe.cpp.
- **Precision.** ORT fp32 against GGUF F32 and ORT fp16 against GGUF F16 are the matched pairs. The
  fp16 ONNX is my conversion (`scripts/onnx-fp16.py`), not a published file.
- **transcribe.cpp stage times** (mel/encode/decode) are the library's own `transcribe_get_timings`;
  totals are wall time around `transcribe_run` including reading the text back. ORT and Burn times
  are wall time around calls that return CPU tensors.
- **ORT CUDA was not run** (needs 2.6 GB of CUDA 13 and cuDNN 9 libraries that are no longer on the
  box). The earlier spike measured it on the unified model: 25 ms per chunk fp32, 17–19 ms fp16,
  3.4 / 2.4 GB (`../dictation-server-linux/README.md`).
- **ORT WebGPU segfaults at process exit** (ORT 1.28 + Dawn teardown, after all results are
  printed; `Segmentation fault (core dumped)`, exit 139). `ort-bench` leaves through `_exit`.
- **Burn**: nothing blocked. `onnx2burn` imported all operators of the fp32 encoder (64 s, 2.5 GB
  `.bpk`), the generated code compiled, and the output is correct. It is simply slow: 474–543 ms
  for the 7 s window, 7–10x ORT WebGPU, with 2.5–3.9 GB of GPU memory. Both builds report the
  device fingerprint `spirv_4318_7687`, so I cannot confirm from the output that the `wgpu`-feature
  build used WGSL shaders; the two builds do differ in speed and memory. Encoder only: no mel
  front end or decoder was ported, and fp16 was not tried.
- Not measured: word error rate, a streaming loop on ORT WebGPU, cold-disk start, the WebGPU EP's
  options (graph capture, buffer cache modes, layout), wgpu directly without Burn.

## Layout

- `ort-bench/`: Rust, `ort` 2.0.0-rc.13 with the `webgpu` feature. Its prebuilt ONNX Runtime 1.28
  (static, plus `libwebgpu_dawn.so`) is downloaded at build time. Mel via the export's own
  `nemo128.onnx`, greedy TDT decode loop in `src/main.rs`.
- `burn-bench/`: Rust, Burn 0.22; includes the code `onnx2burn` generates into `cache/burn-gen/`.
- `scripts/tcpp_bench.py`: transcribe.cpp through ctypes, reusing `../dictation-server-linux/server.py`
  bindings and the libraries in that directory's `.cache` (read-only).
- `scripts/live.ts`: client timings against the running service. `scripts/placement.ts`: node
  placement from a verbose ORT log. `scripts/table.ts`: the tables above from `results/`.
- `cache` is a symlink to `~/devfs/cache/parakeet-webgpu-bench` (models, audio, build output; 15 GB).

## Rerun

```sh
cd parakeet-webgpu-bench
C=~/devfs/cache/parakeet-webgpu-bench; mkdir -p $C/onnx-tdt-v2 $C/gguf $C/audio; ln -sfn $C cache

# models
for f in config.json decoder_joint-model.onnx encoder-model.onnx encoder-model.onnx.data nemo128.onnx vocab.txt; do
  curl -L -o cache/onnx-tdt-v2/$f https://huggingface.co/istupakov/parakeet-tdt-0.6b-v2-onnx/resolve/main/$f; done
for q in F16 F32; do curl -L -o cache/gguf/parakeet-tdt-0.6b-v2-$q.gguf \
  https://huggingface.co/handy-computer/parakeet-tdt-0.6b-v2-gguf/resolve/main/parakeet-tdt-0.6b-v2-$q.gguf; done
uv run --no-project --python 3.12 --with onnx --with onnxconverter-common scripts/onnx-fp16.py cache/onnx-tdt-v2 cache/onnx-tdt-v2-fp16

# audio (product-names.wav is in transcribe.cpp v0.3.1's samples/)
F=../dictation-server-linux/fixtures/librispeech-sample.flac
ffmpeg -i $F -t 7 -f f32le -ar 16000 -ac 1 cache/audio/a07.f32
ffmpeg -i $F -f f32le -ar 16000 -ac 1 cache/audio/a14.f32
ffmpeg -i product-names.wav -f f32le -ar 16000 -ac 1 cache/audio/a56.f32

# build
(cd ort-bench && cargo build --release)
cargo install burn-onnx --version 0.22.0 --root cache/burn-tools
cache/burn-tools/bin/onnx2burn cache/onnx-tdt-v2/encoder-model.onnx cache/burn-gen
(cd burn-bench && cargo build --release && cp ../cache/target-burn/release/burn-bench ../cache/target-burn/release/burn-bench-wgsl \
  && cargo build --release --features vulkan && cp ../cache/target-burn/release/burn-bench ../cache/target-burn/release/burn-bench-spirv)

# everything, or named rows (names are the results/*.jsonl files)
./bench.sh
./bench.sh ort-webgpu-fp32 tcpp-vulkan-tdt-f16
bun scripts/table.ts

# single runs
cache/target-ort/release/ort-bench --model cache/onnx-tdt-v2 --enc-ep webgpu --dec-ep cpu --runs 10 cache/audio/a07.f32
cache/target-ort/release/ort-bench --model cache/onnx-tdt-v2 --enc-ep cpu --runs 10 cache/audio/a07.f32
python3 scripts/tcpp_bench.py cache/gguf/parakeet-tdt-0.6b-v2-F16.gguf --runs 10 cache/audio/a07.f32
python3 scripts/tcpp_bench.py ../dictation-server-linux/.cache/models/parakeet-unified-en-0.6b-F16.gguf --stream cache/audio/a14.f32
cache/target-burn/release/burn-bench-wgsl --backend wgpu cache/dump/a07      # after an ort-bench --dump cache/dump run; run-all.sh does it

# node placement
cache/target-ort/release/ort-bench --verbose --profile cache/logs/prof --runs 2 cache/audio/a07.f32 2> cache/logs/verbose.err
bun scripts/placement.ts cache/logs/verbose.err cache/logs/prof_*.json

# the service
bun scripts/live.ts http://127.0.0.1:9876 10 cache/audio/a07.f32 cache/audio/a14.f32
bun ../dictation-server-linux/scripts/measure.ts 19877
```

The dictation service was running the whole time (idle, 1.2 GB of GPU memory) and was not
restarted or reconfigured.
