"""Speak a long text with Piper (CPU), a few sentences at a time, as one wav.

  $TTS_LAB_HOME/piper/.venv/bin/python piper/say.py --file script.txt --voice en_US-ryan-high out.wav

Same pieces and same per-piece stderr line as ../say.py and chatterbox/say.py.
Voices are .onnx files in $TTS_LAB_HOME/piper/voices; fetch one with
  $TTS_LAB_HOME/piper/.venv/bin/python -m piper.download_voices en_US-ryan-high \
      --data-dir $TTS_LAB_HOME/piper/voices
"""
import argparse
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
LAB = Path(os.environ.get("TTS_LAB_HOME") or HERE.parent)
sys.path.insert(0, str(HERE.parent))
import narrate  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("out", help="output path, .wav")
    ap.add_argument("--file", required=True, help="read the text from this file")
    ap.add_argument("--voice", default="en_US-ryan-high")
    ap.add_argument("--length-scale", type=float, default=1.0, help="above 1 is slower speech")
    ap.add_argument("--lufs", type=float, default=-20)
    ap.add_argument("--stats", help="write load/generation timings to this JSON file")
    a = ap.parse_args()

    parts = narrate.chunks(Path(a.file).read_text())
    if not parts:
        sys.exit("no text to speak")
    t0 = time.perf_counter()
    import numpy as np
    from piper import PiperVoice, SynthesisConfig
    voice = PiperVoice.load(LAB / "piper/voices" / f"{a.voice}.onnx")
    config = SynthesisConfig(length_scale=a.length_scale)
    load_seconds = time.perf_counter() - t0

    def synth(part, i):
        return np.concatenate([c.audio_float_array for c in voice.synthesize(part, config)])

    narrate.speak(parts, synth, voice.config.sample_rate, a.out, a.lufs, a.stats, load_seconds)


if __name__ == "__main__":
    main()
