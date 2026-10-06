#!/usr/bin/env python
"""Orpheus TTS (canopylabs/orpheus-3b-0.1-ft) via a GGUF in llama-cpp-python + SNAC.

    python orpheus/generate.py --voice tara --text "Hello <laugh> there." --seed 1 --out out.mp3

Prompt format and token -> SNAC mapping follow the official reference code
(canopyai/Orpheus-TTS: orpheus_tts_pypi/orpheus_tts/{engine_class,decoder}.py).
"""
import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

# Some shells export LD_LIBRARY_PATH=/usr/local/cuda-12.3/lib64, which
# shadows the CUDA 12.4 libs bundled with torch and breaks `import torch`
# (undefined symbol __nvJitLinkComplete_12_4). Re-exec once without it.
if "cuda" in os.environ.get("LD_LIBRARY_PATH", ""):
    env = dict(os.environ)
    del env["LD_LIBRARY_PATH"]
    os.execve(sys.executable, [sys.executable, *sys.argv], env)

LAB = Path(os.environ.get("TTS_LAB_HOME") or Path(__file__).resolve().parent.parent)
os.environ.setdefault("HF_HOME", str(LAB / "hf-cache"))
DEFAULT_MODEL = LAB / "orpheus/models/orpheus-3b-0.1-ft-Q8_0.gguf"

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402
import torch  # noqa: E402

VOICES = ["tara", "leah", "jess", "leo", "dan", "mia", "zac", "zoe"]
SAMPLE_RATE = 24000

# Special token ids (Llama-3 vocab + Orpheus additions; <custom_token_N> = 128256 + N).
BOS = 128000
START_OF_HUMAN = 128259
END_OF_TEXT = 128009
END_OF_HUMAN = 128260
START_OF_AI = 128261
START_OF_SPEECH = 128257
END_OF_SPEECH = 128258
AUDIO_BASE = 128266  # <custom_token_10>; code = id - AUDIO_BASE - 4096 * (position % 7)


def load_llm(model_path=DEFAULT_MODEL, n_ctx=4096):
    from llama_cpp import Llama

    return Llama(model_path=str(model_path), n_gpu_layers=-1, n_ctx=n_ctx, verbose=False)


def load_snac(device="cuda"):
    from snac import SNAC

    return SNAC.from_pretrained("hubertsiuzdak/snac_24khz").eval().to(device)


def build_prompt(llm, voice, text):
    body = llm.tokenize(f"{voice}: {text}".encode(), add_bos=False, special=False)
    return [START_OF_HUMAN, BOS, *body, END_OF_TEXT, END_OF_HUMAN, START_OF_AI, START_OF_SPEECH]


def generate_codes(llm, voice, text, seed, max_tokens=3000, temperature=0.6, top_p=0.9,
                   repetition_penalty=1.1):
    """Returns (codes, hit_eos). codes is a flat list of SNAC codes, 7 per frame."""
    llm.set_seed(seed)
    codes, hit_eos, n = [], False, 0
    for tok in llm.generate(build_prompt(llm, voice, text), top_k=0, top_p=top_p,
                            temp=temperature, repeat_penalty=repetition_penalty):
        n += 1
        if tok == END_OF_SPEECH:
            hit_eos = True
            break
        if n > max_tokens:
            break
        code = tok - AUDIO_BASE - 4096 * (len(codes) % 7)
        if 0 <= code < 4096:  # reference decoder also silently drops out-of-position tokens
            codes.append(code)
    return codes, hit_eos


def decode_codes(snac, codes):
    """Flat 7-per-frame codes -> float32 mono waveform at 24 kHz."""
    frames = np.array(codes[: len(codes) // 7 * 7], dtype=np.int64).reshape(-1, 7)
    device = next(snac.parameters()).device
    layers = [frames[:, [0]], frames[:, [1, 4]], frames[:, [2, 3, 5, 6]]]
    layers = [torch.from_numpy(l.reshape(1, -1)).to(device) for l in layers]
    with torch.inference_mode():
        audio = snac.decode(layers)
    return audio.squeeze().float().cpu().numpy()


def write_audio(audio, out):
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.suffix == ".mp3":
        wav = out.with_suffix(".wav")
        sf.write(wav, audio, SAMPLE_RATE, subtype="PCM_16")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav), "-ac", "1",
                        "-b:a", "96k", str(out)], check=True)
        wav.unlink()
    else:
        sf.write(out, audio, SAMPLE_RATE, subtype="PCM_16")


def synthesize(llm, snac, voice, text, seed, out, **sampling):
    """Generate one clip and write it. Returns a small stats dict."""
    t0 = time.time()
    codes, hit_eos = generate_codes(llm, voice, text, seed, **sampling)
    audio = decode_codes(snac, codes)
    gen_seconds = time.time() - t0
    write_audio(audio, out)
    return {
        "duration_s": round(len(audio) / SAMPLE_RATE, 2),
        "gen_seconds": round(gen_seconds, 2),
        "hit_eos": hit_eos,
        "rms": round(float(np.sqrt(np.mean(audio**2))), 4),
        "tail_rms": round(float(np.sqrt(np.mean(audio[-SAMPLE_RATE // 2:] ** 2))), 4),
        "seed": seed,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--voice", default="tara", choices=VOICES)
    ap.add_argument("--text", required=True,
                    help="text to speak; may contain <laugh> <chuckle> <sigh> <cough> <sniffle> <groan> <yawn> <gasp>")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--out", required=True, help="output path, .mp3 or .wav")
    ap.add_argument("--model", default=str(DEFAULT_MODEL))
    ap.add_argument("--max-tokens", type=int, default=3000)
    ap.add_argument("--temperature", type=float, default=0.6)
    ap.add_argument("--top-p", type=float, default=0.9)
    ap.add_argument("--repetition-penalty", type=float, default=1.1)
    a = ap.parse_args()

    stats = synthesize(load_llm(a.model), load_snac(), a.voice, a.text, a.seed, a.out,
                       max_tokens=a.max_tokens, temperature=a.temperature, top_p=a.top_p,
                       repetition_penalty=a.repetition_penalty)
    print(json.dumps({"out": a.out, **stats}))


if __name__ == "__main__":
    main()
