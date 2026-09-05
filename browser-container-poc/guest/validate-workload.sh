#!/bin/sh
# Run inside the guest: sh /tmp/validate-workload.sh > /tmp/workload.log 2>&1 &
# All compilation and HTTP requests execute in the guest, not on the host.
set -eu
export BUN_JSC_useFTLJIT=false
cd /workspace
mode=${1:-dev}
case "$mode" in dev|build) ;; *) echo 'Usage: validate-workload [dev|build]' >&2; exit 2 ;; esac
server_pid=
cleanup() {
  if [ -n "$server_pid" ]; then
    kill "$server_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

step() {
  name=$1
  shift
  echo "${name}_START=$(date +%s)"
  result=0
  "$@" || result=$?
  echo "${name}_EXIT=$result"
  echo "${name}_END=$(date +%s)"
  [ "$result" -eq 0 ]
}

step OPTIONS timeout -s KILL 120 env BUN_JSC_dumpOptions=1 bun -e 'console.log("option probe")' > /tmp/workload-options.log 2>&1
grep 'useFTLJIT=false' /tmp/workload-options.log
if [ "$mode" = build ]; then
  # Optional diagnostic; production bundling is not required for the HMR POC.
  # Force a real typecheck even when the image contains native-build metadata.
  find . -path ./node_modules -prune -o -name '*.tsbuildinfo' -type f -exec rm {} \;
  step BUILD timeout -s KILL 1200 bun run build
fi

echo "DEV_START=$(date +%s)"
bun node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort > /tmp/workload-vite.log 2>&1 &
server_pid=$!
# A watchdog also bounds shutdown if Vite ignores TERM.
(sleep 900; kill -KILL "$server_pid" 2>/dev/null || true) &
watchdog_pid=$!
trap 'cleanup; kill "$watchdog_pid" 2>/dev/null || true' EXIT
ready=false
for attempt in $(seq 1 90); do
  kill -0 "$server_pid" || break
  if curl --noproxy '*' --fail --silent --max-time 5 http://127.0.0.1:5173/ > /tmp/workload-index.html; then
    ready=true
    break
  fi
  sleep 2
done
[ "$ready" = true ]
grep -q '/@vite/client' /tmp/workload-index.html
step DEV_CLIENT curl --noproxy '*' --fail --silent --max-time 120 -o /tmp/workload-client.js http://127.0.0.1:5173/@vite/client
step DEV_SOURCE curl --noproxy '*' --fail --silent --max-time 120 -o /tmp/workload-main.js http://127.0.0.1:5173/src/main.tsx
echo "DEV_HTTP_PASS=$(date +%s)"
kill -TERM "$server_pid"
result=0
wait "$server_pid" || result=$?
server_pid=
echo "DEV_STOP_EXIT=$result"
case "$result" in 0|143) ;; *) exit 1 ;; esac
if curl --noproxy '*' --fail --silent --max-time 5 http://127.0.0.1:5173/ > /dev/null; then
  echo 'DEV_STOP_FAILED=port still serving'
  exit 1
fi
echo "WORKLOAD_PASS=$(date +%s)"
