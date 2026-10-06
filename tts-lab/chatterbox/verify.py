"""Check rendered samples: duration, silence, abrupt ending, and (via Whisper)
that the words spoken match the passage -- catches truncation, skipped
sentences and hallucinated extra speech.

  python chatterbox/verify.py --text-file chatterbox/work/plain.txt site/audio/chatterbox-*.mp3

Prints one JSON line per file with "ok": true/false and the reasons.
"""
import argparse
import json
import re
from pathlib import Path

import librosa
import numpy as np
import torch
from transformers import WhisperForConditionalGeneration, WhisperProcessor

ASR = "openai/whisper-small.en"


def words(s: str) -> list[str]:
    s = re.sub(r"\[[a-z ]+\]", " ", s.lower())  # drop [laugh]-style tags
    return re.sub(r"[^a-z' ]", " ", s).split()


def wer(ref: list[str], hyp: list[str]) -> float:
    d = np.arange(len(hyp) + 1)
    for i, r in enumerate(ref, 1):
        prev, d[0] = d[0], i
        for j, h in enumerate(hyp, 1):
            prev, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, prev + (r != h))
    return d[-1] / max(len(ref), 1)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--text-file", required=True)
    p.add_argument("--min-s", type=float, default=12.0)
    p.add_argument("--max-s", type=float, default=30.0)
    p.add_argument("--max-wer", type=float, default=0.12)
    p.add_argument("files", nargs="+")
    a = p.parse_args()
    ref = words(Path(a.text_file).read_text())

    dev = "cuda" if torch.cuda.is_available() else "cpu"
    proc = WhisperProcessor.from_pretrained(ASR)
    asr = WhisperForConditionalGeneration.from_pretrained(ASR).to(dev).eval()

    for f in a.files:
        y, sr = librosa.load(f, sr=16000, mono=True)
        hop = 320
        fr = y[: len(y) // hop * hop].reshape(-1, hop)
        db = 20 * np.log10(np.sqrt((fr**2).mean(axis=1)) + 1e-9)
        silent = db < -50
        longest = run = 0
        for s in silent:
            run = run + 1 if s else 0
            longest = max(longest, run)
        feats = proc(y, sampling_rate=sr, return_tensors="pt").input_features.to(dev)
        with torch.no_grad():
            ids = asr.generate(feats, max_new_tokens=200)
        hyp_text = proc.batch_decode(ids, skip_special_tokens=True)[0].strip()
        hyp = words(hyp_text)
        dur = len(y) / sr
        res = {
            "file": Path(f).name,
            "duration_s": round(dur, 2),
            "words_per_s": round(len(ref) / dur, 2),
            "rms_db": round(float(20 * np.log10(np.sqrt((y**2).mean()) + 1e-9)), 1),
            "longest_silence_s": round(longest * 0.02, 2),
            "tail_db": round(float(db[-5:].max()), 1),
            "wer": round(wer(ref, hyp), 3),
            "last_words_ok": hyp[-2:] == ref[-2:],
            "transcript": hyp_text,
        }
        bad = []
        if not a.min_s <= dur <= a.max_s:
            bad.append("duration")
        if res["rms_db"] < -35:
            bad.append("silent")
        if res["longest_silence_s"] > 2.5:
            bad.append("long-gap")
        if res["tail_db"] > -35:
            bad.append("abrupt-end")
        if res["wer"] > a.max_wer:
            bad.append("wer")
        if not res["last_words_ok"]:
            bad.append("ending-words")
        res = {"ok": not bad, "bad": bad, **res}
        print(json.dumps(res))


if __name__ == "__main__":
    main()
