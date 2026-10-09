# Synced transcript page

Notes, template and scripts for turning a foreign-language YouTube video into
a dark-mode reading page on the opentunnel shelf: English translation on top,
faded original captions below, the original audio playing with word-by-word
highlighting. Not a skill; read this when asked to do it again.

Output: one page plus `audio.m4a`, published with `deploy-artifact.sh --tunnel`.
Worked example: https://zu4tgfuxau5n.opentunnel.xyz/artifacts/antirez-automatic-programming/
(antirez, Italian, 23 min, built 2026-10-08). Its captions and translation are
not in this repo; the published `index.html` on the shelf
(`~/devfs/tunnel-artifacts/artifacts/antirez-automatic-programming/`) holds both.

## What the page is

- Dark mode. Each ~20 s passage is a row: timestamp, English in bright text,
  then the raw original-language captions in faded italic underneath.
- A slim bar fixed to the bottom: play/pause, speed button, clock, seek slider,
  `follow` (auto-scroll to the current passage) and `original` (hide the faded text).
- While playing, the current passage gets a left accent bar. The original
  lights up word by word from the caption timings; the English sweeps through
  the passage at an even pace, so it is approximate by design.
- Space plays/pauses, left/right arrows skip 10 s, tapping a timestamp jumps.

Things the user rejected, do not bring back:

- Anything large pinned to the top. The first version had a sticky video
  player and it was the first thing removed. The 48 px bottom bar is fine.
- A YouTube embed as the player. See gotchas.

## Steps

All paths below are relative to this directory. Use a work dir outside
the repo (the job tmp dir); captions, translation and audio are per-video and
are not committed.

1. Fetch captions and audio:

   ```sh
   scripts/fetch.sh <youtube-url> <work> <lang>     # lang = it, de, ja ...
   ```

   Leaves `<work>/captions.json3` and `<work>/site/audio.m4a`.

2. Print the passages and translate them yourself:

   ```sh
   bun scripts/build.ts chunks <work>/captions.json3
   ```

   Write `<work>/en.json`: a JSON array with exactly one English string per
   passage, same order. Passages cut mid-sentence; translate each passage as
   cut, so the English stays beside the words it covers. Translate by meaning:
   the auto-captions mishear names and jargon (it wrote "Socolreria" for
   "Sokol libreria"), and the English should read correctly anyway.

3. Build, publish, check:

   ```sh
   bun scripts/build.ts page --captions <work>/captions.json3 --en <work>/en.json \
     --title "<English title>" --byline "<Author> · <original title>" \
     --url "https://www.youtube.com/watch?v=<id>" --lang <lang> --out <work>/site
   ../scripts/deploy-artifact.sh --tunnel <work>/site <slug>
   bun scripts/check.ts "<published-url>#autoplay" <work>/shot.png
   ```

   `check.ts` plays the page muted in headless Chrome and prints the state
   three times. Pass means `paused:false`, `t` advancing, `on` moving to a
   later passage, and `itSaid`/`enSaid` growing. Read the screenshot too.

## Gotchas, each one hit while building the example

- **Captions change between downloads.** YouTube served two different
  `it-orig` tracks an hour apart (one lowercase, one punctuated) with passage
  starts shifted by a few seconds. `en.json` only lines up with the exact
  `captions.json3` it was written against. Download once and never re-fetch
  captions after the translation exists.
- **Never deploy a directory that failed to build.** Republishing a slug
  replaces it; an empty site dir wiped the live page once. Chain the deploy
  behind the build with `&&`.
- **`yt-dlp --print` implies simulate.** Without `--no-simulate` it writes no
  subtitle file and still exits 0.
- **Audio formats.** The plain https audio formats return 403 from diesel2;
  the HLS (`m3u8`) ones download. Videos can carry auto-dubbed tracks, so the
  format selector pins the language. The HLS result is raw ADTS with no seek
  index; `fetch.sh` re-encodes to mono 64k m4a with `+faststart`, about
  0.5 MB per minute.
- **Why not embed YouTube.** The shelf sends `Referrer-Policy: no-referrer`
  (`scripts/tunnel-server.ts`), and YouTube's player refuses to run without a
  referrer. A hand-written iframe can carry
  `referrerpolicy="strict-origin-when-cross-origin"`, but a player created by
  the IFrame API script loads before that attribute can be set and renders
  black. The user also asked for the audio track specifically.
- **The media element is a `<video>` tag** playing the audio file, 2 px wide in
  the bar. Speed-up browser extensions attach to `<video>` and often skip
  `<audio>`. Highlighting reads `currentTime`, so any playback rate stays in
  sync, and the speed button listens for `ratechange` so it shows a rate set
  by an extension.
- **Keyboard handler** ignores events whose target is an input or button, and
  bar controls blur after a click, so space does not double-toggle and the
  seek slider keeps its own arrow keys.
- **Headless screenshots** taken with `chrome --screenshot` during playback
  came out blank; `check.ts` drives Chrome over the debugging port instead.
- **Not tested:** Brave, phones, and a real speed-up extension.
