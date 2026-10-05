#!/usr/bin/env bash
# Run the ONNX Runtime spike binary with the pip-bundled CUDA 13 / cuDNN 9 libs on the loader path.
# usage: run.sh [ort-spike args...]   (defaults: --model-dir $MODELS/unified-onnx --audio fixture)
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
source "$here/../env.sh"
export LD_LIBRARY_PATH=$NV_LIBS${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}
exec "$SPIKE_CACHE/target-ort/release/ort-spike" --model-dir "$MODELS/unified-onnx" --audio "$SPIKE_CACHE/audio/librispeech-sample.wav" "$@"
