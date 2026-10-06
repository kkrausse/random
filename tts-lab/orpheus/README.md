# Orpheus TTS samples

Canopy Labs `orpheus-3b-0.1-ft` (English finetune), run as a Q8_0 GGUF in-process with
llama-cpp-python (CUDA, all layers offloaded) and decoded with the SNAC 24 kHz codec.

## Where things live

| What | Path |
| --- | --- |
| venv (Python 3.12, torch 2.6.0+cu124, llama-cpp-python 0.3.36 cu124) | `$TTS_LAB_HOME/orpheus/.venv` |
| model, 3.5 GB, from `unsloth/orpheus-3b-0.1-ft-GGUF` | `$TTS_LAB_HOME/orpheus/models/orpheus-3b-0.1-ft-Q8_0.gguf` |
| SNAC decoder `hubertsiuzdak/snac_24khz` (HF cache) | `$TTS_LAB_HOME/hf-cache` |

## Run

From the `tts-lab` directory (see ../README.md for setup):

```sh
PY=$TTS_LAB_HOME/orpheus/.venv/bin/python

# one clip (.mp3 goes through ffmpeg at 96k mono, .wav is written directly)
$PY orpheus/generate.py --voice tara --seed 1 --out /tmp/hello.mp3 \
    --text "Hello there. <laugh> This is Orpheus."

# all eight comparison clips + site/audio/orpheus.json (text comes from passage.md)
$PY orpheus/render_samples.py
$PY orpheus/render_samples.py --only zoe-tagged leo-plain   # re-render a subset
```

Voices: tara, leah, jess, leo, dan, mia, zac, zoe.
Tags: `<laugh> <chuckle> <sigh> <cough> <sniffle> <groan> <yawn> <gasp>`.
Sampling defaults: temperature 0.6, top_p 0.9, repetition_penalty 1.1 (the model needs
>= 1.1 to stay stable), max 3000 new tokens (about 36 s; 7 tokens per 85 ms frame).

To fetch the model again:

```sh
HF_HOME=$TTS_LAB_HOME/hf-cache $PY -c "from huggingface_hub import hf_hub_download as d; \
d('unsloth/orpheus-3b-0.1-ft-GGUF','orpheus-3b-0.1-ft-Q8_0.gguf',local_dir='$TTS_LAB_HOME/orpheus/models')"
```

## Notes

- If the shell exports `LD_LIBRARY_PATH=/usr/local/cuda-12.3/lib64`, which breaks
  `import torch` in this venv (`undefined symbol: __nvJitLinkComplete_12_4`).
  `generate.py` re-execs itself without it; any other script using this venv needs
  `LD_LIBRARY_PATH=` in front.
- About 5.4-5.6 GB VRAM (Q8_0 weights + 4096-token context + SNAC), roughly 1.1x
  realtime on the RTX 2080 Ti.
- `render_samples.py` re-rolls a clip with the next seed if it never emitted the
  end-of-speech token, falls outside 12-30 s, or is near-silent.
- zoe: Whisper (small.en) transcribes every other clip word for word, but hears zoe's
  opening as "My god" rather than "Oh my god" on all six seeds tried. Its "My" spans
  0.5-0.7 s, so the "Oh" is probably spoken and merged, but it is worth a listen.
