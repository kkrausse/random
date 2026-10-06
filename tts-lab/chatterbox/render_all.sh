#!/usr/bin/env bash
# Render every Chatterbox sample for the comparison page, then verify them.
# Run from the repo/worktree root:  bash chatterbox/render_all.sh
# Seeds are the ones that passed verify.py (the built-in voice rushes on
# most seeds at exaggeration >= 0.75; see README).
set -euo pipefail
: "${TTS_LAB_HOME:=$(cd "$(dirname "$0")/.." && pwd)}"
export HF_HOME="${HF_HOME:-$TTS_LAB_HOME/hf-cache}"
PY=$TTS_LAB_HOME/chatterbox/.venv/bin/python
W=chatterbox/work
A=site/audio
mkdir -p "$W" "$A"
rm -f "$W/runs.jsonl"

# passage.md: line 4 = plain text, line 7 = Orpheus-tagged text.
sed -n 4p passage.md > "$W/plain.txt"
# Turbo uses [tag] instead of Orpheus' <tag>; laugh/sigh/gasp/chuckle all exist in Turbo.
sed -n 7p passage.md | sed -E 's/<([a-z]+)>/[\1]/g' > "$W/tagged.txt"

gen() {
  "$PY" chatterbox/generate.py --meta "$W/runs.jsonl" --lufs -20 "$@" 2>/dev/null | tail -1 | cut -c1-290
}
std() { gen --text-file "$W/plain.txt" "$@"; }
turbo() { gen --turbo --text-file "$W/tagged.txt" "$@"; }

std --seed 0 --exaggeration 0.5  --cfg 0.5 --out "$A/chatterbox-default-ex050.mp3"
std --seed 4 --exaggeration 0.75 --cfg 0.4 --out "$A/chatterbox-default-ex075.mp3"
std --seed 3 --exaggeration 1.0  --cfg 0.3 --out "$A/chatterbox-default-ex100.mp3"
std --seed 1 --exaggeration 0.75 --cfg 0.4 --ref chatterbox/refs/libri84f.flac   --out "$A/chatterbox-libri84f-ex075.mp3"
std --seed 0 --exaggeration 0.75 --cfg 0.4 --ref chatterbox/refs/libri8842f.flac --out "$A/chatterbox-libri8842f-ex075.mp3"
std --seed 0 --exaggeration 0.75 --cfg 0.4 --ref chatterbox/refs/libri174m.flac  --out "$A/chatterbox-libri174m-ex075.mp3"
std --seed 0 --exaggeration 0.75 --cfg 0.4 --ref chatterbox/refs/libri3000m.flac --out "$A/chatterbox-libri3000m-ex075.mp3"

turbo --seed "${TURBO_DEFAULT_SEED:-0}" --out "$A/chatterbox-turbo-default-tagged.mp3"
turbo --seed "${TURBO_CLONE_SEED:-0}" --ref chatterbox/refs/libri84f.flac --out "$A/chatterbox-turbo-libri84f-tagged.mp3"

"$PY" chatterbox/verify.py --text-file "$W/plain.txt" "$A"/chatterbox-*.mp3 2>/dev/null | grep '^{' | tee "$W/verify.jsonl"
