#!/usr/bin/env bash
set -euo pipefail

HOST="lrpi"
REMOTE_DIR="/var/www/html/timegraph"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DIST_DIR="$SCRIPT_DIR/dist"

echo "==> Ensuring remote dir exists at $HOST:$REMOTE_DIR..."
ssh "$HOST" "sudo mkdir -p '$REMOTE_DIR'"

echo "==> Syncing dist to $HOST:$REMOTE_DIR..."
rsync -avz --delete --rsync-path="sudo rsync" \
  "$DIST_DIR"/ \
  "$HOST:$REMOTE_DIR/"

echo "==> Done."
