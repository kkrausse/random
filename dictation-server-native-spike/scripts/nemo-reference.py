#!/usr/bin/env python3
"""Reference transcript and timings from the current Python/NeMo engine, fed the same way as the spikes.

Run with the Python server's venv:
  <main checkout>/dictation-server-linux/.venv/bin/python nemo-reference.py MODEL_DIR LATENCY_MS WAV...
SPIKE_REALTIME=1 delivers each 100 ms piece when a microphone would have produced it.
"""
import os
import sys
import time
import wave
from pathlib import Path

import numpy as np

start = time.monotonic()
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "dictation-server-linux"))
import server  # noqa: E402

engine = server.load_engine(Path(sys.argv[1]), int(sys.argv[2]))
print(f"ready_at_ms={(time.monotonic() - start) * 1000:.0f}")
for path in sys.argv[3:]:
    with wave.open(path) as reader:
        assert reader.getframerate() == 16000 and reader.getnchannels() == 1 and reader.getsampwidth() == 2
        audio = np.frombuffer(reader.readframes(reader.getnframes()), dtype="<i2").astype(np.float32) / 32768.0
    server.reset(engine)
    times = []
    opened = time.monotonic()
    for offset in range(0, len(audio), 1600):
        if os.environ.get("SPIKE_REALTIME"):
            time.sleep(max(0.0, (offset + 1600) / 16000 - (time.monotonic() - opened)))
        began = time.monotonic()
        partial = server.feed(engine, audio[offset:offset + 1600])
        if partial is not None:
            times.append((time.monotonic() - began) * 1000)
    print(f"file={path}")
    print(f"final={server.finish(engine)}")
    print(f"chunks={len(times)} chunk_median_ms={sorted(times)[len(times) // 2]:.1f} chunk_max_ms={max(times):.1f}")
