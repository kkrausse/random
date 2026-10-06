"""Print duration, level and median pitch for audio files (sanity checks for
reference clips and rendered samples).

  python -I chatterbox/inspect_audio.py file1.wav file2.mp3 ...
"""
import json
import sys

import librosa
import numpy as np

for path in sys.argv[1:]:
    y, sr = librosa.load(path, sr=16000, mono=True)
    f0, voiced, _ = librosa.pyin(y, fmin=60, fmax=400, sr=sr)
    hop = 320
    frames = y[: len(y) // hop * hop].reshape(-1, hop)
    db = 20 * np.log10(np.sqrt((frames**2).mean(axis=1)) + 1e-9)
    print(json.dumps({
        "file": path.split("/")[-1],
        "duration_s": round(len(y) / sr, 2),
        "f0_median_hz": round(float(np.nanmedian(f0)), 1),
        "voiced_frac": round(float(np.mean(voiced)), 2),
        "rms_db": round(float(20 * np.log10(np.sqrt((y**2).mean()) + 1e-9)), 1),
        "silent_frac": round(float((db < -50).mean()), 3),
        "tail_db": round(float(db[-3:].max()), 1),
    }))
