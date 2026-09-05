# Bun Web Terminal

A loopback-only web terminal using Bun's native PTY API and the WebGL2 renderer from the `ghostty-web` `xterm-webgl` branch.

Requires Bun 1.3.5 or newer on macOS or Linux.

```sh
git submodule update --init vendor/ghostty-web
bun install
bun run dev
```

Open <http://127.0.0.1:3000/sessions>. Sessions keep running when the browser disconnects. The effective local Ghostty palette and font are loaded with `ghostty +show-config --default` at startup.

Terminal pages reconnect automatically after network interruptions or a suspended tab. Use the connection indicator in the top-right corner to force a fresh connection and redraw.

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
- `SHELL`: shell executable, default `/bin/zsh`

`HOST=0.0.0.0` exposes the terminal to the network without authentication. Every client that can reach the port receives direct access to the local shell, so only use it on a trusted network or behind an authenticated reverse proxy.

Tailscale Serve also grants direct shell access to every tailnet identity allowed to reach this machine and port. Restrict it with your tailnet access policy when the entire tailnet should not have access.

`vendor/ghostty-web` is a Git submodule pinned to the WebGL renderer branch. The app requests `rendererType: "webgl"` and shows an error instead of silently falling back to Canvas2D when WebGL2 is unavailable.
