# Vivari xterm-first shell qualification

2026-09-06. **Primary acceptance passed:** interactive guest shells share the
filesystem; real Vite runs as a background guest job while another shell edits
the React fixture and preview HMR updates without document replacement.

## What shipped

- Retained locked xterm **6.0.0** + addon-fit **0.11.0** (same-origin Vite assets).
  No Ghostty dependency or host executor. Vivari remains **1.0.0**, upstream
  `2629c71097238400c45aefa213ef61df4794c2b7`, plus the reviewed cumulative
  `vivari/patches/0001-sqlite.patch` source build.
- Four retained UI shells maximum. Each owns its worker-backed process, writer,
  output consumer, xterm and observer. Hidden terminals keep parsing output;
  selection does not replay historical bytes or restart processes. Stop/close
  kills only the owned subtree; restart waits for old process/output settlement.
- Guest `sh`: one pipeline followed by `&`; at most 32 retained jobs; `jobs`
  lists/reaps completion; `kill %N` terminates a job; `fg %N` waits/interrupts a
  running job; `exit` exits and kernel cleanup kills descendants. Defaults for
  `fg`/`kill` select the latest retained job. Compound background lists are
  rejected. Background jobs use a child `sh -c` ownership boundary.
- Input writes are serialized, pending input limited to 64 Ki UTF-16 code units
  (oversized input rejected as a whole). Renderer backlog and per-shell diagnostic
  transcript each capped at 256 Ki units; renderer overflow stops the shell
  explicitly. xterm scrollback is 5,000 lines. SDK unread output is capped at
  1 Mi units; overflow errors its stream and kills that process. Harness log is
  bounded to one million characters, outside shell output.

## Results

| Check | Result / exact coverage |
|---|---|
| Source patch/build | PASS, full pinned Rust/WASM + SDK build; no generated bundle edits |
| Upstream `verify-node.mjs` | PASS, full runtime/process/fs/shell/network suite |
| Focused `shell-headless.mjs` | PASS: two shells/shared files; `&`, jobs, fg/Ctrl+C; stopped writer; kill/reaping; quoted `&`; unsupported compound rejection; exit cleanup; sibling survival; Ctrl+D |
| SDK output overflow unit contract | PASS, 7 assertions: bounded queue, explicit error, own-process kill, sibling output, listener cleanup |
| `bun run build` | PASS, provider generation, npm packaging, TypeScript and production Vite build |
| Live basic shell | PASS: browser keyboard `pwd`; guest `ls`, Node, file write/read across shells |
| Editing | PASS: keyboard backspace, left arrow insertion, up/history re-execution, Tab `pw` → `pwd` |
| Unicode/paste | PASS for BMP `café` and two harmless newline commands via xterm `paste()`; bracketed-paste mode is **false** |
| Output | PASS: 1,000 ANSI-colored lines through LINE-999, then responsive input; no kernel diagnostics in shell transcript |
| Terminal-generated replies | PASS: DSR `ESC[6n` reply reaches foreground guest Node over the same input writer |
| Resize | PASS renderer-only: 186×19 → 69×14; DSR row changed 19→14. Guest stdout dimensions remained **80×24** |
| Foreground Ctrl+C | PASS: prompt returns, fixture child stops appending bytes, subsequent command succeeds |
| Vite + concurrent shell/HMR | PASS, repeated after final source build; final Vite 7.1.4 banner ready in 376 ms (not install/first-paint timing); second-shell guest Node edit and restoration preserve iframe Document |
| Stop/close isolation | PASS: stop Shell 2 leaves Vite HTTP alive; restart accepts commands. Stop Vite-owning Shell 1 gives preview HTTP **502** while sibling remains running. Close Shell 3 stops its timer child and removes its UI |
| Input/output caps live | PASS: >64 Ki input rejected, next command works; stalled SDK consumer errors at 1 Mi and exits **143**, sibling remains running |
| Existing harness slot | PASS alongside live shells: fixture `bun test` reports 2 pass, 0 fail, exit 0 (existing Bun shim also prints its `process.exit called` diagnostic) |
| CLI bridge on isolated origin | NOT ATTEMPTED: :5196 is outside existing relay allowlist; expected CORS rejection, existing :5192 runtime preserved |
| OpenCode TUI / mobile / IME | NOT ATTEMPTED |
| Linux/POSIX job control | UNSUPPORTED: no PTY, process groups, suspension/resume, catchable signals or terminal line discipline |

The initial normal source build failed because the shared bunx wasm-pack cache
was missing `yallist`. An isolated `TMPDIR` rebuilt the same pinned dependencies
and passed, without altering the shared cache. A TypeScript check caught an
optional stream-size callback argument; fixed and rebuilt successfully.
An expanded headless test initially sent its next command after child output but
before the shell prompt returned (the still-foreground child consumed it). The
fixture now waits for the prompt. Killed background jobs retain the kernel's
143/137 status instead of reporting a null child exit as successful completion.

## Reproduce

From `browser-container-poc/vivari`, with an unused :5196 origin:

```sh
bun install --frozen-lockfile
bun scripts/build-runtime.ts patched
bun test scripts/process-output.test.ts
bunx --package node-bin-darwin-arm64@24.18.0 node scripts/shell-headless.mjs
bun run build
bun run dev --port 5196
```

If the shared bunx cache has the missing-package failure, use an isolated cache
directory for the build, e.g. `TMPDIR="$(mktemp -d)" bun scripts/build-runtime.ts patched`.

Open **http://127.0.0.1:5196/**, boot, open two shells. In Shell 1:

```sh
bun install --frozen-lockfile
bun run dev &
jobs
```

Then from repo root, with your Browser Control session attached to that page:

```sh
browser-control execute --session SESSION --file browser-container-poc/vivari/scripts/shell-browser.js
```

The runner checks and restores `src/WelcomeCard.tsx`, creates dedicated
`shell-*` fixtures, and stops/restarts Shell 2. It leaves Vite and both shells
alive. It never clears OPFS. Only run it on your own isolated fixture/runtime.

## Evidence and final live state

- Browser Control **quiet-raven-809**, `http://127.0.0.1:5196/`; guest preview
  `http://127.0.0.1:5196/preview/5173/`. Existing :5192 page was not reloaded.
- Ignored local evidence under `doc/logs/vivari/`:
  `shell-browser-initial.json` (includes keyboard/resize/DSR, Vite stop 502, live
  SDK overflow); `shell-browser-ui.json` (paste/close and harness-slot checks);
  `shell-browser-final.json` (final reloaded source, HMR and xterm paste pass);
  `shell-vite-final.png` (visually inspected
  native screenshot showing shell tabs, background Vite/jobs/HMR and preview).
- `.runtime/patched-build.json` records patch and generated-asset SHA-256s;
  `shell-build.json` beside the evidence is its snapshot. Runtime workers:
  `kernel-worker-BFmQIWCQ.js`, `process-worker-D7-JlnGr.js`,
  `fs-worker-BDLnKstk.js`, `fetcher-worker-CxT7BEmg.js`.
- The final page leaves Shell 1 running Vite job `%1`, Shell 2 idle and usable,
  and the fixture restored. :5196 host Vite service remains available.

## Limits and next slice

1. **Signals are immediate worker termination.** `kernel.handleKill` finalizes
   the target subtree; SIGINT is not delivered to a guest handler. General
   SIGSTOP/SIGCONT are not implemented and must not be used for suspend/resume.
   `bg` errors explicitly. Ctrl+Z is not shell job suspension.
2. **Background stdin is EOF**, including after `fg`. `fg` is useful to wait for
   and interrupt a server, not to recover an interactive reader. Background output
   may visually interleave with the prompt; no asynchronous prompt redraw layer.
3. **Small shell language/editor.** No expansion/globs/subshell syntax; quoted
   comments and escapes retain upstream limitations. Escape parsing is chunk-local,
   cursor width counts UTF-16 rather than graphemes; split escape sequences,
   emoji/CJK editing and bracketed-paste wrappers are not qualified. Terminal
   render transport preserves strings/ANSI across chunks, but this does not fix
   the guest editor/parser. `exit` numeric validation is minimal.
4. **Bounds are not a credit protocol.** SDK and renderer pending queues are
   bounded; MessagePort/worker stdin queues and upstream shell editing/history
   remain outside those bounds. Sustained malicious output/input and many-process
   resource quotas need kernel/transport work. Foreground pipe/redirection error
   behavior is inherited, not newly qualified as POSIX-compliant.
5. **Reload needs reinstall in this runtime.** A persisted workspace's `vite`
   executable was not found after reload; guest reinstall repaired it. Bun still
   delegates installation to npm and rewrites the lock. OPFS file persistence is
   distinct from executable-link restoration and process survival.
6. **Next recommended backend slice:** a real terminal contract (dimensions,
   resize events, signal delivery, foreground ownership), followed by incremental
   input/editor parsing and worker-side flow control. Keep native PTY allocation
   and full OpenCode TUI compatibility as explicit gates.

Latest headless OpenCode evidence was read before implementation claims:
`model-five-tools-3.log` records seven successful official tools, 25 text deltas,
glob/grep/read/shell/edit, failing test→edit→passing unchanged test and SDK execution
success. This shell work does not rerun or promote that result into TUI support.
