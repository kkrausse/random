#!/usr/bin/env bash
# Try each transcribe.cpp dispatch override (docs/environment-variables.md) on the CUDA backend.
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
for name in NONE TRANSCRIBE_CONV_DIRECT_DW TRANSCRIBE_CONV_NO_DIRECT_DW TRANSCRIBE_CONV_DIRECT_PW \
  TRANSCRIBE_CONV_NO_DIRECT_PW TRANSCRIBE_NO_FLASH TRANSCRIBE_FORCE_FLASH; do
  out=$(env "$name=1" "$here/run.sh" --quiet "$@" 2>&1)
  printf '%-32s %s\n' "$name" "$(grep -E '^(ready_at_ms|chunk_median_ms|second_pass_chunk_median_ms)=' <<<"$out" | tr '\n' ' ')"
done
