#!/usr/bin/env bash
# Build the ONNX Runtime (parakeet-rs) spike binary. Output: $SPIKE_CACHE/target-ort/release/ort-spike
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
source "$here/../env.sh"
export CARGO_TARGET_DIR=$SPIKE_CACHE/target-ort
cd "$here"
cargo build --release "$@"
