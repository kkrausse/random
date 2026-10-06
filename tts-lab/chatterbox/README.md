# Chatterbox samples

Resemble AI's Chatterbox (`chatterbox-tts` 0.1.7): the standard English model
(`exaggeration` / `cfg_weight` knobs) and Chatterbox Turbo (inline `[tag]`
paralinguistics, no exaggeration/cfg).

## Setup

See ../README.md for setup. Then:

```sh
export HF_HOME=$TTS_LAB_HOME/hf-cache
PY=$TTS_LAB_HOME/chatterbox/.venv/bin/python
```

`setuptools==80.9.0` had to be added to it: the `perth` watermarker imports
`pkg_resources`, and without it `ChatterboxTTS(...)` dies with
`TypeError: 'NoneType' object is not callable`.

## Reproduce everything

Run from the `tts-lab` directory:

```sh
bash chatterbox/render_all.sh          # 9 mp3s into site/audio/, then verify.py
$PY chatterbox/build_manifest.py       # site/audio/chatterbox.json
```

## One-off renders

```sh
# built-in voice
$PY chatterbox/generate.py --text "Hello there." --exaggeration 0.75 --cfg 0.4 --seed 4 --out out.mp3

# cloned voice (any >5 s clean clip)
$PY chatterbox/generate.py --text-file chatterbox/work/plain.txt \
  --ref chatterbox/refs/libri84f.flac --exaggeration 0.75 --cfg 0.4 --seed 1 --lufs -20 --out out.mp3

# Turbo with tags
$PY chatterbox/generate.py --turbo --text "You made it! [laugh] Wait... [gasp] is that the dog?" --out out.mp3
```

Flags: `--text` | `--text-file`, `--ref`, `--exaggeration`, `--cfg`,
`--temperature`, `--seed`, `--out` (.wav or .mp3 at 96k), `--turbo`,
`--lufs` (loudness-normalize), `--meta` (append the JSON summary line).

Turbo tags (from the model's `added_tokens.json`): `[laugh]` `[chuckle]`
`[sigh]` `[gasp]` `[cough]` `[clear throat]` `[sniff]` `[groan]` `[shush]`
`[crying]` `[whispering]` `[angry]` `[happy]` `[fear]` `[surprised]`
`[sarcastic]` `[dramatic]` `[narration]` `[advertisement]`.

## Checking output

```sh
$PY chatterbox/verify.py --text-file chatterbox/work/plain.txt site/audio/chatterbox-*.mp3
```

Flags duration outside 12-30 s, silence, abrupt endings, and a Whisper
(`small.en`) transcript that differs from the passage.

## Notes

- All samples are normalized to -20 LUFS; Turbo is otherwise ~10 dB quieter.
- The built-in voice talks fast and gets faster with exaggeration: at 0.75 and
  1.0 most seeds finish the 55-word passage in 10.7-11.9 s. The seeds in
  `render_all.sh` are the ones that landed above 12 s. Cloned voices pace
  normally (14-17 s).
- Reference clips and their license: `refs/SOURCES.md`; re-fetch with
  `fetch_refs.py`.
