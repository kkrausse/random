"""Speak a long text with F5-TTS in a cloned voice, a few sentences at a time, as one wav.

  $TTS_LAB_HOME/f5/.venv/bin/python f5/say.py --file script.txt \
      --ref chatterbox/refs/libri3000m.flac out.wav

Same pieces and same per-piece stderr line as ../say.py and chatterbox/say.py.
F5 needs the words of the reference clip: they are looked up in refs.json next
to this file (or pass --ref-text). --ref-seconds trims the clip: F5 speaks
(reference + new text) in one pass capped near 30 s, so a short reference
leaves room for a whole piece and is faster.
"""
import argparse
import json
import os
import sys
import tempfile
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


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("out", help="output path, .wav")
    ap.add_argument("--file", required=True, help="read the text from this file")
    ap.add_argument("--ref", required=True, help="reference clip to clone")
    ap.add_argument("--ref-text", help="words spoken in the (trimmed) reference; default: refs.json")
    ap.add_argument("--ref-seconds", type=float, help="use only this much of the reference; default: refs.json")
    ap.add_argument("--nfe", type=int, default=32, help="flow steps; 16 is about twice as fast")
    ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--lufs", type=float, default=-20)
    ap.add_argument("--stats", help="write load/generation timings to this JSON file")
    a = ap.parse_args()

    parts = narrate.chunks(Path(a.file).read_text())
    if not parts:
        sys.exit("no text to speak")
    known = json.loads((HERE / "refs.json").read_text()).get(Path(a.ref).name, {})
    ref_text = a.ref_text or known.get("text")
    ref_seconds = a.ref_seconds or (None if a.ref_text else known.get("seconds"))
    if not ref_text:
        sys.exit(f"no words known for {a.ref}: pass --ref-text (and --ref-seconds)")

    t0 = time.perf_counter()
    import soundfile as sf
    from f5_tts.api import F5TTS
    ref = a.ref
    if ref_seconds:
        wav, sr = sf.read(a.ref)
        ref = tempfile.NamedTemporaryFile(suffix=".wav", delete=False).name
        sf.write(ref, wav[: int(ref_seconds * sr)], sr)
    tts = F5TTS(model="F5TTS_v1_Base", device="cuda")
    load_seconds = time.perf_counter() - t0

    def synth(part, i):
        wav, _, _ = tts.infer(ref_file=ref, ref_text=ref_text, gen_text=part, nfe_step=a.nfe,
                              speed=a.speed, seed=a.seed + i, show_info=lambda *_: None,
                              progress=None)
        return wav

    narrate.speak(parts, synth, tts.target_sample_rate, a.out, a.lufs, a.stats, load_seconds)


if __name__ == "__main__":
    main()
