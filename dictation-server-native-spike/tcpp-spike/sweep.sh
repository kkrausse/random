#!/usr/bin/env bash
# usage: sweep.sh "<QUANT> <args...>" ...   e.g. sweep.sh "F16 --backend cuda" "Q8_0 --backend cpu --threads 12"
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
for spec in "$@"; do
  quant=${spec%% *}
  args=${spec#* }
  # shellcheck disable=SC2086
  out=$(QUANT=$quant "$here/run.sh" --quiet $args 2>&1)
  pick() { grep -m1 "^$1=" <<<"$out" | cut -d= -f2; }
  printf '%-40s backend_init=%4s model_load=%5s ready=%5s first_win=%5s chunk1=%6s median=%6s max=%6s pass2_median=%6s rss=%s\n' \
    "[$spec]" "$(pick backend_init_ms)" "$(pick model_load_ms)" "$(pick ready_at_ms)" "$(pick first_window_ms)" \
    "$(pick chunk_first_ms)" "$(pick chunk_median_ms)" "$(pick chunk_max_ms)" "$(pick second_pass_chunk_median_ms)" \
    "$(grep -m1 VmHWM <<<"$out" | tr -s '\t ' ' ' | cut -d' ' -f2-)"
  grep -q '^final=' <<<"$out" || tail -3 <<<"$out"
done
