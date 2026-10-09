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

## Intense narration version (2026-10-06)

`scenes/gromen-intense/` re-voices the continuous film with Orpheus 3B (voice
dan, temperature 0.9) from `kkrausse/random/tts-lab`, building from level to
shouting. It reuses the continuous scene's choreography and only swaps the
narration and timing.

- Commit `ce60df7` on branch `gromen-intense`, in the worktree
  `/home/kkrausse/devfs/repos/kitlangton/psychopomp/.claude/worktrees/gromen-intense`.
  Not merged into the checkout's `main`. Exported as `patches/0003-*.patch`.
- Delivery files: `/home/kkrausse/devfs/repos/kkrausse/reports/gromen-bondfire-intense-20261006/`
- Published page: https://kkrausse.com/artifacts/gromen-bondfire-intense-20261006/

To change the performance, edit `narration/script.json` (`say` is what is
spoken, `lead`/`tail` are shouted around a line and cut out, `takes` sets the
seed per generation), then from that worktree:

```sh
TTS_LAB_DIR=/home/kkrausse/devfs/repos/kkrausse/random/tts-lab \
  $TTS_LAB_DIR/orpheus/.venv/bin/python scenes/gromen-intense/voice.py
cargo +1.95.0 run -p psychopomp-gromen-intense
cargo +1.95.0 run --release -- plan render scenes/gromen-intense/continuous.json output/raw.mp4 --theme neutral
python3 scenes/gromen-intense/package.py   # writes output/gromen-intense-public/
```

The render takes about five minutes. The default `cargo` on PATH (1.75) is too
old for this workspace, hence `+1.95.0`. Unused audition takes are kept in
`scenes/gromen-intense/narration/takes/` (gitignored).

## First-person Gromen version (2026-10-06)

`scenes/gromen-certainty/`: the narrator speaks as Gromen (phrases from the
Oct 2 Tree Rings issue), bondholders blow up in the finale, China's surplus
flows into gold. It has its own copy of the choreography and a one-command
build. This is the version to keep editing.

- Commit `7977c10` on branch `gromen-certainty` (built on `gromen-intense`), worktree
  `/home/kkrausse/devfs/repos/kitlangton/psychopomp/.claude/worktrees/gromen-certainty`.
  Not merged into `main`. Exported as `patches/0004-*.patch`.
- Delivery files: `/home/kkrausse/devfs/repos/kkrausse/reports/gromen-bondfire-certainty-20261006/`
- Published page: https://kkrausse.com/artifacts/gromen-bondfire-certainty-20261006/

Edit `narration/script.json` or `src/main.rs`, then from that worktree:

```sh
export CARGO_TARGET_DIR=/home/kkrausse/devfs/repos/kitlangton/psychopomp/target
scenes/gromen-certainty/build.sh --voice --stills      # ~1-3 min check
scenes/gromen-certainty/build.sh --voice --publish     # ~8 min, private; add --public for kkrausse.com
```

The full playbook (costs, rules that keep it fast, writing for intensity) is
`../tts-lab/PLAYBOOK.md`.

## The Only Exit, from a YouTube video (2026-10-08)

`scenes/gromen-inflate/`: a third-person, AI-narrated summary in our own words
of Luke Gromen's FFTT Q&A video "Does the Administration believe they can
inflate US debt to sustainability?" (recorded 2026-10-07,
https://www.youtube.com/watch?v=INgvg03agP8). Ten cues, about 91 s: the true
interest yardstick, 2020 to 2022 as proof, the four exits, Japan against the
USA, the strong-dollar doom loop, gold/silver/bitcoin. This is the scene to
copy for the next video.

- Commits `4ac0b17` and `bdf0f02` on branch `gromen-inflate` (built on
  `gromen-certainty`), worktree
  `/home/kkrausse/devfs/repos/kitlangton/psychopomp/.claude/worktrees/gromen-inflate`.
  Not merged into `main`. Exported as `patches/0005-*.patch` and `0006-*.patch`.
- Delivery files: `/home/kkrausse/devfs/repos/kkrausse/reports/gromen-inflate-20261008/`
- Published page (opentunnel shelf): https://zu4tgfuxau5n.opentunnel.xyz/artifacts/gromen-inflate-20261008/
- Transcript of the source video (local only, not published):
  `/home/kkrausse/devfs/repos/kkrausse/research_notes/gromen-2026-10-07-inflate-debt-transcript.txt`

From a link to a published film, using the two scripts in `../scripts/`:

```sh
../scripts/yt-transcript.ts 'https://www.youtube.com/watch?v=<id>'      # transcript path
# write narration/script.json and src/main.rs for a new scene, then:
../scripts/psychopomp-film.sh <scene> --voice --stills                  # check
../scripts/psychopomp-film.sh <scene> --voice --publish --tunnel        # ship to opentunnel
```

`build.sh --publish` takes `--private` (default), `--public` or `--tunnel`.
Keep one Orpheus take under about 30 s of speech: the seven calm lines as a
single 47 s take lost a sentence near the end on every seed, and splitting it
in two fixed that.
