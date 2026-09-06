# Bun Web Terminal

A loopback-only web terminal using tmux for session state, Bun's native PTY API for attachments, and the WebGL2 renderer from the `ghostty-web` `xterm-webgl` branch.

Requires Bun 1.3.5 or newer and tmux 3.3 or newer on macOS or Linux. On macOS, install tmux with `brew install tmux`.

```sh
git submodule update --init vendor/ghostty-web
bun install
bun run dev
```

Open <http://127.0.0.1:3000/sessions>. Sessions keep running when the browser disconnects. The effective local Ghostty palette and font are loaded with `ghostty +show-config --default` at startup.

Terminal pages reconnect automatically after network interruptions or a suspended tab. Use the connection indicator in the top-right corner to force a fresh attachment and redraw.

## Phone controls

- Tap the terminal to click in a mouse-aware application. The click is sent only when you lift your finger without dragging. Swipe vertically to scroll the application or tmux history; gestures use the same wheel encoding and sensitivity as desktop scrolling. A small movement threshold distinguishes taps from drags, and lifting your finger stops scrolling.
- A horizontally scrollable extra-keys bar appears on touch devices and narrow windows: **Keyboard**, **Esc**, **Tab**, one-shot **Ctrl**, arrows, **Paste**, **Select**, and **Copy**. Tap **Ctrl**, then a letter (for example **C** to interrupt or **U** to clear the shell input). **Keyboard** explicitly opens/closes the software keyboard; terminal taps and extra keys leave keyboard focus alone. Touch devices do not autofocus on page load.
- Tap **Select**, then drag across visible terminal text and tap **Copy**. Toggle **Select** off to resume swipe scrolling. Selection gestures stay local instead of clicking the running application.
- **Paste** uses the browser clipboard and the terminal's bracketed-paste handling. It needs HTTPS (or localhost) and browser clipboard permission; use the phone keyboard's paste action if access is unavailable.
- The terminal fits the visible viewport above the software keyboard and sends the updated dimensions to tmux. The existing engine handles mobile text/composition input with autocorrect and capitalization disabled.

For a phone check, open the Tailscale HTTPS URL below, try swiping inside a mouse-aware application, open/close the keyboard and rotate the phone, then try **Ctrl+C**, selection/copy, and paste. Actual software-keyboard behavior should be checked on the target phone; desktop touch-event simulation cannot fully reproduce it.

Compact light-blue notices in the top-right show connection status and confirm successful browser selection copies with a brief “Copied” toast. Copy failures show an error instead; application-owned clipboard operations do not trigger this toast.

## Session behavior

- The sessions menu and terminal tab favicon recognize Emacs (including `emacsclient`) and show its bundled logo, and recognize OpenCode (including `opencode2` and `OC | …` titles) with a text `OC` badge.
- Sessions created from a phone or tablet browser (detected via user-agent) are named `web-<uuid>-phone`; API clients can pass `{"label":"phone"}` for the same suffix.

- **Rename** in the sessions menu changes the tmux session name. Names are separate from the short tmux ID used for URLs and attachments, so renaming preserves links and running processes. Names must be unique on the tmux server and contain 1–128 characters without dots, colons, or control characters.

- Uses your standard tmux server and configuration. Existing sessions appear automatically; new browser-created sessions are named `web-<uuid>`, with their status bar hidden and mouse support enabled. Global options and key bindings are left to your tmux configuration.
- Refreshing or reconnecting attaches a fresh PTY to the same running application. tmux redraws the current screen and negotiates terminal modes; the browser never replays a truncated output log or historical terminal queries.
- One tab per Bun instance controls a session at a time. Opening it elsewhere detaches the previous tab, which shows **Take over** instead of repeatedly reconnecting. Native tmux clients can remain attached alongside the browser.
- Sessions survive browser disconnections, Bun shutdowns, and code reloads. Startup discovers existing sessions, and the list refreshes every two seconds. Terminal URLs use tmux session IDs, so renaming a session keeps its URL working while the tmux server lives. Removing a session in the browser kills that tmux session. Machine reboots or killing tmux still end the processes.
- Sessions created by the older isolated-server version are not automatically migrated; that older running Bun process still ends them on shutdown.
- Resizing settles for 150 ms in the browser and is coalesced again at the PTY. Output is delivered in batches of at most 32 KiB, with at most 128 KiB awaiting browser acknowledgment and 512 KiB queued. A stalled attachment is dropped and restored from tmux rather than accumulating unlimited work.
- Scrolling runs at 50% sensitivity and accumulates fractional trackpad deltas. Shell history and copy-mode bindings follow your tmux configuration; with mouse support enabled, scrolling up enters copy mode. Applications with mouse support receive normalized wheel input.
- **Ctrl+V** reaches the application, including Emacs. Use **Cmd+V** on macOS or **Ctrl+Shift+V** on other platforms to paste.
- Drag normally to highlight text at the shell or in applications without mouse support; **Cmd+C** copies it and the highlight stays after release. Mouse-aware applications automatically receive clicks and drags instead. Hold **Shift** while dragging to force local highlighting in those applications. The server checks the inner tmux pane's mouse modes every 150 ms while attached, so switching may take a moment. tmux copy mode also uses local highlighting. Auto-copy is disabled; toggle `copyOnSelect` in `src/client.ts` to enable it. Scrolling still goes through tmux.

The browser terminal and tmux negotiate their own capabilities; programs inside tmux use your configured `default-terminal`. Ghostty-web remains the rendering/input engine, so engine-specific keyboard or rendering limitations can still be investigated independently.

## Development and stress checks

```sh
bun run typecheck
bun run test
```

Tests use isolated tmux servers and the same Ghostty WASM as the browser. They cover live application state across SessionManager shutdown/recreation, existing-session discovery, renames/removal, alternate-screen reattachment, 300 coalesced resize requests, tab takeover, output acknowledgments/stalls, and fractional scrolling.

To test alongside a manually used instance on port 3000, use a separate port **and build directory**:

```sh
PORT=3107 TERMINAL_DIST="$(mktemp -d)" bun start
```

Open `http://127.0.0.1:3107/sessions`, start `btop`, repeatedly resize the window, then click the connection indicator and reload the page. Confirm that btop remains usable and the same process survives. Open the same session URL in another tab to check takeover. Test shell history scrolling and application scrolling separately. Restart Bun or edit source under `dev` (`--watch`) and confirm that the browser reconnects to the same running application. Parallel app instances share the standard tmux sessions.

To expose it only to devices permitted by your tailnet policy, keep the app bound to its default loopback address and run Tailscale Serve in another terminal:

```sh
tailscale serve --bg 3000
tailscale serve status
```

Open the reported `https://<machine>.<tailnet>.ts.net/sessions` URL. Tailscale terminates HTTPS and proxies HTTP and WebSocket traffic to `127.0.0.1:3000`. Remove the Serve configuration with `tailscale serve reset`.

Environment variables:

- `PORT`: HTTP port, default `3000`
- `HOST`: bind address, default `127.0.0.1`; use `0.0.0.0` for LAN access
- `TERMINAL_CWD`: shell working directory, default is this repository's parent directory
- `TERMINAL_FONT`: browser terminal font stack, default `ui-monospace, SFMono-Regular, Menlo, Monaco, monospace`
- `TERMINAL_SCROLL_SENSITIVITY`: wheel scroll multiplier, default `0.5` (was `0.35`)
- `TERMINAL_DIST`: client build output directory, default `dist`; use a separate directory for parallel test instances
- `SHELL`: shell executable, default `/bin/zsh`

`HOST=0.0.0.0` exposes the terminal to the network without authentication. Every client that can reach the port receives direct access to the local shell, so only use it on a trusted network or behind an authenticated reverse proxy.

Tailscale Serve also grants direct shell access to every tailnet identity allowed to reach this machine and port. Restrict it with your tailnet access policy when the entire tailnet should not have access.

`vendor/ghostty-web` is a Git submodule pinned to the WebGL renderer branch. The app requests `rendererType: "webgl"` and shows an error instead of silently falling back to Canvas2D when WebGL2 is unavailable.
