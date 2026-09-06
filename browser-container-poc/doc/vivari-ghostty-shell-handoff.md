# Handoff: xterm-first Vivari guest shell workspace

Updated 2026-09-06. The filename preserves the original planning link.

## Current user direction and completed slice

Retain xterm for a minimal UI. Prioritize usable guest shell workflows, backend
terminal ownership, concurrent shells and background processes. All commands run
in Vivari workers. A host PTY is not an acceptable substitute.

Implemented and qualified: four independently owned xterm shell tabs; a bounded
running-job table with one pipeline followed by `&`, `jobs`, `kill %N`, `fg %N`
(wait/interrupt only), and `exit`. Vite runs as a guest background job while a
second shell edits the shared React fixture; preview HMR preserves its document.
Stopping a shell kills its descendants without stopping sibling shells.

Read [setup](../vivari/README.md) and [qualification/evidence](vivari-shell-results.md)
before making claims. The result document records input, lifecycle, output and
resize coverage, including unsupported behavior.

## Ownership and source map

- `vivari/src/shell-sessions.ts`: per-session process/writer/consumer/xterm,
  ordered bounded pending input, bounded renderer backlog and transcript,
  selection, stop/close/restart. Four retained sessions maximum.
- `vivari/src/main.ts`, `vivari/index.html`: minimal shell controls; diagnostics
  outside guest terminals; existing command/demo and bridge slot remains usable.
- `vivari/patches/0001-sqlite.patch`: cumulative reviewed source patch, including
  guest `coreutils.js` running jobs and SDK `process.ts` output overflow handling.
  Runtime ARCHITECTURE/roadmap updates are included in that source patch.
- `vivari/scripts/shell-headless.mjs`, `process-output.test.ts`, `shell-browser.js`:
  focused checks and reproducible worker/browser scenario.

## Precise next gates

1. **Terminal contract:** guest dimensions and resize notifications; catchable
   signals; raw/cooked behavior; foreground ownership/process groups. Current
   kernel kill finalizes workers immediately, including when called with SIGINT;
   SIGSTOP/SIGCONT do not suspend/resume. Do not wire Ctrl+Z to that kill path.
2. **Editor/parser:** incremental escape parsing, Unicode grapheme widths,
   bracketed paste, quote-aware comments/escapes, expansion/globs, and broader
   background-list grammar. Current `fg` does not reopen background stdin.
3. **Transport:** worker-side output/input credits and bounds on all worker-side
   queues. Current SDK queue and UI bounds are explicit; browser MessagePort
   queues are not credit-controlled. No silent terminal-byte dropping/replay.
4. **Reload:** investigate persisted executable/symlink restoration (`vite: not
   found` after reload; reinstall repairs it). Processes intentionally die on
   reload; persistence is not tmux-like recovery.
5. **OpenCode TUI:** separately qualify its actual CLI renderer/native needs.
   Latest strict headless SDK/model evidence is `model-five-tools-3.log`: seven
   successful calls covering glob/grep/read/shell/edit, 25 text deltas, ordered
   failure→edit→passing unchanged test, execution success. This is not a TUI pass.

## Working constraints

- Other agents use this repo. Inspect changes/listeners; scope commits to your
  files. Keep concise progress updates to the parent and preserve its context.
- Read runtime AGENTS.md and ARCHITECTURE.md before runtime/protocol changes.
  Follow `build-runtime.ts` and reviewed patch export; never hand-edit bundles or
  installed packages. The build accepts the exact cumulative source patch.
- Browser interaction exclusively through the Bun-backed `browser-control` CLI.
  Existing `5192` runtime, active browser work and OPFS were preserved. Shell
  evidence uses isolated `http://127.0.0.1:5196/`, session `quiet-raven-809`.
- One persistent kernel per origin. Stop only owned jobs; no persistence reset.
  The isolated port is not allowed by the existing dev relay; this is expected.
- No further delegated agents were needed for this individual implementation.
