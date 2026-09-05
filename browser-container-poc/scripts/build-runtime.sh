#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
source "$ROOT/guest/versions.env"
CACHE="$ROOT/.cache/qemu-runtime"
mkdir -p "$CACHE" "$ROOT/public/qemu"
if [[ ! -d "$CACHE/.git" ]]; then
  git init --quiet "$CACHE"
  git -C "$CACHE" remote add origin https://github.com/ktock/qemu-wasm.git
fi
git -C "$CACHE" fetch --depth 1 origin "$QEMU_WASM_REVISION"
git -C "$CACHE" checkout --force --quiet --detach FETCH_HEAD
# Fix the two-operand ctpop instructions: args[0] is destination, args[1] source.
git -C "$CACHE" apply "$ROOT/guest/qemu-popcnt.patch"
# Historical releases move into upstream's fossils directory.
sed -i.bak 's@curl -Ls https://zlib.net/zlib-$ZLIB_VERSION.tar.xz | tar xJC@curl -fLs https://zlib.net/fossils/zlib-$ZLIB_VERSION.tar.gz | tar xzC@' "$CACHE/Dockerfile"
docker build --progress=plain -t browser-container-poc-qemu-builder "$CACHE"
docker run --rm \
  -v "$CACHE:/qemu" \
  -v "$ROOT/guest:/guest:ro" \
  -v "$ROOT/public/qemu:/artifacts" \
  browser-container-poc-qemu-builder /bin/bash -lc '
    set -euo pipefail
    git config --global --add safe.directory /qemu
    as --64 /guest/popcnt-test.S -o /build/popcnt-test.o
    ld -static -s -z noseparate-code /build/popcnt-test.o -o /artifacts/popcnt-test
    flags="-O3 -g -Wno-error=unused-command-line-argument -matomics -mbulk-memory -DNDEBUG -DG_DISABLE_ASSERT -D_GNU_SOURCE -sASYNCIFY=1 -pthread -sPROXY_TO_PTHREAD=1 -sFORCE_FILESYSTEM -sALLOW_TABLE_GROWTH -sTOTAL_MEMORY=2300MB -sWASM_BIGINT -sMALLOC=mimalloc --js-library=/build/node_modules/xterm-pty/emscripten-pty.js -sEXPORT_ES6=1 -sASYNCIFY_IMPORTS=ffi_call_js"
    emconfigure /qemu/configure --static --target-list=x86_64-softmmu --cpu=wasm32 --cross-prefix= \
      --without-default-features --enable-system --with-coroutine=fiber --enable-virtfs \
      --extra-cflags="$flags" --extra-cxxflags="$flags" \
      --extra-ldflags="-sLZ4=1 -sEXPORTED_RUNTIME_METHODS=getTempRet0,setTempRet0,addFunction,removeFunction,TTY,FS"
    emmake make -j2 qemu-system-x86_64
    rm -f /artifacts/runtime-build.txt
    cp qemu-system-x86_64 /artifacts/out.js
    cp qemu-system-x86_64.wasm qemu-system-x86_64.worker.js /artifacts/
  '
printf 'QEMU_WASM_REVISION=%s\nPATCH=ctpop-operand-indexes\n' "$QEMU_WASM_REVISION" > "$ROOT/public/qemu/runtime-build.txt"
