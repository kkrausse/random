#!/usr/bin/env python3
"""Render the narration comparison: one passage, every voice, with timings.

  python3 narration/render.py                    # every sample not rendered yet
  python3 narration/render.py --only K-heart --force
  python3 narration/render.py --parallel 3 --only CB-3000m   # 3 copies at once -> parallel.json

Each sample is spoken by that model's say script (so the timing is the film
pipeline's: same pieces, model loaded once). Generation time excludes model
load; VRAM is the process's peak in nvidia-smi, polled while it runs.
Writes narration/site/audio/<id>.mp3 and narration/results.json.
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
CODE = HERE.parent
LAB = Path(os.environ.get("TTS_LAB_HOME") or CODE)
PASSAGE = HERE / "passage.txt"
AUDIO = HERE / "site/audio"
RESULTS = HERE / "results.json"
PARALLEL = HERE / "parallel.json"
REFS = CODE / "chatterbox/refs"
ORPHEUS_VOICES = ["tara", "leah", "jess", "leo", "dan", "mia", "zac", "zoe"]


def py(model):
    return str(LAB / model / ".venv/bin/python")


def samples():
    out = []

    def add(id, model, voice, settings, cmd):
        out.append({"id": id, "model": model, "voice": voice, "settings": settings, "cmd": cmd})

    cb = [py("chatterbox"), "chatterbox/say.py", "--file", str(PASSAGE)]
    add("CB-3000m", "Chatterbox", "libri3000m (cloned)", "exaggeration 0.75, cfg 0.4",
        cb + ["--ref", str(REFS / "libri3000m.flac")])
    add("CT-3000m", "Chatterbox Turbo", "libri3000m (cloned)", "defaults",
        cb + ["--turbo", "--ref", str(REFS / "libri3000m.flac")])
    for v in ["af_heart", "am_michael", "bm_george"]:
        add(f"K-{v[3:]}", "Kokoro-82M", v, "speed 1.0",
            [py("kokoro"), "kokoro/say.py", "--file", str(PASSAGE), "--voice", v])
    add("K-michael-cpu", "Kokoro-82M (CPU)", "am_michael", "speed 1.0, no GPU",
        [py("kokoro"), "kokoro/say.py", "--file", str(PASSAGE), "--voice", "am_michael", "--device", "cpu"])
    for r in ["libri3000m", "libri174m", "libri84f"]:
        add(f"F-{r[5:]}", "F5-TTS v1", f"{r} (cloned)", "32 steps",
            [py("f5"), "f5/say.py", "--file", str(PASSAGE), "--ref", str(REFS / f"{r}.flac")])
    add("F-3000m-16", "F5-TTS v1", "libri3000m (cloned)", "16 steps",
        [py("f5"), "f5/say.py", "--file", str(PASSAGE), "--ref", str(REFS / "libri3000m.flac"), "--nfe", "16"])
    for v in ["en_US-ryan-high", "en_US-lessac-high", "en_GB-alan-medium"]:
        add(f"P-{v.split('-')[1]}", "Piper (CPU)", v, "defaults",
            [py("piper"), "piper/say.py", "--file", str(PASSAGE), "--voice", v])
    orph = [py("orpheus"), "say.py", "--file", str(PASSAGE)]
    for v in ORPHEUS_VOICES:
        add(f"O-{v}-06", "Orpheus 3B", v, "temperature 0.6", orph + ["--voice", v, "--temperature", "0.6"])
    for v in ["dan", "leo"]:
        add(f"O-{v}-09", "Orpheus 3B", v, "temperature 0.9", orph + ["--voice", v, "--temperature", "0.9"])
    q4 = LAB / "orpheus/models/orpheus-3b-0.1-ft-Q4_K_M.gguf"
    add("O-leo-06-q4", "Orpheus 3B", "leo", "temperature 0.6, Q4_K_M quant",
        orph + ["--voice", "leo", "--temperature", "0.6", "--model", str(q4)])
    return out


def gpu_mb(pid):
    r = subprocess.run(["nvidia-smi", "--query-compute-apps=pid,used_memory", "--format=csv,noheader,nounits"],
                       capture_output=True, text=True)
    for line in r.stdout.splitlines():
        p, _, mb = line.partition(",")
        if p.strip() == str(pid):
            return int(mb)
    return 0


def run(sample, wav, seed=None):
    """Run one say script. Returns its stats plus wall time and peak VRAM."""
    stats = wav.with_suffix(".stats.json")
    cmd = sample["cmd"] + [str(wav), "--stats", str(stats)] + (["--seed", str(seed)] if seed is not None else [])
    env = {k: v for k, v in os.environ.items() if k != "LD_LIBRARY_PATH"}
    env["TTS_LAB_HOME"] = str(LAB)
    env["HF_HOME"] = str(LAB / "hf-cache")
    t0 = time.perf_counter()
    log = open(wav.with_suffix(".log"), "w")
    proc = subprocess.Popen(cmd, cwd=CODE, env=env, stdout=subprocess.DEVNULL, stderr=log)
    peak = 0
    while proc.poll() is None:
        peak = max(peak, gpu_mb(proc.pid))
        time.sleep(0.4)
    wall = time.perf_counter() - t0
    if proc.returncode != 0:
        return {"error": Path(log.name).read_text()[-600:], "wall_s": round(wall, 1)}
    return {**json.loads(stats.read_text()), "wall_s": round(wall, 1), "vram_mb": peak,
            "pieces_log": [l for l in Path(log.name).read_text().splitlines() if l.startswith("[")]}


def to_mp3(wav, mp3):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav), "-ac", "1", "-b:a", "96k", str(mp3)],
                   check=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--only", nargs="+", help="sample ids, or prefixes ending in '-' (K-, O-)")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--seed", type=int, help="pass this seed (re-roll)")
    ap.add_argument("--parallel", type=int, help="run this many copies of each chosen sample at once")
    ap.add_argument("--list", action="store_true")
    a = ap.parse_args()

    todo = [s for s in samples()
            if not a.only or any(s["id"] == o or (o.endswith("-") and s["id"].startswith(o)) for o in a.only)]
    if a.list:
        print("\n".join(f"{s['id']:14} {s['model']:18} {s['voice']:22} {s['settings']}" for s in todo))
        return
    AUDIO.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix="narration-", dir=os.environ.get("TMPDIR", "/tmp")))

    if a.parallel:
        done = json.loads(PARALLEL.read_text()) if PARALLEL.exists() else {}
        for s in todo:
            res = [None] * a.parallel
            threads = [threading.Thread(target=lambda i=i: res.__setitem__(i, run(s, work / f"{s['id']}-p{i}.wav")))
                       for i in range(a.parallel)]
            [t.start() for t in threads]
            [t.join() for t in threads]
            if any("error" in r for r in res):
                entry = {"error": next(r["error"] for r in res if "error" in r)}
            else:
                # the copies start together and load alike, so the slowest copy's
                # generation time is the wall time of the generation phase
                entry = {"each_x": [r["x_realtime"] for r in res],
                         "total_x": round(sum(r["audio_s"] for r in res) / max(r["gen_s"] for r in res), 2),
                         "vram_mb_total": sum(r["vram_mb"] for r in res)}
            done.setdefault(s["id"], {})[str(a.parallel)] = entry
            PARALLEL.write_text(json.dumps(done, indent=1))
            print(s["id"], a.parallel, json.dumps(entry)[:300], flush=True)
        return

    for s in todo:
        results = json.loads(RESULTS.read_text()) if RESULTS.exists() else {}
        if s["id"] in results and "error" not in results[s["id"]] and not a.force:
            continue
        r = run(s, work / f"{s['id']}.wav", a.seed)
        if "error" not in r:
            to_mp3(work / f"{s['id']}.wav", AUDIO / f"{s['id']}.mp3")
        tries = results.get(s["id"], {}).get("tries", 0) + 1
        results[s["id"]] = {k: s[k] for k in ("model", "voice", "settings")} | r | {"tries": tries, "seed": a.seed}
        RESULTS.write_text(json.dumps(results, indent=1))
        print(s["id"], {k: v for k, v in r.items() if k != "pieces_log"}, flush=True)


if __name__ == "__main__":
    main()
