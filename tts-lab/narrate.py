"""Shared by the per-model say.py scripts: the piece rule and the join.

`chunks` is ../say.py's rule, unchanged. `speak` runs one synth call per piece,
prints the per-piece line the film pipeline times words from
("[3/14] 17.2s  first words"), brings each piece to --lufs, joins the pieces
with the same 0.25 s gap and writes one wav.
"""
import json
import re
import sys
import time

CHUNK_CHARS = 280
GAP_SECONDS = 0.25


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


def speak(parts, synth, sample_rate, out, lufs=-20.0, stats=None, load_seconds=None):
    """synth(part, index_from_1) -> mono float numpy array at sample_rate."""
    import numpy as np
    import pyloudnorm
    import soundfile as sf

    meter = pyloudnorm.Meter(sample_rate)
    gap = np.zeros(int(sample_rate * GAP_SECONDS), dtype=np.float32)
    audio, t0 = [], time.perf_counter()
    for i, part in enumerate(parts, 1):
        clip = np.asarray(synth(part, i), dtype=np.float32).reshape(-1)
        if lufs is not None and len(clip) > sample_rate * 0.5:
            loudness = meter.integrated_loudness(clip.astype(np.float64))
            if np.isfinite(loudness):
                clip = clip * float(10 ** ((lufs - loudness) / 20))
        print(f"[{i}/{len(parts)}] {len(clip) / sample_rate:.1f}s  {part[:60]}", file=sys.stderr)
        audio += [clip, gap]
    gen_seconds = time.perf_counter() - t0
    wav = np.concatenate(audio[:-1])
    peak = float(np.abs(wav).max())
    if peak > 0.98:
        wav = wav * (0.98 / peak)
    sf.write(out, wav, sample_rate, subtype="PCM_16")
    if stats:
        write_stats(stats, load_seconds, gen_seconds, len(wav) / sample_rate, len(parts))
    print(out)


def write_stats(path, load_seconds, gen_seconds, audio_seconds, pieces):
    with open(path, "w") as f:
        json.dump({"load_s": None if load_seconds is None else round(load_seconds, 2),
                   "gen_s": round(gen_seconds, 2), "audio_s": round(audio_seconds, 2),
                   "pieces": pieces, "x_realtime": round(audio_seconds / gen_seconds, 2)}, f)
