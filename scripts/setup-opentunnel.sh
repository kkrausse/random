#!/usr/bin/env bash
# One-time (re-runnable) setup of the opentunnel front door for public
# artifacts: a loopback-only nginx server on the deploy host, and an opentunnel
# route pointing its hostname at that server. Prints the public URL.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
HOST="${DEPLOY_HOST:-lrpi}"

echo "==> Installing nginx server for the tunnel on $HOST..."
rsync -avz --rsync-path="sudo rsync" --chmod=F644 \
  "$SCRIPT_DIR/site/opentunnel-artifacts.nginx.conf" \
  "$HOST:/etc/nginx/conf.d/opentunnel-artifacts.conf"
ssh "$HOST" 'sudo nginx -t && sudo systemctl reload nginx'

echo "==> Installing opentunnel and routing it to 127.0.0.1:8081..."
ssh "$HOST" 'bash -s' <<'REMOTE'
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
command -v opentunnel >/dev/null || curl -fsSL https://opentunnel.xyz/install | sh
# The service is a systemd user unit; linger keeps it running across reboots
# without anyone logged in.
sudo loginctl enable-linger "$(id -un)"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
opentunnel route add @ 127.0.0.1:8081
opentunnel status
REMOTE
