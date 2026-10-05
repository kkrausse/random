#!/usr/bin/env bash
# GPU memory held by a spike process after it has streamed the fixture twice.
# Reports the per-process figure from nvidia-smi and the delta in total used memory (other
# processes, e.g. the live dictation service, are assumed steady over the few seconds this takes).
# usage: gpumem.sh cmd [args...]
set -uo pipefail
before=$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits)
log=$(mktemp)
SPIKE_HOLD_MS=4000 "$@" --quiet >"$log" 2>&1 &
pid=$!
until grep -q '^holding' "$log" || ! kill -0 "$pid" 2>/dev/null; do sleep 0.2; done
sleep 0.5
after=$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits)
echo "total_delta_mib=$((after - before))"
nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv,noheader | grep -E 'spike' || nvidia-smi | grep -E 'spike'
wait "$pid"
rm -f "$log"
