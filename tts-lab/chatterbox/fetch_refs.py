"""Fetch candidate voice-reference clips from LibriTTS-R (dev-clean) via the
Hugging Face datasets-server rows API (no dataset download, no dataset code).

Usage:
  python -I chatterbox/fetch_refs.py index  <dl_dir>              # page the split, write index.json
  python -I chatterbox/fetch_refs.py fetch  <dl_dir> <spk> [n]    # download n candidate wavs for a speaker

Downloaded bytes are untrusted: they are only ever written to <dl_dir> and
later decoded as audio.
"""
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

DATASET = "mythicinfinity/libritts_r"
CONFIG, SPLIT = "clean", "dev.clean"
API = "https://datasets-server.huggingface.co/rows"
# ~8-15 s of read speech is roughly this many characters
MIN_CHARS, MAX_CHARS = 130, 230


def get_rows(offset: int, length: int = 100) -> dict:
    q = urllib.parse.urlencode(
        {"dataset": DATASET, "config": CONFIG, "split": SPLIT, "offset": offset, "length": length}
    )
    for attempt in range(6):
        try:
            with urllib.request.urlopen(f"{API}?{q}", timeout=60) as r:
                return json.load(r)
        except Exception as e:  # rate limits / transient 5xx
            print(f"  retry offset={offset}: {e}", file=sys.stderr)
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"failed at offset {offset}")


def build_index(dl: Path) -> None:
    out, offset, total = [], 0, None
    while total is None or offset < total:
        page = get_rows(offset)
        total = page["num_rows_total"]
        for r in page["rows"]:
            row = r["row"]
            n = len(row["text_normalized"])
            if MIN_CHARS <= n <= MAX_CHARS:
                out.append(
                    {"row_idx": r["row_idx"], "speaker": row["speaker_id"], "id": row["id"],
                     "chars": n, "text": row["text_normalized"]}
                )
        offset += 100
        print(f"{offset}/{total} candidates={len(out)}", file=sys.stderr)
    (dl / "index.json").write_text(json.dumps(out, indent=1))
    by_spk: dict[str, int] = {}
    for c in out:
        by_spk[c["speaker"]] = by_spk.get(c["speaker"], 0) + 1
    print(json.dumps(by_spk))


def fetch(dl: Path, speaker: str, n: int) -> None:
    index = json.loads((dl / "index.json").read_text())
    picks = [c for c in index if c["speaker"] == speaker][:n]
    for c in picks:
        row = get_rows(c["row_idx"], 1)["rows"][0]["row"]
        assert row["id"] == c["id"], (row["id"], c["id"])
        src = row["audio"][0]["src"]
        assert src.startswith("https://datasets-server.huggingface.co/"), src
        dst = dl / f"{c['id']}.wav"
        with urllib.request.urlopen(src, timeout=120) as r:
            dst.write_bytes(r.read())
        print(dst, c["chars"], c["text"][:80])


if __name__ == "__main__":
    cmd, dl = sys.argv[1], Path(sys.argv[2])
    dl.mkdir(parents=True, exist_ok=True)
    if cmd == "index":
        build_index(dl)
    else:
        fetch(dl, sys.argv[3], int(sys.argv[4]) if len(sys.argv) > 4 else 2)
