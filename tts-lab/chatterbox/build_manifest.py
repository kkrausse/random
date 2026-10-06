"""Build site/audio/chatterbox.json from the logs render_all.sh leaves in
chatterbox/work/ (runs.jsonl from generate.py, verify.jsonl from verify.py).

  python chatterbox/build_manifest.py
"""
import json
from pathlib import Path

WORK = Path("chatterbox/work")
OUT = Path("site/audio/chatterbox.json")

# file-name key -> (voice label, note shown under the player)
VOICES = {
    "default": ("built-in default", "built-in default voice"),
    "libri84f": ("LibriTTS-R 84 (female)", "cloned from LibriTTS-R speaker 84, female"),
    "libri8842f": ("LibriTTS-R 8842 (female)", "cloned from LibriTTS-R speaker 8842, female, lower pitch"),
    "libri174m": ("LibriTTS-R 174 (male)", "cloned from LibriTTS-R speaker 174, male"),
    "libri3000m": ("LibriTTS-R 3000 (male)", "cloned from LibriTTS-R speaker 3000, male, deep"),
}


def read_jsonl(p: Path) -> list[dict]:
    return [json.loads(line) for line in p.read_text().splitlines() if line.strip()]


runs = read_jsonl(WORK / "runs.jsonl")
verified = {v["file"]: v for v in read_jsonl(WORK / "verify.jsonl")}

entries = []
for r in runs:
    v = verified[r["file"]]
    if not v["ok"]:
        raise SystemExit(f"{r['file']} failed verification: {v['bad']}")
    key = r["file"].removeprefix("chatterbox-").removeprefix("turbo-").split("-")[0]
    voice, note = VOICES[key]
    if r["model"] == "chatterbox-turbo":
        variant = "tagged"
        note += "; [laugh] [sigh] [gasp] [chuckle] tags"
    else:
        variant = f"exaggeration {r['exaggeration']:g}"
        note += f"; cfg {r['cfg']:g}"
    entries.append({
        "file": r["file"],
        "model": r["model"],
        "voice": voice,
        "variant": variant,
        "duration_s": v["duration_s"],
        "gen_seconds": r["gen_seconds"],
        "notes": note,
    })

OUT.write_text(json.dumps(entries, indent=2) + "\n")
print(f"wrote {OUT} ({len(entries)} entries)")
