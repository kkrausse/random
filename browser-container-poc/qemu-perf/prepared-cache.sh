#!/bin/sh
# Run only inside this spike's isolated guest after the first warm batch.
# Usage: sh /tmp/prepared-cache.sh <owned-vite-pid>
set -eu
cd /workspace
pid=${1:?Pass the owned Vite PID}
case "$pid" in *[!0-9]*|'') exit 2 ;; esac
tr '\0' ' ' < "/proc/$pid/cmdline" | grep -q 'node_modules/vite/bin/vite.js' || exit 2
test -f node_modules/.vite/deps/_metadata.json
test ! -e /tmp/qemu-perf-original-vite-cache
sha256sum node_modules/.vite/deps/_metadata.json
tar cf /tmp/qemu-perf-prepared-vite-cache.tar -C node_modules .vite
kill -TERM "$pid"
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  test ! -e "/proc/$pid" && break
  sleep 1
done
# This Bun/Vite build can close HTTP yet retain its process after SIGTERM.
# Stop only the explicitly verified owned PID; never use broad pkill patterns.
if test -e "/proc/$pid"; then
  kill -KILL "$pid"
  sleep 1
fi
if test -e "/proc/$pid/status"; then
  grep -q '^State:.*Z' "/proc/$pid/status"
fi
mv node_modules/.vite /tmp/qemu-perf-original-vite-cache
tar xf /tmp/qemu-perf-prepared-vite-cache.tar -C node_modules
sha256sum node_modules/.vite/deps/_metadata.json
export BUN_JSC_useFTLJIT=false
DEBUG=vite:transform,vite:hmr,vite:deps bun node_modules/vite/bin/vite.js \
  --host 127.0.0.1 --port 5173 --strictPort </dev/null >/tmp/perf-vite-prepared.log 2>&1 &
echo PREPARED_VITE_PID=$!
