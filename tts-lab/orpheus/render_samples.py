#!/usr/bin/env python
"""Render the comparison-page samples into site/audio/ and write site/audio/orpheus.json.

    python orpheus/render_samples.py                      # everything
    python orpheus/render_samples.py --only leo-tagged    # re-render some (after editing SEEDS)

Loads the model once. A clip that fails the sanity checks (no end-of-speech token,
duration outside 12-30 s, near-silent) is re-rolled with the next seed.
"""
import argparse
import json
import os
import re
import subprocess
from pathlib import Path

import generate as g  # must come first: fixes LD_LIBRARY_PATH before torch loads

ROOT = Path(__file__).resolve().parent.parent
AUDIO = ROOT / "site/audio"
MANIFEST = AUDIO / "orpheus.json"

JOBS = [(v, "tagged") for v in ["tara", "leah", "jess", "leo", "dan", "zoe"]] + [
    ("tara", "plain"), ("leo", "plain")]
# First seed tried per clip; bump one here to re-roll a clip that sounds or measures wrong.
SEEDS = {"zoe-tagged": 2}  # re-rolled while checking the opening "Oh my god"; see README
DEFAULT_SEED = 1
NOTES = {"tara": "female", "leah": "female", "jess": "female", "zoe": "female",
         "leo": "male", "dan": "male"}


def passages():
    md = (ROOT / "passage.md").read_text()
    plain = re.search(r"## Plain.*?\n(.+?)\n\s*\n", md, re.S).group(1).strip()
    tagged = re.search(r"## Orpheus-tagged\n(.+?)\s*$", md, re.S).group(1).strip()
    return {"plain": plain, "tagged": tagged}


def ok(s):
    return s["hit_eos"] and 12 <= s["duration_s"] <= 30 and s["rms"] > 0.01


def vram_mib():
    out = subprocess.run(["nvidia-smi", "--query-compute-apps=pid,used_memory",
                          "--format=csv,noheader,nounits"], capture_output=True, text=True).stdout
    return next((int(l.split(",")[1]) for l in out.splitlines()
                 if l.split(",")[0].strip() == str(os.getpid())), None)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*", help="e.g. leo-tagged tara-plain")
    a = ap.parse_args()

    texts = passages()
    llm, snac = g.load_llm(), g.load_snac()
    entries = {e["file"]: e for e in json.loads(MANIFEST.read_text())} if MANIFEST.exists() else {}

    for voice, variant in JOBS:
        key = f"{voice}-{variant}"
        if a.only and key not in a.only:
            continue
        name = f"orpheus-{key}.mp3"
        seed = SEEDS.get(key, DEFAULT_SEED)
        for attempt in range(5):
            s = g.synthesize(llm, snac, voice, texts[variant], seed + attempt, AUDIO / name)
            print(key, "OK" if ok(s) else "BAD", s, f"vram={vram_mib()}MiB", flush=True)
            if ok(s):
                break
        entries[name] = {"file": name, "model": "orpheus", "voice": voice, "variant": variant,
                         "duration_s": s["duration_s"], "gen_seconds": s["gen_seconds"],
                         "notes": f"{NOTES[voice]}, built-in voice"}

    order = [f"orpheus-{v}-{k}.mp3" for v, k in JOBS]
    MANIFEST.write_text(json.dumps([entries[f] for f in order if f in entries], indent=2) + "\n")


if __name__ == "__main__":
    main()
