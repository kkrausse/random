# Permanent Bondfire workspace

Upstream checkout: `/home/kkrausse/devfs/repos/kitlangton/psychopomp`.
This directory holds our local setup notes and Bondfire patches, not the
upstream project. Run the commands below from the upstream checkout.

This checkout was cloned from `/tmp/opencode/psychopomp` on 2026-10-06,
preserving the two local Bondfire commits. `origin` points to
`https://github.com/kitlangton/psychopomp.git`. Nothing has been pushed.

## Sources and published files

- `scenes/gromen/`: original explainer, shared narration generator and packaging.
- `scenes/gromen-continuous/`: continuous animation, narration script, timed cues,
  generated audio and packaging script.
- `/home/kkrausse/devfs/repos/kkrausse/reports/gromen-bondfire-continuous-20261005/`: published MP4, page, captions
  and source ZIP. The ZIP contains the scene files used by `reproduce.sh`.
- Published page: https://kkrausse.com/artifacts/gromen-bondfire-continuous-20261005/

The existing narration audio is tracked, so rendering does not require TTS.
Build caches and the temporary checkout's rendered outputs were not copied;
the published delivery files remain in `kkrausse/reports/`.

`patches/` contains the two local scene commits exported with `git format-patch`.
They are already present in the permanent checkout; do not apply them again
there. To restore them onto a fresh upstream clone at base `afce680`, use
`git am /path/to/psychopomp-scripts/patches/*.patch`.

## Existing narration (not upgraded)

Local Piper TTS, US English Lessac medium (`assets/lessac.onnx` and its JSON
configuration), running through ONNX Runtime. The model files were copied from
the temporary checkout. No paid speech API is used by these scene scripts.

Python packages: `piper-tts==1.8.0`, `onnxruntime==1.23.2`.
A fresh `.venv` has been installed at this location.

The continuous scene's `voice.py` reuses `scenes/gromen/voice.py`, applying it
to its own `narration/script.json`. Each sentence is synthesized separately,
then explicit `gapAfter` silence is appended. Sample counts determine the
sentence timestamps in `narration/timeline.json`; these drive the animation
and captions. FFmpeg normalizes the audio and encodes AAC.

Current speech settings: `length_scale=1.05` (slightly slower than default),
`noise_scale=0.5`, mono 22,050 Hz. The continuous script also has deliberate
1–6 second pauses between sentences.

To regenerate narration **when intentionally changing it**:

```sh
.venv/bin/python scenes/gromen-continuous/voice.py
cargo run -p psychopomp-gromen-continuous
```

Regeneration overwrites audio and timing files. A new voice or speaking rate
changes cue timing: regenerate the plan, review choreography/captions, and
render/package again. No narration, speed, or rendering changes were made
during this workspace migration.

To recreate the Python environment if needed:

```sh
uv venv .venv
uv pip install --python .venv/bin/python piper-tts==1.8.0 onnxruntime==1.23.2
```

Large local voice weights and `.venv/` are excluded through `.git/info/exclude`.
Keep the two model files with this workspace or obtain the same Lessac medium
voice again before regenerating narration.
