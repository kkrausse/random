# Handoff: Ghostty-web shell spike in Vivari

Date: 2026-09-06

## User direction

**Next task: implement and qualify a Ghostty-web shell in the browser-native
Vivari POC.** The user reports that headless OpenCode has now been verified.
Inspect the latest runner and evidence before citing its precise coverage;
older checkpoint documents may describe an earlier milestone.

The long-term goal is a full terminal workspace: a user can start Vite, keep it
running, start OpenCode or another interactive harness, and run other commands
against the same guest filesystem. A browser chat panel is not the selected next
task. Full OpenCode TUI compatibility remains a later, explicit runtime gate.

This handoff contains planning only. No shell implementation or live browser
test was performed while writing it.

## Working constraints

- Other agents work in this repository. Inspect current changes and active
  services before editing or starting anything; scope changes and commits to
  your own files. Read applicable AGENTS.md instructions.
- Keep UI minimal and functional. Reuse existing controls where practical.
- Guest commands must execute in Vivari workers. A host Bun PTY/tmux server
  would not qualify this spike.
- Use Browser Control exclusively through the Bun-backed `browser-control` CLI;
  load its skill for live browser interaction. Use the existing `vv` bridge for
  routine guest command/file operations where appropriate.
- Runtime changes must follow the reproducible source-patch/build workflow in
  `../vivari/README.md`. Read the runtime's AGENTS.md and ARCHITECTURE.md before
  touching runtime/protocol/networking. Do not hand-edit generated bundles or
  installed packages.
- Preserve active browser jobs and OPFS state. Do not reload an occupied runtime
  or reset persistence to simplify testing. Coordinate or use an isolated test
  runtime/origin; check the one-kernel-per-origin ownership constraint.

## Starting points

Paths below are relative to the repository root:

| Path | Purpose |
| --- | --- |
| `browser-container-poc/vivari/src/main.ts` | Current xterm.js display, input forwarding, shell launch and process ownership. |
| `browser-container-poc/vivari/src/dev-bridge.ts` | Browser-side development bridge and operation ownership. |
| `browser-container-poc/vivari/src/opencode.ts` | Existing OpenCode probe integration; inspect latest changes. |
| `browser-container-poc/vivari/README.md` | Setup, patched builds, bridge commands and compatibility qualifications. |
| `bun-web-terminal/README.md` | Ghostty renderer pin, desktop/mobile behavior and tmux-based session design. |
| `bun-web-terminal/src/client.ts` | Ghostty initialization, fit, renderer options and terminal setup. |
| `bun-web-terminal/src/mobile.ts` | Touch/extra-key controls; review dependencies before reuse. |
| `bun-web-terminal/src/connection.ts` | Existing transport implementation; coupled to server/session protocol. |
| `bun-web-terminal/src/output-flow.ts` | Bounded-output ideas; current recovery depends on tmux. |
| `bun-web-terminal/vendor/ghostty-web` | Pinned Git submodule, `xterm-webgl` branch implementation. |

Read the latest OpenCode/headless result documents as well. This handoff does not
supersede their evidence.

## Current architecture and known limits

At inspection time the POC used `@xterm/xterm` and `@xterm/addon-fit`:

```text
terminal.onData(data) -> proc.input.getWriter().write(data)
proc.output          -> terminal.write(chunk)
ResizeObserver       -> fit.fit()       [renderer only]
```

The public Vivari process transport exposes string input, merged stdout/stderr,
exit and kill. The POC already qualified typed input reaching a guest Node
process and has an interactive `sh` with history and completion.

Important limitations to recheck against current source:

- No public process resize operation or native PTY allocation.
- Runtime stdin is a flowing Readable and reports `isTTY: true`.
  `setRawMode` records a flag; it does not implement a cooked/raw line discipline.
- The shell implements its own line editing and foreground Ctrl+C handling.
  General TTY/job-control semantics are not established by this behavior.
- The harness has one active command/input target and the bridge allows one
  foreground operation, including an open shell. That is a harness constraint
  to inspect, not proof the runtime can only run one process.
- Harness diagnostics and guest output currently share the terminal. Give the
  shell a dedicated output stream so diagnostics cannot corrupt application
  screen state.
- OPFS/session recovery does not imply that processes survive page reload.

The existing Bun web terminal is architecturally different:

```text
Ghostty-web <-> WebSocket <-> host Bun native PTY <-> tmux <-> application
```

The desired spike is:

```text
Ghostty-web <-> browser/worker adapter <-> Vivari guest sh/process
```

Ghostty-web has an xterm-compatible JavaScript API; that makes renderer reuse
plausible, not a guarantee of complete API or terminal-protocol compatibility.
Reuse its pinned renderer setup. Record how its JS/WASM assets are delivered
reproducibly and same-origin under COOP/COEP. Avoid copying the whole native
server or introducing a second untracked vendor tree.

## Suggested implementation sequence

### 1. Connect the renderer to the existing shell

- Inspect the current submodule pin and Ghostty initialization in
  `bun-web-terminal`; use its actual exported APIs, not assumed xterm APIs.
- Mount a minimal Ghostty terminal using the existing WebGL renderer setup.
- Connect real guest shell output and ordered input. Forward terminal-generated
  replies as well as human keystrokes through the input channel.
- Handle startup, shell exit, stop, errors, focus and disposal explicitly.
- Preserve Unicode and ANSI sequences across chunks. Review newline handling:
  the old display uses `convertEol: true`; avoid accidental double conversion.
- Fit the visible terminal, while clearly recording whether the guest also
  receives dimensions. Do not claim guest resize support from a visual fit.
- Keep logs/status outside guest output. Keep buffering bounded and avoid
  unbounded per-keystroke pending writes or concurrent writes with unclear order.

### 2. Qualify basic interactive behavior

Use a dedicated fixture and real visible browser, with retained evidence:

1. Boot and open a guest `sh`; run `pwd`, `ls`, and a guest Node command.
2. Create/read a small fixture file through that shell to prove guest execution
   and shared workspace access.
3. Exercise typing, backspace, arrows/history, Tab completion, and Unicode.
4. Exercise multiline paste and document the actual bracketed-paste behavior.
   Use harmless fixture commands; determine whether support lives in the shell
   or renderer before fixing it.
5. Interrupt a foreground command with Ctrl+C and successfully run another
   command at the returned prompt. Check that the child actually stopped.
6. Exercise shell EOF/exit behavior supported by the current implementation;
   verify the UI reports exit and can start a new shell cleanly.
7. Generate enough colored/multiline output to exercise scrolling and buffering;
   confirm input remains responsive and the final output is present.
8. Resize the pane and test a small terminal-query/dimension probe. Record
   renderer behavior separately from guest dimensions/resize notifications.
9. Verify relevant existing harness/bridge operations still work after the shell
   exits. Follow existing typecheck/build scripts and run focused tests for any
   runtime or transport changes.

Desktop checks are the first gate. Reuse mobile controls selectively if useful;
phone keyboard/IME behavior needs a real-device check before claiming support.

### 3. Prove or precisely bound the concurrent-workflow step

The next meaningful user scenario is:

```text
shell A: start the fixture's Vite server
shell B: run commands and edit a fixture file
preview: observe the edit through HMR while Vite stays alive
```

If a small shell-session registry/two-terminal UI is sufficient, include that
proof in the spike. Each shell should own its process, writer, output consumer
and cleanup; switching focus must not kill the other process. Verify stopping
one session does not stop the other, and clean up owned child processes.

This proves concurrent terminal sessions, not POSIX `command &`, `jobs`, `fg`,
`bg`, Ctrl+Z or process-group semantics. Inspect the current shell before trying
those. If achieving concurrency requires a substantial runtime redesign, finish
the basic renderer gate and leave a concrete follow-up with exact blockers.

## Long-term terminal roadmap

The intended destination is a real interactive workspace, including OpenCode's
TUI or another harness. Track these independently:

1. **Terminal session ownership:** multiple guest processes, input routing,
   bounded output, close/kill semantics, and UI detach/reattach while the runtime
   remains alive.
2. **Guest terminal contract:** spawn with terminal dimensions, resize updates,
   TTY stream behavior, raw/cooked semantics, terminal capability negotiation,
   signals and foreground-job ownership. Implement compatible behavior rather
   than success-returning stubs.
3. **Shell background jobs:** inspect and qualify background execution, job
   listing, foreground/background transitions, and process groups as needed.
4. **OpenCode CLI/TUI bring-up:** pin the actual CLI, audit its renderer/native
   dependencies, and require explicit initialization/render/input checkpoints.
   Headless SDK success does not establish CLI/TUI execution. OpenCode's child
   PTY features are an additional backend requirement.
5. **Recovery:** distinguish component remount, transport reconnect and full page
   reload. The old Bun app gets redraw/session survival from tmux. Vivari needs
   an explicit design; replaying a truncated output log is not reliable terminal
   reconstruction and can replay historical terminal queries.

A possible future terminal adapter surface is `write`, output subscription,
`resize`, exit subscription, kill and detach/dispose, with ownership semantics
documented. This is a design sketch, not an assertion that Vivari exposes these
operations today. Do not silently implement unsupported resize as a no-op.

## Expected handback

- Scoped implementation and commit(s), with exact renderer/runtime pins.
- Commands and URL needed to reproduce on an isolated runtime.
- A concise result table: passed, failed, and not attempted for the checks above.
- Browser evidence for a real guest shell and, if achieved, Vite plus a second
  shell sharing the workspace.
- Exact remaining terminal/runtime blockers and the recommended next slice.
- Updated setup/result documentation reflecting actual behavior, including any
  limitations introduced by renderer reuse or terminal ownership changes.

**Success for the first gate:** a usable Ghostty-web terminal driving the real
Vivari shell, with verified interactive input/output and lifecycle behavior.
The broader goal remains concurrent development processes and a full interactive
harness in that same browser-native workspace.
