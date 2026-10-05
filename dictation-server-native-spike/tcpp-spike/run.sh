#!/usr/bin/env bash
# Run the transcribe.cpp spike. Defaults: F16 GGUF, fixture audio, CUDA. Extra args override.
# The prebuilt CUDA module needs libcudart.so.12 / libcublas.so.12; this box has them in
# /usr/local/cuda-12.3/lib64 (already on the system loader path).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
source "$here/../env.sh"
exec "$SPIKE_CACHE/tcpp-build/tcpp-spike" --libdir "$SPIKE_CACHE/tcpp/transcribe-native-linux-x86_64-cuda" \
  --model "$MODELS/gguf/parakeet-unified-en-0.6b-${QUANT:-F16}.gguf" --audio "$SPIKE_CACHE/audio/librispeech-sample.wav" "$@"
