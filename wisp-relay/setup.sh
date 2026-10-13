#!/usr/bin/env bash
# One-time (re-runnable) setup of the private Wisp relay on this machine (diesel2):
# server.ts as the `wisp-relay` systemd user service on loopback, and a Tailscale
# Serve route that puts the tailnet's https (so wss://) in front of it. Tailnet only:
# never Funnel, never opentunnel.
# Re-run after moving this checkout: the service runs server.ts in place.
set -euo pipefail

DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-4805}"
# Pages allowed to use the relay (server.ts, WISP_ORIGINS): the opentunnel shelf
# agent-studio is published on, anything served from the tailnet, and local dev pages.
ORIGINS="${WISP_ORIGINS:-https://zu4tgfuxau5n.opentunnel.xyz *.guineafowl-truck.ts.net localhost 127.0.0.1}"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
BUN="$(command -v bun)"

echo "==> Installing dependencies..."
(cd "$DIR" && "$BUN" install --frozen-lockfile)

echo "==> Installing wisp-relay.service..."
mkdir -p "$UNIT_DIR"
cat > "$UNIT_DIR/wisp-relay.service" <<UNIT
[Unit]
Description=Private Wisp relay (127.0.0.1:$PORT, tailnet wss :$PORT)

[Service]
Type=simple
WorkingDirectory=$DIR
ExecStart=$BUN server.ts
Environment=HOST=127.0.0.1
Environment=PORT=$PORT
Environment="WISP_ORIGINS=$ORIGINS"
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload
systemctl --user enable wisp-relay.service
systemctl --user restart wisp-relay.service

echo "==> Routing tailnet https :$PORT to 127.0.0.1:$PORT (Tailscale Serve, tailnet only)..."
sudo tailscale serve --bg --https="$PORT" "$PORT"
tailscale serve status | grep -A1 ":$PORT "

NAME="$(tailscale status --json | "$BUN" -e 'console.log(JSON.parse(await Bun.stdin.text()).Self.DNSName.replace(/\.$/, ""))')"
echo "==> Relay: wss://$NAME:$PORT/"
echo "    Check: bun $DIR/verify.ts wss://$NAME:$PORT/"
