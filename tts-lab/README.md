# tts-lab

Local text-to-speech on an NVIDIA GPU, with emotional/expressive English as the
goal. Two models are set up, each with a reusable `generate.py`:

| Model | Voices | Emotion control | VRAM | Speed |
| --- | --- | --- | --- | --- |
| [Orpheus 3B](orpheus/README.md) | 8 built in | inline tags: `<laugh>` `<sigh>` `<gasp>` ... | ~5.5 GB | ~1.1x realtime |
| [Chatterbox](chatterbox/README.md) | cloned from a short clip | `--exaggeration` dial; Turbo variant reads `[laugh]`-style tags | ~4 GB | ~2x realtime (Turbo ~3.4x) |

Measured on an RTX 2080 Ti (11 GB).

## Layout

Code lives here. The heavy parts (Python environments, model weights, the
Hugging Face cache) live under `$TTS_LAB_HOME`, which defaults to this directory
and is gitignored:

```
$TTS_LAB_HOME/orpheus/.venv       $TTS_LAB_HOME/orpheus/models/
$TTS_LAB_HOME/chatterbox/.venv    $TTS_LAB_HOME/hf-cache/
```

Set `TTS_LAB_HOME` to keep them on another disk.

## Setup

Needs `uv`, `ffmpeg`, and an NVIDIA driver new enough for CUDA 12.4. The
requirements files are a `uv pip freeze` of the environments that produced the
samples; the commands below are the intended way to rebuild them and have not
been re-run from scratch.

```sh
export TTS_LAB_HOME=${TTS_LAB_HOME:-$PWD}

# Orpheus (Python 3.12)
uv venv --python 3.12 $TTS_LAB_HOME/orpheus/.venv
uv pip install --python $TTS_LAB_HOME/orpheus/.venv/bin/python -r orpheus/requirements.txt \
  --extra-index-url https://download.pytorch.org/whl/cu124 \
  --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cu124 \
  --index-strategy unsafe-best-match

# Chatterbox (Python 3.11)
uv venv --python 3.11 $TTS_LAB_HOME/chatterbox/.venv
uv pip install --python $TTS_LAB_HOME/chatterbox/.venv/bin/python -r chatterbox/requirements.txt
```

The Orpheus weights are fetched with the command in `orpheus/README.md`;
Chatterbox downloads its own on first run.

## Use

```sh
$TTS_LAB_HOME/orpheus/.venv/bin/python orpheus/generate.py \
  --voice tara --text "You made it! <laugh> Come inside." --out out.mp3

$TTS_LAB_HOME/chatterbox/.venv/bin/python chatterbox/generate.py \
  --ref chatterbox/refs/libri84f.flac --exaggeration 0.75 --cfg 0.4 \
  --text "You made it! Come inside." --out out.mp3
```

## Comparison page

`site/index.html` is a static page that lists every clip named in
`site/audio/*.json` and lets you mark one as the default. The clips themselves
are not committed; `orpheus/render_samples.py` and `chatterbox/render_all.sh`
regenerate them from `passage.md`.
