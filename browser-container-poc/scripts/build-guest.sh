#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
source "$ROOT/guest/versions.env"

CACHE="$ROOT/.cache/qemu-wasm"
DOWNLOADS="$ROOT/.cache/downloads"
CONTEXT="$CACHE/examples/x86_64-alpine/image"
OUTPUT="$ROOT/.cache/guest-output"
DESTINATION="$ROOT/public/qemu"
PACKAGER_IMAGE="emscripten/emsdk:3.1.50@sha256:b6ea0e55fdc95be36427df6df7892d5e5e27f0440cfcf442a55f784aba09a4fa"

cleanup() {
  rm -rf "$CACHE" "$OUTPUT"
}
trap cleanup EXIT

rm -rf "$CACHE"
git init --quiet "$CACHE"
git -C "$CACHE" remote add origin https://github.com/ktock/qemu-wasm.git
git -C "$CACHE" fetch --depth 1 origin "$QEMU_WASM_REVISION"
git -C "$CACHE" checkout --quiet --detach FETCH_HEAD

mkdir -p "$DOWNLOADS"
curl --location --fail --retry 3 --continue-at - \
  --output "$DOWNLOADS/alpine-$ALPINE_VERSION.iso" \
  "https://dl-cdn.alpinelinux.org/alpine/v3.21/releases/x86_64/alpine-virt-$ALPINE_VERSION-x86_64.iso"
curl --location --fail --retry 3 --continue-at - \
  --output "$DOWNLOADS/bun-$BUN_VERSION-musl-baseline.zip" \
  "https://github.com/oven-sh/bun/releases/download/bun-v$BUN_VERSION/bun-linux-x64-musl-baseline.zip"
curl --location --fail --retry 3 --continue-at - \
  --output "$DOWNLOADS/opencode-$OPENCODE_VERSION-linux-x64-baseline-musl.tgz" \
  "https://registry.npmjs.org/@opencode-ai/cli-linux-x64-baseline-musl/-/cli-linux-x64-baseline-musl-$OPENCODE_VERSION.tgz"
printf '%s  %s\n' "$ALPINE_SHA256" "$DOWNLOADS/alpine-$ALPINE_VERSION.iso" | shasum -a 256 --check
printf '%s  %s\n' "$BUN_SHA256" "$DOWNLOADS/bun-$BUN_VERSION-musl-baseline.zip" | shasum -a 256 --check
printf '%s  %s\n' "$OPENCODE_SHA256" "$DOWNLOADS/opencode-$OPENCODE_VERSION-linux-x64-baseline-musl.tgz" | shasum -a 256 --check
cp "$DOWNLOADS/alpine-$ALPINE_VERSION.iso" "$CONTEXT/alpine.iso"
cp "$DOWNLOADS/bun-$BUN_VERSION-musl-baseline.zip" "$CONTEXT/bun.zip"
cp "$DOWNLOADS/opencode-$OPENCODE_VERSION-linux-x64-baseline-musl.tgz" "$CONTEXT/opencode.tgz"

cp "$ROOT/guest/image/Dockerfile" \
  "$ROOT/guest/image/create-image.sh" \
  "$ROOT/guest/image/create-image-args-x86_64.json" \
  "$ROOT/guest/image/root-profile" \
  "$CONTEXT/"
rm -rf "$CONTEXT/workspace"
mkdir -p "$CONTEXT/workspace"
tar -C "$ROOT/guest/fixture" \
  --exclude=node_modules \
  --exclude=dist \
  --exclude='*.tsbuildinfo' \
  -cf - . | tar -C "$CONTEXT/workspace" -xf -

rm -rf "$OUTPUT"
mkdir -p "$OUTPUT" "$DESTINATION"
docker build \
  --progress=plain \
  --build-arg "ALPINE_VERSION=$ALPINE_VERSION" \
  --build-arg "BUN_VERSION=$BUN_VERSION" \
  --output "type=local,dest=$OUTPUT" \
  "$CONTEXT"

rm -f "$DESTINATION/guest-build.txt"
for kind in kernel initramfs rootfs; do
  pack="$OUTPUT/pack-$kind"
  rm -rf "$pack"
  mkdir -p "$pack"
  case "$kind" in
    kernel) cp "$OUTPUT/vmlinuz-virt" "$pack/" ;;
    initramfs) cp "$OUTPUT/initramfs-virt" "$pack/" ;;
    rootfs) cp "$OUTPUT/disk-rootfs.img" "$pack/" ;;
  esac
  lz4=""
  [[ "$kind" == rootfs ]] && lz4="--lz4"
  docker run --rm \
    -v "$pack:/pack-$kind:ro" \
    -v "$DESTINATION:/artifacts" \
    "$PACKAGER_IMAGE" /bin/sh -lc \
    "cd /artifacts && /emsdk/upstream/emscripten/tools/file_packager.py load-$kind.data $lz4 --preload /pack-$kind > load-$kind.js"
done

cat > "$DESTINATION/guest-build.txt" <<EOF
QEMU_WASM_REVISION=$QEMU_WASM_REVISION
ALPINE_VERSION=$ALPINE_VERSION
ALPINE_SHA256=$ALPINE_SHA256
BUN_VERSION=$BUN_VERSION
BUN_SHA256=$BUN_SHA256
OPENCODE_VERSION=$OPENCODE_VERSION
QEMU_CPU_MODEL=max
REQUIRES_RUNTIME_PATCH=ctpop-operand-indexes
JSC_useFTLJIT=false
EOF

echo "Custom guest artifacts written to $DESTINATION"
