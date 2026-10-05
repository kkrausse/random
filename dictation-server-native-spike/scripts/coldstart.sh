#!/usr/bin/env bash
# Cold start = wall clock from just before exec() until the process reports it can transcribe
# (model loaded and the first [chunk|right] window of silence transcribed). Warm disk cache.
# Uses /proc/uptime on both sides: 10 ms resolution, immune to wall-clock steps. usage: coldstart.sh RUNS cmd [args...]
set -uo pipefail
runs=$1
shift
for i in $(seq "$runs"); do
  read -r t0 _ </proc/uptime
  out=$("$@" --quiet 2>&1)
  ready=$(grep -m1 '^ready_uptime_s=' <<<"$out" | cut -d= -f2)
  pick() { grep -m1 "^$1=" <<<"$out" | cut -d= -f2; }
  echo "run $i: launch_to_ready_ms=$(awk "BEGIN{printf \"%d\", ($ready - $t0) * 1000}") in_process_ready_ms=$(pick ready_at_ms) loaded_at_ms=$(pick loaded_at_ms) first_window_ms=$(pick first_window_ms) warmup_ms=$(pick warmup_ms)"
done
