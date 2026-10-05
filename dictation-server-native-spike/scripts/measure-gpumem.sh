#!/usr/bin/env bash
# GPU memory section of measure-all.sh, runnable on its own.
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
spike=$here/..
source "$spike/env.sh"
ort=$spike/ort-spike/run.sh
tcpp=$spike/tcpp-spike/run.sh
fp16=$MODELS/unified-onnx-fp16
printf '\n## GPU memory\n'
echo "# ort cuda fp32 heuristic";                  "$here/gpumem.sh" "$ort" --conv-search heuristic
echo "# ort cuda fp32 heuristic, max-workspace 0"; "$here/gpumem.sh" "$ort" --conv-search heuristic --max-workspace 0
echo "# ort cuda fp16 heuristic";                  "$here/gpumem.sh" "$ort" --conv-search heuristic --model-dir "$fp16"
echo "# tcpp vulkan F16";                          "$here/gpumem.sh" "$tcpp" --backend vulkan
echo "# tcpp vulkan Q8_0";                         QUANT=Q8_0 "$here/gpumem.sh" "$tcpp" --backend vulkan
echo "# tcpp cuda F16";                            "$here/gpumem.sh" "$tcpp" --backend cuda
