#!/usr/bin/env python
"""Speak text with the chosen default voice (Orpheus, dan, temperature 0.9).

    ./say "GET OUT! I said GET OUT!!" out.mp3
    ./say --file script.txt voiceover.mp3
    ./say --voice tara --temperature 0.6 "Calmer line. <sigh>" out.mp3

Orpheus has no emotion or volume setting: intensity comes from the text
(capitals, stacked exclamation marks, stretched vowels) and from temperature.
Tags: <laugh> <chuckle> <sigh> <cough> <sniffle> <groan> <yawn> <gasp>.
"""
import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "orpheus"))
import generate as g  # noqa: E402  (must come before numpy/torch: fixes LD_LIBRARY_PATH)
import numpy as np  # noqa: E402

DEFAULT_VOICE = "dan"
DEFAULT_TEMPERATURE = 0.9
# One generation tops out around 36 s of audio, and long prompts drift, so long
# text is spoken a few sentences at a time and joined.
CHUNK_CHARS = 280
GAP_SECONDS = 0.25
REROLLS = 3


def chunks(text):
    out, cur = [], ""
    for para in re.split(r"\n\s*\n", text.strip()):
        for sentence in re.findall(r".+?(?:[.!?…]+[\"')\]]*(?=\s|$)|$)", " ".join(para.split())):
            sentence = sentence.strip()
            if not sentence:
                continue
            if cur and len(cur) + len(sentence) + 1 > CHUNK_CHARS:
                out.append(cur)
                cur = ""
            cur = f"{cur} {sentence}".strip()
        if cur:  # never join across a paragraph break
            out.append(cur)
            cur = ""
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("text", nargs="?", help="text to speak (or use --file, or pipe on stdin)")
    ap.add_argument("out", help="output path, .mp3 or .wav")
    ap.add_argument("--file", help="read the text from this file")
    ap.add_argument("--voice", default=DEFAULT_VOICE, choices=g.VOICES)
    ap.add_argument("--temperature", type=float, default=DEFAULT_TEMPERATURE)
    ap.add_argument("--seed", type=int, default=1)
    a = ap.parse_args()

    text = Path(a.file).read_text() if a.file else a.text if a.text else sys.stdin.read()
    parts = chunks(text)
    if not parts:
        sys.exit("no text to speak")

    llm, snac = g.load_llm(), g.load_snac()
    gap = np.zeros(int(g.SAMPLE_RATE * GAP_SECONDS), dtype=np.float32)
    audio = []
    for i, part in enumerate(parts, 1):
        for attempt in range(REROLLS):
            codes, hit_eos = g.generate_codes(llm, a.voice, part, a.seed + attempt,
                                              temperature=a.temperature)
            if hit_eos:
                break
        clip = g.decode_codes(snac, codes)
        note = "" if hit_eos else "  (never finished cleanly; check this part)"
        print(f"[{i}/{len(parts)}] {len(clip) / g.SAMPLE_RATE:.1f}s{note}  {part[:60]}", file=sys.stderr)
        audio += [clip, gap]
    g.write_audio(np.concatenate(audio[:-1]), a.out)
    print(a.out)


if __name__ == "__main__":
    main()
