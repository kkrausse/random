#!/bin/sh
# One-time setup: the pinned transcribe.cpp release, the model weights, a small
# venv, and a warm Vulkan shader cache. Safe to rerun; finished steps are skipped.
# Usage: ./setup.sh [cache-dir]   (default .cache here, about 1.3 GB)
set -eu
cd "$(dirname "$0")"
PATH="$HOME/.local/bin:$PATH"

# Checksums are the ones upstream publishes: the GitHub release asset digest and
# the Hugging Face LFS object id.
version=0.3.1
release=transcribe-native-$version-linux-x86_64-cpu-vulkan.tar.gz
release_sha256=7656cd88b563d79af4e483400aebd149c50aad2c3b20ced1f5a06ce1e50f435a
weights=parakeet-unified-en-0.6b-F16.gguf
weights_sha256=4a284b229bff9dc66aa00666fdcc2419c0f82a5adb5a36f7a48a4e0713c35492

command -v uv >/dev/null || { echo "uv not found; install: curl -LsSf https://astral.sh/uv/install.sh | sh" >&2; exit 1; }

# Everything large lives in .cache. Given another directory, .cache becomes a
# link to it, so run.sh and server.py never need to be told where it is.
if [ $# -gt 0 ]; then
  mkdir -p "$1"
  target=$(cd "$1" && pwd -P)
  if [ -d .cache ] && [ ! -L .cache ]; then
    echo ".cache is a real directory; remove or move it before pointing it at $target" >&2
    exit 1
  fi
  ln -sfn "$target" .cache
fi
mkdir -p .cache/models .cache/shaders

verified() { echo "$1  $2" | sha256sum --check --status; }
fetch() { # url sha256 destination
  if [ -f "$3" ] && verified "$2" "$3"; then return; fi
  echo "Downloading $1"
  curl -fL --retry 3 --progress-bar -o "$3.part" "$1"
  verified "$2" "$3.part" || { rm -f "$3.part"; echo "Checksum mismatch for $1" >&2; exit 1; }
  mv "$3.part" "$3"
}

library=.cache/transcribe-native-$version
if [ ! -f "$library/libtranscribe.so" ]; then
  fetch "https://github.com/handy-computer/transcribe.cpp/releases/download/v$version/$release" "$release_sha256" ".cache/$release"
  rm -rf "$library.part"
  mkdir "$library.part"
  tar -xzf ".cache/$release" -C "$library.part" --strip-components=1
  mv "$library.part" "$library"
  rm ".cache/$release"
fi
fetch "https://huggingface.co/handy-computer/parakeet-unified-en-0.6b-gguf/resolve/main/$weights" "$weights_sha256" ".cache/models/$weights"

UV_LINK_MODE=copy uv sync --frozen

# The NVIDIA driver compiles Vulkan pipelines on first use and caches them on
# disk. Without this the first start takes about 3 s and the first recording
# stalls for several more. A driver update empties the cache: rerun this script.
if command -v ffmpeg >/dev/null; then
  ffmpeg -loglevel error -y -i fixtures/librispeech-sample.flac -f f32le -ar 16000 -ac 1 .cache/warm-up.f32
  ./run.sh --warm-up .cache/warm-up.f32
  rm .cache/warm-up.f32
else
  echo "ffmpeg not found: shader cache not warmed, so the first recording will stall while it fills" >&2
fi
echo "Ready: ./run.sh --port 9876"
