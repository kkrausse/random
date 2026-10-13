# tts-lab

Local text-to-speech on an NVIDIA GPU, with emotional/expressive English as the
goal. Two models are set up, each with a reusable `generate.py`:

| Model | Voices | Emotion control | VRAM | Speed |
| --- | --- | --- | --- | --- |
| [Orpheus 3B](orpheus/README.md) | 8 built in | inline tags: `<laugh>` `<sigh>` `<gasp>` ... | ~5.5 GB | ~1.1x realtime |
| [Chatterbox](chatterbox/README.md) | cloned from a short clip | `--exaggeration` dial; Turbo variant reads `[laugh]`-style tags | ~4 GB | ~2x realtime (Turbo ~3.4x) |

Measured on an RTX 2080 Ti (11 GB).

Faster options for long calm narration, measured on one 172-word passage
(`narration/`, numbers in `narration/results.json` and `parallel.json`):

| Model | Voices | Speed | VRAM | Speak a long file |
| --- | --- | --- | --- | --- |
| Kokoro-82M | built in (`af_heart`, `am_michael`, `bm_george`, ...) | ~40x realtime (3x on CPU) | 1.2 GB | `kokoro/say.py` |
| F5-TTS v1 | cloned from a clip plus its words (`f5/refs.json`) | ~3.2x (7x at `--nfe 16`) | 2.2 GB | `f5/say.py` |
| Piper | one .onnx per voice, CPU | ~5.6x (high), ~30x (medium) | none | `piper/say.py` |
| Chatterbox Turbo | cloned from a clip | ~2.9x | 3.6 GB | `chatterbox/say.py --turbo` |

For comparison on the same passage: Chatterbox 1.5x, Orpheus 1.05x (1.4x on
the Q4_K_M quant, `./say --model`). Every `say.py` splits text by the same
rule (`narrate.py`) and prints the same `[3/14] 17.2s  first words` line per
piece on stderr.

Making or editing a narrated video with this? Read [PLAYBOOK.md](PLAYBOOK.md) first:
it is the fast path from a script edit to a published link.

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

```sh
# Kokoro (Python 3.12). transformers 5 does not import with torch 2.6.
uv venv --python 3.12 $TTS_LAB_HOME/kokoro/.venv
uv pip install --python $TTS_LAB_HOME/kokoro/.venv/bin/python "kokoro>=0.9.4" "transformers<5" \
  soundfile pyloudnorm torch==2.6.0 --extra-index-url https://download.pytorch.org/whl/cu124 \
  --index-strategy unsafe-best-match \
  "en_core_web_sm @ https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl"

# F5-TTS (Python 3.11). Its old `datasets` needs pyarrow below 21.
uv venv --python 3.11 $TTS_LAB_HOME/f5/.venv
uv pip install --python $TTS_LAB_HOME/f5/.venv/bin/python f5-tts pyloudnorm "pyarrow<21" \
  torch==2.6.0 torchaudio==2.6.0 --extra-index-url https://download.pytorch.org/whl/cu124 \
  --index-strategy unsafe-best-match

# Piper (Python 3.12, CPU), and its voices
uv venv --python 3.12 $TTS_LAB_HOME/piper/.venv
uv pip install --python $TTS_LAB_HOME/piper/.venv/bin/python piper-tts soundfile pyloudnorm numpy
$TTS_LAB_HOME/piper/.venv/bin/python -m piper.download_voices en_US-ryan-high en_US-lessac-high \
  en_GB-alan-medium --data-dir $TTS_LAB_HOME/piper/voices
```

These three were installed with exactly these commands on 2026-10-12. Kokoro
and F5 fetch their weights into `$TTS_LAB_HOME/hf-cache` on first run.

```sh
# speak a long text file (run from this directory)
$TTS_LAB_HOME/kokoro/.venv/bin/python kokoro/say.py --file script.txt --voice am_michael out.wav
$TTS_LAB_HOME/f5/.venv/bin/python f5/say.py --file script.txt --ref chatterbox/refs/libri3000m.flac out.wav
$TTS_LAB_HOME/piper/.venv/bin/python piper/say.py --file script.txt --voice en_US-ryan-high out.wav
$TTS_LAB_HOME/chatterbox/.venv/bin/python chatterbox/say.py --turbo --file script.txt \
  --ref chatterbox/refs/libri3000m.flac out.wav
```

The Orpheus weights are fetched with the command in `orpheus/README.md`;
Chatterbox downloads its own on first run.

## Use

`./say` speaks text with the chosen default (Orpheus, voice dan, temperature
0.9). Long text is split by sentence and joined, so it works for voiceovers:

```sh
./say "GET OUT! I said GET OUT!!" out.mp3
./say --file script.txt voiceover.mp3
./say --voice tara --temperature 0.6 "Calmer line. <sigh>" out.mp3
```

Orpheus has no emotion or volume setting. Intensity comes from the text
(capitals, stacked exclamation marks, stretched vowels) and from temperature;
0.9 is livelier than the 0.6 default but garbles some voices (tara did).

The per-model scripts underneath:

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
