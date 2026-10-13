#!/usr/bin/env python3
"""Build narration/site/index.html from results.json, verify.json, parallel.json,
passage.txt and note.txt (the two-line note shown at the top).

  python3 narration/build_page.py
"""
import html
import json
import statistics
from pathlib import Path

HERE = Path(__file__).resolve().parent
ORDER = ["Chatterbox", "Chatterbox Turbo", "Kokoro-82M", "Kokoro-82M (CPU)", "F5-TTS v1", "Piper (CPU)", "Orpheus 3B"]
ABOUT = {
    "Chatterbox": "The current choice (baseline). 0.5B, clones a reference clip.",
    "Chatterbox Turbo": "Distilled Chatterbox, same reference clip. Already installed.",
    "Kokoro-82M": "New here. 82M parameters, fixed built-in voices, no cloning.",
    "Kokoro-82M (CPU)": "The same model with the GPU hidden.",
    "F5-TTS v1": "New here. Flow matching, clones a reference clip (first 7-9 s of the same LibriTTS-R clips).",
    "Piper (CPU)": "New here. Small per-voice models, CPU only.",
    "Orpheus 3B": "Already installed. Built-in voices; Q8 GGUF unless the row says otherwise.",
}
CSS = """
:root{color-scheme:dark;--bg:#0c0a09;--panel:#1c1917;--text:#f5f5f4;--muted:#a8a29e;--line:#2f2a27;--accent:#2dd4bf;--bad:#f87171}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:24px 16px 80px}
main{max-width:760px;margin:0 auto}
h1{font-size:1.45rem;margin:0 0 6px}
h2{font-size:1.15rem;margin:36px 0 2px;padding-top:18px;border-top:1px solid var(--line)}
p{margin:8px 0}.sub{color:var(--muted);font-size:.9rem}
.note{border:1px solid var(--line);border-left:3px solid var(--accent);background:var(--panel);border-radius:8px;padding:10px 14px;margin:14px 0;font-size:.95rem}
details{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:10px 14px;margin:14px 0}
details p{font-size:.95rem}summary{cursor:pointer}
.row{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin:10px 0}
.head{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:baseline}
.id{font:600 .95rem ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--accent);user-select:all;-webkit-user-select:all;padding:1px 6px;border:1px solid var(--line);border-radius:6px}
.voice{font-weight:600}.meta{color:var(--muted);font-size:.85rem}
.fail{color:var(--bad);font-weight:600;font-size:.85rem}
audio{width:100%;margin-top:8px;height:40px}
.scroll{overflow-x:auto;margin:12px 0}
table{border-collapse:collapse;font-size:.85rem;width:100%;min-width:560px}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-weight:500}td.n{font-variant-numeric:tabular-nums;white-space:nowrap}
"""


def load(name):
    p = HERE / name
    return json.loads(p.read_text()) if p.exists() else {}


def main():
    results, verify, parallel = load("results.json"), load("verify.json"), load("parallel.json")
    passage = (HERE / "passage.txt").read_text().strip()
    note = (HERE / "note.txt").read_text().strip() if (HERE / "note.txt").exists() else ""
    esc = html.escape
    out = ["<!doctype html><html lang=en><head><meta charset=utf-8>",
           "<meta name=viewport content='width=device-width, initial-scale=1'>",
           f"<title>TTS narration voices</title><style>{CSS}</style></head><body><main>",
           "<h1>Narration voices, one calm passage</h1>",
           f"<p class=sub>{len(passage.split())} words from the antirez talk, spoken by every voice with the film "
           "pipeline's own piece rule. Speed is seconds of audio per second of generation on the RTX 2080 Ti, "
           "model load excluded. To choose one, copy the green id.</p>"]
    if note:
        out.append("<div class=note>" + "<br>".join(esc(l) for l in note.splitlines() if l.strip()) + "</div>")
    out.append("<details open><summary>The passage</summary>"
               + "".join(f"<p>{esc(p)}</p>" for p in passage.split("\n\n")) + "</details>")

    by_model = {}
    for id, r in results.items():
        by_model.setdefault(r["model"], []).append((id, r))

    out.append("<h2>Measured on this machine</h2><div class=scroll><table><tr><th>Model</th><th>Speed</th>"
               "<th>Load</th><th>Peak VRAM</th><th>Several at once (total speed)</th></tr>")
    for model in ORDER:
        rows = [r for _, r in by_model.get(model, []) if "error" not in r and "quant" not in r["settings"]
                and "16 steps" not in r["settings"]]
        if not rows:
            continue
        par = []
        for id, _ in by_model[model]:
            for n, e in sorted(parallel.get(id, {}).items()):
                par.append(f"{n} at once: failed (out of memory)" if "error" in e else
                           f"{n} at once: {e['total_x']}x ({e['vram_mb_total'] / 1024:.1f} GB)")
        vram = max(r["vram_mb"] for r in rows)
        out.append(f"<tr><td>{esc(model)}</td><td class=n>{statistics.median(r['x_realtime'] for r in rows):.1f}x</td>"
                   f"<td class=n>{statistics.median(r['load_s'] for r in rows):.0f} s</td>"
                   f"<td class=n>{f'{vram / 1024:.1f} GB' if vram else 'none (CPU)'}</td>"
                   f"<td>{'<br>'.join(par) or 'not tried'}</td></tr>")
    out.append("</table></div><p class=sub>Speed is the median over that model's rows below; each row shows its own. "
               "VRAM is the process's peak in nvidia-smi. \"Several at once\" is that many separate processes "
               "speaking the passage together.</p>")

    for model in ORDER:
        if model not in by_model:
            continue
        out.append(f"<h2>{esc(model)}</h2><p class=sub>{esc(ABOUT[model])}</p>")
        for id, r in by_model[model]:
            v = verify.get(id, {})
            out.append(f"<div class=row><div class=head><span class=id>{esc(id)}</span>"
                       f"<span class=voice>{esc(r['voice'])}</span><span class=meta>{esc(r['settings'])}</span></div>")
            if "error" in r:
                out.append("<div class=fail>FAILED: did not render</div></div>")
                continue
            meta = f"{r['x_realtime']:.1f}x realtime · {r['audio_s']:.0f} s of audio in {r['gen_s']:.0f} s"
            if v:
                meta += f" · Whisper word error {v['wer'] * 100:.1f}%"
            if r.get("tries", 1) > 1:
                meta += f" · take {r['tries']}"
            out.append(f"<div class=meta>{meta}</div>")
            if v and not v["ok"]:
                out.append(f"<div class=fail>FAILED the check after {r.get('tries', 1)} take(s): {', '.join(v['bad'])}</div>")
            out.append(f"<audio controls preload=none src='audio/{esc(id)}.mp3'></audio></div>")
    out.append("</main></body></html>")
    (HERE / "site").mkdir(exist_ok=True)
    (HERE / "site/index.html").write_text("\n".join(out))
    print(HERE / "site/index.html")


if __name__ == "__main__":
    main()
