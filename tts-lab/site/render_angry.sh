#!/usr/bin/env bash
# Render the angry/yelling passage through both models and write
# site/audio/{orpheus,chatterbox}-angry.json. Run from the tts-lab directory.
set -euo pipefail
: "${TTS_LAB_HOME:=$PWD}"
OPY=$TTS_LAB_HOME/orpheus/.venv/bin/python
CPY=$TTS_LAB_HOME/chatterbox/.venv/bin/python
A=site/audio
LOG=$(mktemp -d)
PLAIN=$(cat site/passages/angry.txt)
# Orpheus has no anger tag: delivery comes from the wording, punctuation and caps.
OTEXT=${PLAIN/lied about it. /lied about it. <groan> }
# Chatterbox Turbo has explicit style tags.
TTEXT="[angry] ${PLAIN/Get out./[angry] Get out.}"

for v in tara leah leo dan; do
  "$OPY" orpheus/generate.py --voice "$v" --seed 1 --text "$OTEXT" --out "$A/orpheus-$v-angry.mp3" 2>/dev/null | tail -1 >> "$LOG/orpheus.jsonl"
done

cb() { "$CPY" chatterbox/generate.py --lufs -20 --meta "$LOG/chatterbox.jsonl" "$@" >/dev/null 2>&1; }
cb --text "$PLAIN" --exaggeration 0.75 --cfg 0.4 --out "$A/chatterbox-default-angry-ex075.mp3"
cb --text "$PLAIN" --exaggeration 1.2 --cfg 0.3 --out "$A/chatterbox-default-angry-ex120.mp3"
cb --text "$PLAIN" --exaggeration 0.75 --cfg 0.4 --ref chatterbox/refs/libri174m.flac --out "$A/chatterbox-libri174m-angry-ex075.mp3"
cb --text "$PLAIN" --exaggeration 1.2 --cfg 0.3 --ref chatterbox/refs/libri174m.flac --out "$A/chatterbox-libri174m-angry-ex120.mp3"
cb --text "$PLAIN" --exaggeration 1.2 --cfg 0.3 --ref chatterbox/refs/libri84f.flac --out "$A/chatterbox-libri84f-angry-ex120.mp3"
cb --turbo --text "$TTEXT" --out "$A/chatterbox-turbo-default-angry.mp3"
cb --turbo --text "$TTEXT" --ref chatterbox/refs/libri3000m.flac --out "$A/chatterbox-turbo-libri3000m-angry.mp3"

python3 - "$LOG" "$A" <<'PY'
import json, pathlib, sys
log, audio = map(pathlib.Path, sys.argv[1:])
rows = lambda f: [json.loads(l) for l in (log / f).read_text().splitlines() if l.startswith("{")]
orpheus = [{"file": pathlib.Path(r["out"]).name, "model": "orpheus",
            "voice": pathlib.Path(r["out"]).name.split("-")[1], "variant": "wording only, plus <groan>",
            "duration_s": r["duration_s"], "gen_seconds": r["gen_seconds"], "notes": ""} for r in rows("orpheus.jsonl")]
chatterbox = []
for r in rows("chatterbox.jsonl"):
    turbo = r["model"] == "chatterbox-turbo"
    ref = pathlib.Path(r["ref"]).stem if r.get("ref") else "built-in default"
    chatterbox.append({"file": r["file"], "model": r["model"], "voice": ref,
                       "variant": "[angry] tags" if turbo else f"exaggeration {r['exaggeration']}",
                       "duration_s": r["duration_s"], "gen_seconds": r["gen_seconds"], "notes": ""})
(audio / "orpheus-angry.json").write_text(json.dumps(orpheus, indent=2) + "\n")
(audio / "chatterbox-angry.json").write_text(json.dumps(chatterbox, indent=2) + "\n")
print(len(orpheus), len(chatterbox))
PY
