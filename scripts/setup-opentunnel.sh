#!/usr/bin/env bash
# One-time (re-runnable) setup of the opentunnel shelf on this machine: a
# loopback-only static server for the tunnel artifacts, run as a systemd user
# service, and an opentunnel route pointing its hostname at that server.
# Re-run after moving this checkout: the service runs tunnel-server.ts in place.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$HOME/.local/bin:$PATH"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"

echo "==> Installing tunnel-artifacts.service..."
mkdir -p "$UNIT_DIR"
cat > "$UNIT_DIR/tunnel-artifacts.service" <<UNIT
[Unit]
Description=Static server for opentunnel artifacts (127.0.0.1:8081)

[Service]
ExecStart=$(command -v bun) run $SCRIPT_DIR/tunnel-server.ts
Restart=on-failure

[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload
systemctl --user enable tunnel-artifacts.service
systemctl --user restart tunnel-artifacts.service

echo "==> Installing opentunnel and routing it to 127.0.0.1:8081..."
command -v opentunnel >/dev/null || curl -fsSL https://opentunnel.xyz/install | sh
opentunnel route add @ 127.0.0.1:8081
opentunnel status
