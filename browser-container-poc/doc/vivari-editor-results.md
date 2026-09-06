# Vivari guest vi-style editor side quest

2026-09-06. **PASS: an existing JavaScript vi engine runs inside a Vivari guest
process, renders a full terminal screen in xterm, edits/saves guest files, and
quits back to the shell. Editing the shared React fixture triggers genuine Vite
HMR.** Recommend this as a narrowly qualified fallback/probe, not production Vim.

## Delivered and proven

- Engine: [`js-vim@0.4.2`](https://www.npmjs.com/package/js-vim), MIT, upstream
  gitHead `7250b5b4cbcc584454811012bcad5254162f7f0a`. Existing engine owns editing,
  search, undo, document state, cursor highlighting and screen layout.
- `vivari/probes/editor-sidequest/guest.cjs`: small guest-only fs/stdin/stdout
  adapter. Opens the argv filename; adds `:w`, `:q`, `:q!`, `:wq`; uses ANSI
  alternate screen and the engine's renderer. No DOM editor or host execution.
- `vivari/scripts/editor-sidequest-package.ts`: isolated temporary dependency
  install and Bun CJS bundle under ignored `.runtime/editor-sidequest/`. Eight
  dependencies are explicitly versioned. Override removes mauve's floating
  GitHub-master x256 dependency. Copies license/readme/package notices into
  generated `licenses/`, and retains the resolved lock and SHA-256 metadata.
- `vivari/scripts/editor-sidequest-browser.js`: actual browser keyboard scenario,
  guest filesystem assertions, xterm lifecycle and HMR/document-identity checks.
  Asset/initial probe-file delivery uses the SDK; edits are keyboard-driven in
  the guest editor. It never edits the host React fixture.

| Focused browser check | Result |
|---|---|
| Open `editor-sidequest.txt` from Shell 1 | PASS; xterm alternate buffer, real engine cursor/rendering |
| Keyboard `iREAL GUEST `, Escape, `:w` | PASS; guest file exactly `REAL GUEST before editor\n` |
| `:q`, then shell `cat` | PASS; normal buffer and prompt restored, guest cat reads saved bytes |
| Open `src/WelcomeCard.tsx`, `/Ready`, insert `Editor verified: `, `:w` | PASS; actual preview heading becomes `Editor verified: Ready for an agent edit` |
| Vite HMR | PASS; same iframe Document; Shell 2 Vite logs `/src/WelcomeCard.tsx` update |
| `u`, `:w`, `:q` | PASS; original source restored byte-for-byte, original heading, same Document, usable prompt |
| Screen after saving | PASS visual inspection; first source line retained, no status-newline-induced scroll |
| Packaging after final changes | PASS; eight pinned packages, bundle and notices generated |

The full scenario passed before and after the final screen-boundary fix. Browser
viewport was 2000×1153, terminal 186×19. Screenshots capture the editor; the JSON
contains the preview heading and identity evidence. No video was recorded.

## Live state and reproduction

**Preserve the active origin:** <http://127.0.0.1:5201/>, Browser Control session
**`gentle-panda-696`**. Shell 1 is idle; Shell 2 owns guest Vite job `%1` (PID 8).
Preview: <http://127.0.0.1:5201/preview/5173/>. Fixture is restored. The dedicated
text probe retains `REAL GUEST before editor`. Existing 5192/5196/5197 runtimes,
OPFS and jobs were not touched. Host Vite service for 5201 remains running.

Try in Shell 1:

```sh
node editor-sidequest.cjs src/WelcomeCard.tsx
# /Ready<Enter>, i, type text, Escape, :w<Enter>, :q<Enter>
```

For a fresh unused 5201 origin, from `browser-container-poc/vivari`:

```sh
bun scripts/editor-sidequest-package.ts
bun run dev --port 5201
```

Use the existing patched runtime selected by `.env`; this side quest does not
rebuild or modify it. Boot and mount fixture, open Shell 1, install dependencies
using the UI, then open Shell 2 and run `bun run dev &`. Wait for the preview.
From repo root, using that page's Browser Control session:

```sh
browser-control execute --session SESSION --file browser-container-poc/vivari/scripts/editor-sidequest-browser.js
```

The runner requires Shell 1 idle at its prompt and Shell 2's preview showing the
original heading. It replaces only its dedicated guest bundle/text fixture and
restores the React source through editor undo. On failure inspect before retry;
there is intentionally no unconditional overwrite/cleanup of a dirty editor.
The relay working directory can be repo root, `browser-container-poc`, or
`vivari`; another checkout can set `state.editorSidequestRoot` to its absolute
`browser-container-poc` directory. Isolated 5201 is outside the dev CLI relay
allowlist, so its recurring token CORS errors are expected.

Ignored local evidence under `doc/logs/vivari/`:

- `editor-sidequest-browser.json`: final complete report, saved file, HMR heading,
  original-byte restoration, document identity, shell tails and bundle metadata.
- `editor-sidequest-open-save.png`, `editor-sidequest-hmr.png`: native screenshots;
  final HMR screenshot visually inspected after the screen fix.
- Browser Control journal: `~/.browser-control/sessions/gentle-panda-696/journal.jsonl`.

Final tested bundle SHA-256:
`7229fa17eca1d54d877987c9ca3a1d1168c33c3187a117fc12fcd8c18ff38cb4`.
Guest process worker observed in this page: `process-worker-CgOjqImJ.js`.
Temporary source paths appear in Bun's generated comments, so rebuilding can
change the bundle hash even with identical version pins; metadata identifies the
exact tested artifact, not byte-reproducible packaging.

## Adaptations and compatibility audit

1. **Existing JavaScript engine is the smallest demonstrated approach.** Its
   [upstream terminal frontend](https://github.com/itsjoesullivan/js-vim-node)
   already connects `vim.view.getText()` to terminal output and implements fs
   commands. Its startup has `files = []` / TODO argv handling, and separate key
   and terminal packages. The bounded adapter uses the same engine API with argv
   open and explicit guest streams instead of importing that entire frontend.
2. **Published mauve fails even in ordinary Node-style execution:** its string
   formatter dereferences `document.getElementsById` when `window` is absent.
   Packaging changes that one source condition to select its existing ANSI/Node
   branch. No fake document or window global is injected into Vivari.
3. **x256 has an external `colors.json` load.** The first guest launch returned
   ENOENT because bundling retained a host-temp `__dirname` asset path. Packaging
   now inlines the original color table. This is an asset-loader adaptation, not
   a runtime fs change. Versioned x256 replaces mauve's floating GitHub archive.
4. **Genuine Vim WASM is not automatically a terminal guest command.**
   [`rhysd/vim.wasm`](https://github.com/rhysd/vim.wasm)'s documented architecture
   is a GUI frontend: DOM keydown records through SharedArrayBuffer, worker draw
   messages rendered on canvas, and Emscripten's separate filesystem. `:write`
   writes its memory FS; export/IndexedDB are separate paths. It would require
   terminal frontend/input and Vivari FS integration; merely spawning its worker
   would not prove editing the shared guest workspace in xterm. Source/docs audit
   only; this port was not executed here.
5. **Native Linux vi/Vim is not accepted evidence.** Vivari's JS/WASM guest does
   not become Linux simply by fetching an ELF editor. No native editor was
   substituted, and no claim of full Vim or POSIX PTY support follows from this pass.

## Qualified limits and requirements for the primary runtime owner

**No additional runtime patch was required for the demonstrated flow.** Current
guest fs, character delivery, stdout ANSI and inherited spawn geometry suffice
for a cooperative JavaScript editor that skips tty probing. This does not remove
the OpenCode TUI gates:

- **fd/TTY identity:** define stdin/stdout/stderr fd identity and `isTTY` for
  attached terminals versus pipes/redirection; make `tty.isatty`, `ReadStream`,
  `WriteStream`, dimensions and events agree. This adapter bypasses those probes.
- **Raw mode/foreground ownership:** implement shared terminal mode state and
  honor `setRawMode`. Shell currently normalizes CR and intercepts Ctrl+C rather
  than delivering all raw bytes. A raw child must receive control bytes; cooked
  foreground signal routing needs an explicit contract. Kernel ownership/process
  groups and PTY/device semantics remain a separate larger gate.
- **Input protocol:** this adapter intentionally handles ASCII, standalone Escape,
  Enter and DEL; it does not parse arrow escape sequences, bracketed paste, mouse,
  IME or modifier protocols. Arrow bytes can be interpreted as editing commands.
  A production frontend needs incremental escape decoding and grapheme/width
  behavior. Do not treat character-by-character JS input as canonical line mode.
- **Output/lifecycle:** full repaint on every engine change is sufficient for
  this small file, not a performance or sustained-flow qualification. Long lines,
  large files, wide characters and viewport scrolling remain unqualified. Adapter
  binds resize and SIGINT but this editor scenario does not qualify live resize,
  Ctrl+C, `:q!`, `:wq`, dirty quit, failed saves or reload recovery. Forced worker
  termination cannot execute alternate-screen/cursor restoration cleanup.
- **Engine maturity:** old js-vim is a partial vi reimplementation, not Vimscript,
  plugin, terminal-job or full Vim support. Its mauve dependency modifies String
  prototypes inside the process. Keep it process-isolated and bounded; don't
  import this bundle into the harness or OpenCode process. The status line can
  retain `:w` instead of a write notification; disk readback is the save proof.
- **Files:** existing UTF-8 file open only; save is ordinary synchronous guest
  `writeFileSync`, without atomic rename/conflict detection. Do not promote this
  result into crash durability, arbitrary binary preservation or new-file UX.

## Browser-control project todo / probe recovery

Browser Control CLI **0.7.0**, own session `gentle-panda-696`, only localhost 5201.
No browser-control transport defect or relay reset occurred. Keep these resolved
probe issues recorded so continuation does not repeat them:

- **Resolved ENOENT:** initial host `fs.readFileSync('browser-container-poc/...')`
  ran with relay cwd already `browser-container-poc`; expected asset read, actual
  ENOENT. Recovery used an absolute path; committed runner resolves supported
  roots and offers an explicit root override.
- **Resolved wait timeout:** an early runner matched an old `cat` transcript and
  typed the next launch while cat still owned stdin; only `Card.tsx` reached the
  later shell prompt. Expected alternate screen, actual `sh: Card.tsx: not found`,
  then `waitForFunction: Timeout 15000ms exceeded`. Recovery waited for a *new*
  cat readback plus prompt using a transcript offset; final scenario passes.
  This illustrates the runtime's foreground-input timing boundary, not dropped
  Browser Control keyboard events.
