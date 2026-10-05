#!/bin/sh
# One-time setup: locked Python 3.12 venv plus the extracted model checkpoint.
# Usage: ./setup.sh [model-dir]   (default .cache/models/parakeet-unified-en-0.6b)
set -eu
cd "$(dirname "$0")"
PATH="$HOME/.local/bin:$PATH"
command -v uv >/dev/null || { echo "uv not found; install: curl -LsSf https://astral.sh/uv/install.sh | sh" >&2; exit 1; }
uv sync --frozen --python 3.12

model="${1:-.cache/models/parakeet-unified-en-0.6b}"
if [ -f "$model/model_weights.ckpt" ] && [ -f "$model/model_config.yaml" ]; then
  echo "Model already present in $model"
  exit 0
fi
mkdir -p "$model"
# Keep Hugging Face's own download cache inside this project unless told otherwise.
export HF_HOME="${HF_HOME:-$PWD/.cache/huggingface}"
.venv/bin/hf download nvidia/parakeet-unified-en-0.6b parakeet-unified-en-0.6b.nemo --local-dir "$model"
# A .nemo file is a tar archive. Extract once so startup does not unpack 2.4 GB
# into /tmp on every launch, then drop the archive and download metadata.
tar -xf "$model/parakeet-unified-en-0.6b.nemo" -C "$model"
rm -rf "$model/parakeet-unified-en-0.6b.nemo" "$model/.cache"
echo "Model ready in $model"
