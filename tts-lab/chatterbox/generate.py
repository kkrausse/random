"""Render one Chatterbox (or Chatterbox Turbo) utterance.

  python chatterbox/generate.py --text "Hello there." --out out.mp3
  python chatterbox/generate.py --text-file t.txt --ref refs/voice.wav \
      --exaggeration 0.75 --cfg 0.4 --seed 1 --out out.mp3
  python chatterbox/generate.py --turbo --text "Oh no [sigh] fine." --out out.mp3

--out may end in .wav or .mp3 (mp3 goes through ffmpeg at 96k; the
intermediate wav is removed). A one-line JSON summary (duration, generation
time, peak VRAM, loudness stats) is printed to stdout and, with --meta,
appended to a JSONL file.

Turbo ignores --exaggeration/--cfg; its expressiveness comes from inline
paralinguistic tags such as [laugh] [chuckle] [sigh] [gasp] (see README).
"""
import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

LAB = Path(os.environ.get("TTS_LAB_HOME") or Path(__file__).resolve().parent.parent)
os.environ.setdefault("HF_HOME", str(LAB / "hf-cache"))

import numpy as np
import torch
import torchaudio


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--text", help="text to speak")
    g.add_argument("--text-file", help="read the text from this file instead")
    p.add_argument("--ref", help="reference clip to clone (wav/flac/mp3, >5 s); default = built-in voice")
    p.add_argument("--exaggeration", type=float, default=0.5, help="emotion intensity, 0.25-2 (standard model only)")
    p.add_argument("--cfg", type=float, default=0.5, help="cfg_weight; lower = slower, more deliberate pacing (standard only)")
    p.add_argument("--temperature", type=float, default=0.8)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--out", required=True, help="output path, .wav or .mp3")
    p.add_argument("--turbo", action="store_true", help="use Chatterbox Turbo (supports [tag] paralinguistics)")
    p.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    p.add_argument("--lufs", type=float, help="normalize output to this integrated loudness (e.g. -20); "
                   "Turbo renders ~10 dB quieter than the standard model otherwise")
    p.add_argument("--meta", help="append the JSON summary line to this file")
    return p.parse_args()


def load_model(turbo: bool, device: str):
    if turbo:
        from chatterbox.tts_turbo import ChatterboxTurboTTS
        return ChatterboxTurboTTS.from_pretrained(device=device)
    from chatterbox.tts import ChatterboxTTS
    return ChatterboxTTS.from_pretrained(device=device)


def audio_stats(wav: torch.Tensor, sr: int) -> dict:
    """Cheap sanity numbers: overall level, how much is silence, and whether
    the clip ends abruptly (speech still loud in the final 50 ms)."""
    x = wav.squeeze().numpy().astype(np.float64)
    hop = int(0.02 * sr)
    frames = x[: len(x) // hop * hop].reshape(-1, hop)
    db = 20 * np.log10(np.sqrt((frames**2).mean(axis=1)) + 1e-9)
    silent = db < -50
    # longest run of silent frames
    longest = run = 0
    for s in silent:
        run = run + 1 if s else 0
        longest = max(longest, run)
    return {
        "rms_db": round(float(20 * np.log10(np.sqrt((x**2).mean()) + 1e-9)), 1),
        "peak": round(float(np.abs(x).max()), 3),
        "silent_frac": round(float(silent.mean()), 3),
        "longest_silence_s": round(longest * 0.02, 2),
        "tail_db": round(float(db[-3:].max()), 1),
    }


def main() -> None:
    a = parse_args()
    text = a.text if a.text is not None else Path(a.text_file).read_text().strip()
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)

    model = load_model(a.turbo, a.device)

    torch.manual_seed(a.seed)
    np.random.seed(a.seed)
    if a.device == "cuda":
        torch.cuda.manual_seed_all(a.seed)
        torch.cuda.reset_peak_memory_stats()

    kwargs: dict = {"temperature": a.temperature}
    if a.ref:
        kwargs["audio_prompt_path"] = a.ref
    if not a.turbo:
        kwargs.update(exaggeration=a.exaggeration, cfg_weight=a.cfg)

    t0 = time.perf_counter()
    wav = model.generate(text, **kwargs)
    if a.device == "cuda":
        torch.cuda.synchronize()
    gen_seconds = time.perf_counter() - t0

    wav = wav.detach().cpu()
    if a.lufs is not None:
        import pyloudnorm
        mono = wav.squeeze().numpy().astype(np.float64)
        loudness = pyloudnorm.Meter(model.sr).integrated_loudness(mono)
        if np.isfinite(loudness):
            wav = wav * float(10 ** ((a.lufs - loudness) / 20))
    # The vocoder occasionally overshoots +/-1.0 (seen at high exaggeration);
    # scale down rather than let the encoder hard-clip.
    peak = float(wav.abs().max())
    if peak > 0.98:
        wav = wav * (0.98 / peak)
    wav_path = out.with_suffix(".wav")
    torchaudio.save(str(wav_path), wav, model.sr)
    if out.suffix == ".mp3":
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav_path),
             "-codec:a", "libmp3lame", "-b:a", "96k", str(out)],
            check=True,
        )
        wav_path.unlink()

    duration = wav.shape[-1] / model.sr
    summary = {
        "file": out.name,
        "model": "chatterbox-turbo" if a.turbo else "chatterbox",
        "ref": a.ref,
        "exaggeration": None if a.turbo else a.exaggeration,
        "cfg": None if a.turbo else a.cfg,
        "seed": a.seed,
        "duration_s": round(duration, 2),
        "gen_seconds": round(gen_seconds, 2),
        "rtf": round(gen_seconds / duration, 3),
        "vram_peak_mb": round(torch.cuda.max_memory_allocated() / 2**20) if a.device == "cuda" else None,
        "vram_reserved_mb": round(torch.cuda.max_memory_reserved() / 2**20) if a.device == "cuda" else None,
        **audio_stats(wav, model.sr),
        "text": text,
    }
    line = json.dumps(summary)
    print(line)
    if a.meta:
        with open(a.meta, "a") as f:
            f.write(line + "\n")


if __name__ == "__main__":
    sys.exit(main())
