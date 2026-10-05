#!/usr/bin/env bash
# Reproduce every number in NOTES.md. Takes a few minutes. usage: measure-all.sh > results/run.txt
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
spike=$here/..
source "$spike/env.sh"
ort=$spike/ort-spike/run.sh
tcpp=$spike/tcpp-spike/run.sh
fp16=$MODELS/unified-onnx-fp16
opt=$MODELS/unified-onnx-opt
audio=$SPIKE_CACHE/audio
nemo_python=$HOME/devfs/repos/kkrausse/random/dictation-server-linux/.venv/bin/python
nemo_model=$HOME/devfs/cache/dictation-models/parakeet-unified-en-0.6b

section() { printf '\n## %s\n' "$*"; }
headline() { grep -E '^(error|chunks|chunk_first_ms|chunk_median_ms|chunk_max_ms|second_pass_chunk_median_ms|second_pass_chunk_max_ms|finish_ms|VmHWM|chunk_times_ms)' | tr '\n' ' '; echo; }

section "cold start, 5 runs each (launch -> first window transcribed, warm disk)"
echo "# ort cuda fp32, cudnn heuristic";            "$here/coldstart.sh" 5 "$ort" --conv-search heuristic
echo "# ort cuda fp32, pre-optimised graph, opt 0"; "$here/coldstart.sh" 5 "$ort" --conv-search heuristic --opt-level 0 --model-dir "$opt"
echo "# ort cuda fp16 encoder, cudnn heuristic";    "$here/coldstart.sh" 5 "$ort" --conv-search heuristic --model-dir "$fp16"
echo "# ort cpu fp32, 12 threads";                  "$here/coldstart.sh" 3 "$ort" --provider cpu --threads 12
echo "# transcribe.cpp vulkan F16";                 "$here/coldstart.sh" 5 "$tcpp" --backend vulkan
echo "# transcribe.cpp vulkan Q8_0";                QUANT=Q8_0 "$here/coldstart.sh" 5 "$tcpp" --backend vulkan
echo "# transcribe.cpp vulkan F32";                 QUANT=F32 "$here/coldstart.sh" 3 "$tcpp" --backend vulkan
echo "# transcribe.cpp cuda F16";                   "$here/coldstart.sh" 5 "$tcpp" --backend cuda
echo "# transcribe.cpp cpu Q8_0 (prebuilt 'conservative' cpu module)"; QUANT=Q8_0 "$here/coldstart.sh" 1 "$tcpp" --backend cpu

section "per-chunk streaming time, 1120 ms config (70,7,7), 100 ms feeds, back to back"
echo "# ort cuda fp32 heuristic";  "$ort" --quiet --conv-search heuristic | headline
echo "# ort cuda fp16 heuristic";  "$ort" --quiet --conv-search heuristic --model-dir "$fp16" | headline
echo "# ort cpu fp32 12 threads";  "$ort" --quiet --provider cpu --threads 12 | headline
echo "# tcpp vulkan F16";          "$tcpp" --quiet --backend vulkan 2>/dev/null | headline
echo "# tcpp vulkan Q8_0";         QUANT=Q8_0 "$tcpp" --quiet --backend vulkan 2>/dev/null | headline
echo "# tcpp cuda F16";            "$tcpp" --quiet --backend cuda 2>/dev/null | headline

section "same, paced in real time (GPU idles between chunks, as in real dictation)"
echo "# ort cuda fp32 heuristic";  "$ort" --quiet --realtime --conv-search heuristic | headline
echo "# ort cuda fp16 heuristic";  "$ort" --quiet --realtime --conv-search heuristic --model-dir "$fp16" | headline
echo "# tcpp vulkan F16";          "$tcpp" --quiet --realtime --backend vulkan 2>/dev/null | headline

section "low-latency configs"
echo "# ort cuda fp32 (70,2,5) = 560 ms"; "$ort" --quiet --conv-search heuristic --chunk-frames 2 --right-frames 5 | grep -E '^(final|chunk_median_ms|chunk_max_ms)'
echo "# tcpp vulkan F16 (70,2,5) = 560 ms"; "$tcpp" --quiet --backend vulkan --chunk-ms 160 --right-ms 400 2>&1 | grep -E '^(error|final|chunk_median_ms|chunk_max_ms)'
echo "# tcpp vulkan F16 (70,2,4) = 480 ms"; "$tcpp" --quiet --backend vulkan --chunk-ms 160 --right-ms 320 2>/dev/null | grep -E '^(error|final|chunk_median_ms|chunk_max_ms)'
echo "# tcpp vulkan F16 (70,2,2) = 320 ms"; "$tcpp" --quiet --backend vulkan --chunk-ms 160 --right-ms 160 2>/dev/null | grep -E '^(error|final|chunk_median_ms|chunk_max_ms)'

section "transcripts at 1120 ms"
for clip in librispeech-sample jfk dots product-names; do
  echo "# $clip"
  echo "ort-fp32   $("$ort" --quiet --conv-search heuristic --audio "$audio/$clip.wav" | grep '^final=')"
  echo "ort-fp16   $("$ort" --quiet --conv-search heuristic --model-dir "$fp16" --audio "$audio/$clip.wav" | grep '^final=')"
  echo "tcpp-vk    $("$tcpp" --quiet --backend vulkan --audio "$audio/$clip.wav" 2>/dev/null | grep '^final=')"
  echo "tcpp-vk-q8 $(QUANT=Q8_0 "$tcpp" --quiet --backend vulkan --audio "$audio/$clip.wav" 2>/dev/null | grep '^final=')"
  echo "tcpp-cuda  $("$tcpp" --quiet --backend cuda --audio "$audio/$clip.wav" 2>/dev/null | grep '^final=')"
done
echo "# NeMo (current server engine)"
"$nemo_python" "$here/nemo-reference.py" "$nemo_model" 1120 "$audio"/{librispeech-sample,jfk,dots,product-names}.wav 2>/dev/null | grep -E '^(ready_at_ms|file|final|chunks)'

section "GPU memory"
echo "# ort cuda fp32 heuristic";                 "$here/gpumem.sh" "$ort" --conv-search heuristic
echo "# ort cuda fp32 heuristic, max-workspace 0"; "$here/gpumem.sh" "$ort" --conv-search heuristic --max-workspace 0
echo "# ort cuda fp16 heuristic";                 "$here/gpumem.sh" "$ort" --conv-search heuristic --model-dir "$fp16"
echo "# tcpp vulkan F16";                         "$here/gpumem.sh" "$tcpp" --backend vulkan
echo "# tcpp vulkan Q8_0";                        QUANT=Q8_0 "$here/gpumem.sh" "$tcpp" --backend vulkan
echo "# tcpp cuda F16";                           "$here/gpumem.sh" "$tcpp" --backend cuda
