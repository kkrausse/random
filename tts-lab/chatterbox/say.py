"""Speak a long text with Chatterbox, a few sentences at a time, as one wav.

  python chatterbox/say.py --file script.txt --ref chatterbox/refs/libri3000m.flac out.wav

The counterpart of ../say.py (Orpheus): the same pieces (its `chunks` rule)
and the same line per piece on stderr, "[3/14] 17.2s  first words", so
whatever reads that log works for either voice. The model is loaded once.
Defaults are those of the site's cloned-voice samples (exaggeration 0.75,
cfg 0.4, seed 0); each piece is brought to --lufs so the pieces match.
"""
import argparse
import os
import re
import sys
from pathlib import Path

LAB = Path(os.environ.get("TTS_LAB_HOME") or Path(__file__).resolve().parent.parent)
os.environ.setdefault("HF_HOME", str(LAB / "hf-cache"))

import numpy as np
import pyloudnorm
import torch
import torchaudio

CHUNK_CHARS = 280
GAP_SECONDS = 0.25


def chunks(text):  # ../say.py's rule
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
    ap.add_argument("out", help="output path, .wav")
    ap.add_argument("--file", required=True, help="read the text from this file")
    ap.add_argument("--ref", help="reference clip to clone; default = built-in voice")
    ap.add_argument("--exaggeration", type=float, default=0.75)
    ap.add_argument("--cfg", type=float, default=0.4)
    ap.add_argument("--temperature", type=float, default=0.8)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--lufs", type=float, default=-20)
    a = ap.parse_args()

    parts = chunks(Path(a.file).read_text())
    if not parts:
        sys.exit("no text to speak")
    from chatterbox.tts import ChatterboxTTS
    model = ChatterboxTTS.from_pretrained(device="cuda")
    meter = pyloudnorm.Meter(model.sr)
    gap = torch.zeros(int(model.sr * GAP_SECONDS))
    audio = []
    for i, part in enumerate(parts, 1):
        torch.manual_seed(a.seed + i)
        torch.cuda.manual_seed_all(a.seed + i)
        kwargs = {"audio_prompt_path": a.ref} if a.ref and i == 1 else {}  # the voice is kept after the first piece
        clip = model.generate(part, temperature=a.temperature, exaggeration=a.exaggeration,
                              cfg_weight=a.cfg, **kwargs).detach().cpu().squeeze()
        loudness = meter.integrated_loudness(clip.numpy().astype(np.float64))
        if np.isfinite(loudness):
            clip = clip * float(10 ** ((a.lufs - loudness) / 20))
        print(f"[{i}/{len(parts)}] {len(clip) / model.sr:.1f}s  {part[:60]}", file=sys.stderr)
        audio += [clip, gap]
    wav = torch.cat(audio[:-1])
    peak = float(wav.abs().max())
    if peak > 0.98:
        wav = wav * (0.98 / peak)
    torchaudio.save(a.out, wav.unsqueeze(0), model.sr)
    print(a.out)


if __name__ == "__main__":
    main()
