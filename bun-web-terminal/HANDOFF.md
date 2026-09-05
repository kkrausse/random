# Handoff: terminal refactor needs reassessment

## Latest user feedback / goal

User: “why tmux? this thing like slower and more blurry. but like pls handoff bc context is expensive”, then “continue pls”.

The tmux refactor below is implemented, but **the user reports a regression and questions the architecture**. Do not treat it as an accepted solution. This handoff was requested to continue in a fresh context. No further fix for latency or blur has been implemented.

## Working environment

- Project: `bun-web-terminal/` inside the shared `random` Git repo.
- Implementation commit: `26a1fba` — `Rework web terminal sessions around tmux attachment state`.
- Before that commit, this project's working tree was clean; unrelated projects have other agents' changes. Scope commits to your own paths; never stage everything.
- **Port 3000 is the user's manually used instance. Do not restart it, take over its sessions, or overwrite its build output.**
- Separate test instance on **3107**, PID **1037** at handoff time. Verify PID/port before stopping anything.
- Test launch command:
  ```sh
  PORT=3107 TERMINAL_DIST=/private/var/folders/t_/x48jtnps7n5_0g_pt9xpvbg00000gn/T/opencode/bun-web-terminal-dist bun src/server.ts
  ```
- Test sessions page: `http://127.0.0.1:3107/sessions`. A btop session was left running inside its isolated tmux server. Browser automation session was deleted after testing.
- Bun 1.4.0 and Homebrew tmux are installed here. Do not start the default dev server; use an isolated test instance when needed.

## Original symptoms and findings

The user recalled Emacs/OpenCode glitches but said initial use generally worked. Rapid repeated resizing in **btop** once made the browser page unresponsive; killing/reloading the page recovered it. They could not consistently reproduce corrupted state. Later they reported scrolling was much too fast.

Original architecture: Bun PTY per shell, Ghostty-web browser emulator, WebSocket transport. Server retained the first 64 KiB plus about the last 1 MiB of raw output and replayed them after browser reset.

Code-level issues found (not all reproduced live):
- Truncated output is not a terminal-state snapshot; omitted modes/escape sequences/resize history make replay invalid.
- Replayed terminal queries generated replies sent into the currently running application through `onData`.
- Multiple tabs resized one PTY and answered the same terminal queries.
- Browser had overlapping resize paths: FitAddon ResizeObserver debounce plus direct `window.resize -> fit + force render + send resize`.
- No output backpressure handling.
- Vendored Ctrl+V handling reserved it for browser paste, conflicting with Emacs.
- Vendored mouse wheel handling emitted one mouse report for every event, regardless of tiny trackpad deltas.
- `Terminal.reset()` frees/recreates WASM, while some helpers capture the old WASM instance. The new wrapper uses RIS (`ESC c`) in place instead.

## What the refactor changed

`26a1fba` includes:
- `src/sessions.ts`: isolated tmux server per Bun server process; shells inside tmux; fresh Bun PTY/tmux attachment per WebSocket. One active tab per session; previous attachment gets close code 4002 and explicit takeover UI. No raw history replay. Normal Bun server shutdown kills its tmux sessions.
- tmux config: no user config, no status bar or prefix, `TERM=tmux-256color` inside, RGB feature for outer xterm-256color, mouse enabled, history 10,000 lines, wheel copy-mode bindings one line per report, Escape exits copy mode. Title falls back to current process when still hostname.
- `src/output-flow.ts`: 8 ms batching; <=32 KiB/frame; <=128 KiB unacknowledged; <=512 KiB queued; disconnect stalled attachments after 10 seconds without acknowledgment progress or queue overflow.
- `src/connection.ts`: separate binary terminal bytes / JSON controls, fresh reset on ready, writes in rAF with an 8 ms loop budget, acknowledges parsed bytes, heartbeat/reconnect/takeover handling, no auto-connect while hidden.
- `src/client.ts`: one ResizeObserver with 150 ms debounce; server adds another 100 ms debounce. Removed manual force-render workarounds. Ctrl+V sends the control byte. Uses RIS rather than `terminal.reset()` on reattach.
- `src/scroll.ts`: 35% wheel sensitivity, fractional accumulation, up to 8 steps/event. Forwards normalized synthetic wheel events through Ghostty input handling. Shell history now uses tmux copy mode.
- `src/server.ts`: session orchestration delegates to manager; `TERMINAL_DIST` enables separate build output for test instances.
- `package.json`: dev changed from `--hot` to `--watch`; test script added. No npm dependencies changed. Vendor submodule unchanged.

## Why tmux, and why revisit it

The previous agent chose tmux because it already handles persistent terminal state and fresh redraws, avoiding a custom snapshot implementation. The user authorized a rework but did not specifically request tmux; the agent announced that choice while implementing it.

**This was a larger architecture change than the evidence required.** It changes protocol negotiation, mouse/history behavior, and adds another terminal-processing layer. Extra output batching/frame scheduling and resize debounces are additional potential sources of perceived latency. Do not claim tmux directly causes blur: no cause was measured.

Suggested next direction:
1. Briefly acknowledge the regression and favor a smaller direct-PTY fix unless evidence supports tmux.
2. Compare the current version with `26a1fba^` in isolated test ports/build directories. Avoid blind `git revert` of the whole commit: scrolling, resize, protocol separation, and reset fixes may be worth retaining independently.
3. Measure typing-to-paint latency and inspect canvas CSS dimensions vs backing dimensions, devicePixelRatio, browser zoom, font metrics, and final rows/columns. Check whether removing prior redraw/layout workarounds or changing scheduling caused a rendering regression. The Ghostty vendor renderer itself was not modified.
4. For a smaller session fix, consider keeping the existing browser emulator through transient disconnects and resuming a sequenced byte stream. A full page reload/history gap still needs an explicit recovery strategy; **do not restore arbitrary prefix+tail replay** or replay old queries into a live process.
5. Keep resize storm protection and fractional wheel accumulation, then test their feel rather than relying solely on throughput checks. Avoid stacking unnecessary buffering/debounce delays.

## Checks already performed (and limitations)

- `bun run typecheck` and `bun test src` passed: 4 tests, 19 assertions.
- `src/sessions.test.ts` uses actual isolated tmux/Bun PTYs plus the same Ghostty WASM and a deterministic full-screen fixture (`src/fixtures/tui.ts`). Checks preserved counter state on reattach, 300 resize requests coalesced into one, takeover, slow-reader disconnect/recovery, title fallback, deletion.
- Flow tests check ordering, window limits, invalid/late acknowledgments and overflow. Scroll tests check fractional accumulation, units, burst cap and direction/mode changes.
- Browser btop test on 3107: 180 rapid layout changes, then 24 distinct actual canvas resizes, reconnect, reload, two-tab takeover. No JS errors or browser long tasks >50 ms in the resize runs. Screenshots showed intact btop.
- Shell-history scrolling worked and Escape returned to live input. 100 synthetic 1-pixel wheel events became 2 binary input reports at the tested font size.
- **These checks did not measure input latency or compare sharpness against the old build. They do not contradict the user's reported slowdown/blur.**
- Ghostty WASM prints warnings for OSC 10/11 color queries and mode 7727 during tmux attachment; tests still pass. These remain emulator limitations to investigate only if relevant.

## Browser tooling / evidence

Load the browser-control skill before browser work. Installed global CLI 0.5.1 conflicts with the running relay 0.7.0; this worked:
```sh
bunx @opencode-ai/browser-control@latest execute '...'
```
Continue with the newly returned session ID. Do not restart the shared relay. Focus `#terminal` rather than `getByRole("textbox", {name:"Terminal input"})`, which matches both the container and textarea.

Tooling diagnostics are in `docs/browser-control-todo.md`.

Temporary screenshots from prior checks live under:
`/private/var/folders/t_/x48jtnps7n5_0g_pt9xpvbg00000gn/T/opencode/`

Files: `btop-before.png`, `btop-after-resize.png`, `btop-reattached.png`, `shell-scrolled.png`, `scroll-exit-check.png`, `btop-takeover.png`. They are reference evidence, not a sharpness comparison against the original version.
