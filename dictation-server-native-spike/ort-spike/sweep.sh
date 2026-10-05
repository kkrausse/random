#!/usr/bin/env bash
# Run several option sets and print the headline numbers for each on one line.
# usage: sweep.sh "<args for run 1>" "<args for run 2>" ...
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
for args in "$@"; do
  # shellcheck disable=SC2086
  out=$("$here/run.sh" --quiet $args 2>&1)
  pick() { grep -m1 "^$1=" <<<"$out" | cut -d= -f2; }
  printf '%-58s enc_sess=%5s ready=%5s first_win=%5s chunk1=%6s median=%6s max=%6s pass2_median=%6s rss=%s\n' \
    "[$args]" "$(pick encoder_session_ms)" "$(pick ready_at_ms)" "$(pick first_window_ms)" "$(pick chunk_first_ms)" \
    "$(pick chunk_median_ms)" "$(pick chunk_max_ms)" "$(pick second_pass_chunk_median_ms)" "$(pick VmHWM)"
  grep -q '^final=' <<<"$out" || tail -3 <<<"$out"
done
