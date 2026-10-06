#!/usr/bin/env bash
# Orpheus pushed as hard as text shaping allows: all-caps, stacked exclamation
# marks, stretched vowels, and a hotter sampling temperature. Writes
# site/audio/orpheus-intense.json. Run from the tts-lab directory.
set -euo pipefail
: "${TTS_LAB_HOME:=$PWD}"
PY=$TTS_LAB_HOME/orpheus/.venv/bin/python
A=site/audio
LOG=$(mktemp)
# name voice temperature seed
while read -r name voice temp seed; do
  f="$A/orpheus-$voice-$name-t${temp/./}.mp3"
  "$PY" orpheus/generate.py --voice "$voice" --temperature "$temp" --seed "$seed" \
    --text "$(cat "site/passages/$name.txt")" --out "$f" 2>/dev/null </dev/null \
    | tail -1 | sed "s/^{/{\"name\": \"$name\", \"voice\": \"$voice\", \"temp\": $temp, /" >> "$LOG"
done <<'LIST'
excited tara 0.6 1
excited tara 0.9 1
excited leah 0.9 1
excited zoe 0.9 1
excited leo 0.6 1
excited leo 0.9 1
excited dan 0.9 1
angry-caps tara 0.9 1
angry-caps leo 0.9 1
angry-caps dan 0.9 1
LIST
python3 - "$LOG" "$A" <<'PY'
import json, pathlib, sys
rows = [json.loads(l) for l in open(sys.argv[1]) if l.startswith("{")]
out = [{"file": pathlib.Path(r["out"]).name, "model": "orpheus", "voice": r["voice"], "passage": r["name"],
        "variant": f"temperature {r['temp']}", "duration_s": r["duration_s"], "gen_seconds": r["gen_seconds"],
        "notes": "" if r.get("hit_eos") else "did not finish cleanly"} for r in rows]
pathlib.Path(sys.argv[2], "orpheus-intense.json").write_text(json.dumps(out, indent=2) + "\n")
for o in out: print(o["file"], o["duration_s"], o["notes"])
PY
