#!/usr/bin/env bash
# One-time (re-runnable) setup of agent-studio's diagnostics collector on this machine
# (diesel2): server.ts as the `agent-studio-diag` systemd user service on loopback, and a
# Tailscale Serve route that puts the tailnet's https in front of it. Tailnet only: never
# Funnel, never opentunnel. The same shape as ../wisp-relay.
# Re-run after moving this checkout: the service runs server.ts in place.
set -euo pipefail

DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-4806}"
# Pages allowed to post (server.ts, DIAG_ORIGINS): the opentunnel shelf agent-studio is
# published on, anything served from the tailnet, and local dev pages.
ORIGINS="${DIAG_ORIGINS:-https://zu4tgfuxau5n.opentunnel.xyz *.guineafowl-truck.ts.net localhost 127.0.0.1}"
DATA="${DIAG_DIR:-$HOME/devfs/cache/agent-studio-diag}"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
BUN="$(command -v bun)"

echo "==> Installing agent-studio-diag.service..."
mkdir -p "$UNIT_DIR" "$DATA"
cat > "$UNIT_DIR/agent-studio-diag.service" <<UNIT
[Unit]
Description=agent-studio diagnostics collector (127.0.0.1:$PORT, tailnet https :$PORT)

[Service]
Type=simple
WorkingDirectory=$DIR
ExecStart=$BUN server.ts
Environment=HOST=127.0.0.1
Environment=PORT=$PORT
Environment="DIAG_ORIGINS=$ORIGINS"
Environment=DIAG_DIR=$DATA
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload
systemctl --user enable agent-studio-diag.service
systemctl --user restart agent-studio-diag.service

echo "==> Routing tailnet https :$PORT to 127.0.0.1:$PORT (Tailscale Serve, tailnet only)..."
sudo tailscale serve --bg --https="$PORT" "$PORT"
tailscale serve status | grep -A1 ":$PORT "

NAME="$(tailscale status --json | "$BUN" -e 'console.log(JSON.parse(await Bun.stdin.text()).Self.DNSName.replace(/\.$/, ""))')"
echo "==> Collector: https://$NAME:$PORT/  (runs in $DATA)"
echo "    Read the newest run: bun $DIR/latest.ts --follow"
