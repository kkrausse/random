"""Check the narration samples without listening: plausible length for the word
count, not silent, no long hole, and a Whisper (small.en) transcript close to
the passage. Writes narration/verify.json.

  $TTS_LAB_HOME/chatterbox/.venv/bin/python narration/verify.py [ids...]
"""
import json
import os
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
LAB = Path(os.environ.get("TTS_LAB_HOME") or HERE.parent)
os.environ.setdefault("HF_HOME", str(LAB / "hf-cache"))

import librosa
import numpy as np
import torch
from transformers import pipeline

OUT = HERE / "verify.json"
MAX_WER = 0.10
WORDS_PER_S = (1.8, 3.8)  # calm narration sits near 2.5-3


def words(s):
    s = s.lower().replace("’", "'").replace("'85", "eighty five").replace("85", "eighty five")
    return re.sub(r"[^a-z' ]", " ", s.replace("-", " ")).split()


def wer(ref, hyp):
    d = np.arange(len(hyp) + 1)
    for i, r in enumerate(ref, 1):
        prev, d[0] = d[0], i
        for j, h in enumerate(hyp, 1):
            prev, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, prev + (r != h))
    return d[-1] / max(len(ref), 1)


def main():
    ref = words((HERE / "passage.txt").read_text())
    asr = pipeline("automatic-speech-recognition", model="openai/whisper-small.en",
                   device="cuda" if torch.cuda.is_available() else "cpu")
    done = json.loads(OUT.read_text()) if OUT.exists() else {}
    ids = sys.argv[1:] or sorted(p.stem for p in (HERE / "site/audio").glob("*.mp3"))
    for id in ids:
        y, sr = librosa.load(HERE / f"site/audio/{id}.mp3", sr=16000, mono=True)
        fr = y[: len(y) // 320 * 320].reshape(-1, 320)
        db = 20 * np.log10(np.sqrt((fr**2).mean(axis=1)) + 1e-9)
        longest = run = 0
        for quiet in db < -50:
            run = run + 1 if quiet else 0
            longest = max(longest, run)
        # Whisper hears 30 s at a time and its own stitching of longer audio drops
        # sentences, so cut at the quietest frame in each 18-26 s stretch instead.
        cuts = [0]
        while len(db) - cuts[-1] > 1300:
            cuts.append(cuts[-1] + 900 + int(np.argmin(db[cuts[-1] + 900: cuts[-1] + 1300])))
        cuts.append(len(db) + 1)
        text = " ".join(asr({"raw": y[a * 320: b * 320], "sampling_rate": sr})["text"].strip()
                        for a, b in zip(cuts, cuts[1:]))
        dur = len(y) / sr
        res = {"duration_s": round(dur, 1), "words_per_s": round(len(ref) / dur, 2),
               "rms_db": round(float(20 * np.log10(np.sqrt((y**2).mean()) + 1e-9)), 1),
               "longest_silence_s": round(longest * 0.02, 2), "wer": round(float(wer(ref, words(text))), 3),
               "transcript": text}
        bad = []
        if not WORDS_PER_S[0] <= res["words_per_s"] <= WORDS_PER_S[1]:
            bad.append("length")
        if res["rms_db"] < -35:
            bad.append("silent")
        if res["longest_silence_s"] > 2.5:
            bad.append("long-gap")
        if res["wer"] > MAX_WER:
            bad.append("words")
        done[id] = {"ok": not bad, "bad": bad, **res}
        OUT.write_text(json.dumps(done, indent=1))
        print(id, "ok" if not bad else bad, res["duration_s"], res["wer"], flush=True)


if __name__ == "__main__":
    main()
