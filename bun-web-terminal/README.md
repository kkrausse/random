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

## Session behavior

- Each shell runs inside an isolated tmux server, with its status bar and prefix keys disabled. Your normal tmux server/configuration is independent.
- Refreshing or reconnecting attaches a fresh PTY to the same running application. tmux redraws the current screen and negotiates terminal modes; the browser never replays a truncated output log or historical terminal queries.
- One tab controls a session at a time. Opening it elsewhere detaches the previous tab, which shows **Take over** instead of repeatedly reconnecting.
- Sessions survive browser disconnections, but belong to this server process. A normal server shutdown/restart ends them. Existing sessions from the previous direct-PTY implementation cannot migrate into tmux. Finish those before restarting your existing server to pick up this version.
- Resizing settles for 150 ms in the browser and is coalesced again at the PTY. Output is delivered in batches of at most 32 KiB, with at most 128 KiB awaiting browser acknowledgment and 512 KiB queued. A stalled attachment is dropped and restored from tmux rather than accumulating unlimited work.
- Scrolling runs at 50% sensitivity and accumulates fractional trackpad deltas. Shell history lives in tmux (10,000 lines); scrolling up enters its copy mode, and **Escape** returns to live input. Applications with mouse support receive normalized wheel input.
- **Ctrl+V** reaches the application, including Emacs. Use **Cmd+V** on macOS or **Ctrl+Shift+V** on other platforms to paste.
- Drag to highlight and automatically copy terminal text; the highlight stays after release. **Cmd+C** copies the selection again. Hold **Alt** to send mouse clicks/drags to the application instead. Scrolling still goes through tmux.

The browser terminal and tmux negotiate their own capabilities; programs inside tmux use `TERM=tmux-256color`. Ghostty-web remains the rendering/input engine, so engine-specific keyboard or rendering limitations can still be investigated independently.

## Development and stress checks

```sh
bun run typecheck
bun test
```

Tests use an isolated tmux server and the same Ghostty WASM as the browser. They cover alternate-screen reattachment, live application state, 300 coalesced resize requests, tab takeover, output acknowledgments/stalls, and fractional scrolling.

To test alongside a manually used instance on port 3000, use a separate port **and build directory**:

```sh
PORT=3107 TERMINAL_DIST="$(mktemp -d)" bun start
```

Open `http://127.0.0.1:3107/sessions`, start `btop`, repeatedly resize the window, then click the connection indicator and reload the page. Confirm that btop remains usable and the same process survives. Open the same session URL in another tab to check takeover. Test shell history scrolling and application scrolling separately. The `dev` command uses process restarts (`--watch`), so source changes end that development instance's sessions.

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
