#!/usr/bin/env bash
# Build the transcribe.cpp spike against the prebuilt v0.3.1 CUDA release (no compile of ggml needed).
# Fetches the release tarball and the matching headers on first run.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
source "$here/../env.sh"
version=0.3.1
lib=$SPIKE_CACHE/tcpp/transcribe-native-linux-x86_64-cuda
src=$SPIKE_CACHE/src/transcribe.cpp-v$version
if [ ! -f "$lib/libtranscribe.so" ]; then
  mkdir -p "$SPIKE_CACHE/tcpp"
  curl -sL "https://github.com/handy-computer/transcribe.cpp/releases/download/v$version/transcribe-native-$version-linux-x86_64-cuda.tar.gz" |
    tar xz -C "$SPIKE_CACHE/tcpp"
fi
[ -d "$src" ] || git clone --depth 1 --branch "v$version" https://github.com/handy-computer/transcribe.cpp "$src"
mkdir -p "$SPIKE_CACHE/tcpp-build"
gcc -O2 -o "$SPIKE_CACHE/tcpp-build/tcpp-spike" "$here/main.c" \
  -I"$src/include" -I"$src/examples/common" -L"$lib" -ltranscribe -lm -Wl,-rpath,"$lib"
ls -la "$SPIKE_CACHE/tcpp-build/tcpp-spike"
