# Voiceover video playbook

How to change the script, voice or visuals of a narrated psychopomp film and
get it published in minutes. Written after the first re-voice took ~90 minutes
when the real work is about ten.

## What things actually cost

| Step | Cost |
|---|---|
| Speech (Orpheus) | about realtime: an 80 s narration is ~2 min including checks |
| Still frames for every cue | ~40 s |
| Full 1080p60 render | ~4 s per second of film (80 s film: ~5–6 min) |
| Package + publish | under a minute |

So: script edit to published link is roughly ten minutes. If it is taking much
longer, something is looping that should not be.

## The loop

Everything for a scene is one command. For the Gromen film
(`scenes/gromen-certainty/` in the psychopomp checkout, see
`../psychopomp-scripts/README.md` for where that lives):

```sh
export CARGO_TARGET_DIR=<psychopomp checkout>/target   # reuse the build cache
scenes/gromen-certainty/build.sh --voice --stills      # check: regenerate changed lines, one PNG per cue
scenes/gromen-certainty/build.sh --voice --publish     # ship: render, package, publish privately
scenes/gromen-certainty/build.sh --publish --public    # same, on the public site
```

1. Edit `narration/script.json`. Per line: `text` is the caption, `say` is what
   is spoken, `lead`/`tail` are shouted sentences generated around the line and
   cut out, `gapAfter` is the pause, and `takes` groups lines into generations
   with a seed each.
2. `--voice --stills`. Only takes whose text or seed changed are regenerated;
   the rest come from `narration/takes/`. Look at the stills.
3. `--publish`. One full render, at the end, once.

Visual changes go in `src/main.rs`. Choreography is keyed to cue ids
(`c.at("crisis")`), never to absolute times, so narration can be re-timed
without touching it. Adding a line means adding a cue id in both places.

## Rules that keep it fast

- **Use the voice that was already picked.** Orpheus, dan, temperature 0.9
  (`./say` defaults). Do not re-run comparisons.
- **One generation per take, seed 1.** Re-roll only a take that fails the word
  check, by bumping that take's seed. Three seeds at most; after that simplify
  the line's wording. No audition rounds.
- **You cannot hear it, so do not try to judge it.** The word check and the
  loudness/pitch numbers in `take.json` are the whole test. Ship it and let a
  person listen.
- **Stills, not renders, while iterating.** `plan frame <plan> <seconds> out.png`
  for one frame; `plan render --range A..B` for a few seconds of motion.
- **Check on background jobs after ~15 minutes.** A job that has written no
  file for ten minutes is stuck; stop it and finish from what it left.
- **Split script and visuals** across two agents only when both are changing.
  Fix the cue ids and their order first; that is the contract between them.

## Writing for intensity

Orpheus has no emotion or volume setting. Delivery follows the text:

- Capitals, stacked `!!`, stretched vowels (`NOOOO`), and the sound tags
  `<gasp> <groan> <sigh> <laugh> <chuckle>`.
- For a line that must be shouted, generate shouting around it (`lead`, `tail`)
  and cut those out. A line generated cold starts calm.
- Keep the calm opening lines in one take so they sound like one performance;
  give each shouted line its own take.
- Do not run dynamic loudness normalization over the result; it flattens the
  build. `voice.py` masters with a rising gain instead.

## Gotchas on this machine

- The default `cargo` is too old for the psychopomp workspace: use
  `cargo +1.95.0` (build.sh does).
- Colour emoji and flags render in screen-space text (header, beat labels) but
  come out as white silhouettes inside diagram cards; flags there are drawn
  from shapes.
- Editing inside a shared git checkout from a background session is blocked;
  work in a git worktree and keep git commands plain and separate.

## Published versions

- Calm (Piper): https://kkrausse.com/artifacts/gromen-bondfire-continuous-20261005/
- Intense (Orpheus): https://kkrausse.com/artifacts/gromen-bondfire-intense-20261006/
- Gromen in the first person: https://kkrausse.com/artifacts/gromen-bondfire-certainty-20261006/
