"""Speak a long text with Kokoro-82M, a few sentences at a time, as one wav.

  $TTS_LAB_HOME/kokoro/.venv/bin/python kokoro/say.py --file script.txt --voice am_michael out.wav

Same pieces and same per-piece stderr line as ../say.py and chatterbox/say.py.
The voice's first letter picks the accent (a = American, b = British).
"""
import argparse
import os
import sys
import time
from pathlib import Path

if "cuda" in os.environ.get("LD_LIBRARY_PATH", ""):  # see orpheus/generate.py
    env = dict(os.environ)
    del env["LD_LIBRARY_PATH"]
    os.execve(sys.executable, [sys.executable, *sys.argv], env)

HERE = Path(__file__).resolve().parent
LAB = Path(os.environ.get("TTS_LAB_HOME") or HERE.parent)
os.environ.setdefault("HF_HOME", str(LAB / "hf-cache"))
sys.path.insert(0, str(HERE.parent))
import narrate  # noqa: E402

SAMPLE_RATE = 24000


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("out", help="output path, .wav")
    ap.add_argument("--file", required=True, help="read the text from this file")
    ap.add_argument("--voice", default="am_michael", help="e.g. af_heart, am_michael, bm_george")
    ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument("--device", default="cuda", choices=["cuda", "cpu"])
    ap.add_argument("--lufs", type=float, default=-20)
    ap.add_argument("--stats", help="write load/generation timings to this JSON file")
    a = ap.parse_args()

    parts = narrate.chunks(Path(a.file).read_text())
    if not parts:
        sys.exit("no text to speak")
    t0 = time.perf_counter()
    import numpy as np
    from kokoro import KPipeline
    pipe = KPipeline(lang_code=a.voice[0], repo_id="hexgrad/Kokoro-82M", device=a.device)
    pipe.load_voice(a.voice)
    load_seconds = time.perf_counter() - t0

    def synth(part, i):
        return np.concatenate([r.audio.cpu().numpy()
                               for r in pipe(part, voice=a.voice, speed=a.speed, split_pattern=None)])

    narrate.speak(parts, synth, SAMPLE_RATE, a.out, a.lufs, a.stats, load_seconds)


if __name__ == "__main__":
    main()
