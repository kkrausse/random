#!/usr/bin/env bash
set -euo pipefail

HOST="lrpi"
REMOTE_DIR="/var/www/html/mortgage-calculator"

echo "==> Building..."
bun run build

echo "==> Ensuring remote dir exists at $HOST:$REMOTE_DIR..."
ssh "$HOST" "sudo mkdir -p '$REMOTE_DIR'"

echo "==> Syncing dist/ to $HOST:$REMOTE_DIR..."
rsync -avz --delete --rsync-path="sudo rsync" dist/ "$HOST:$REMOTE_DIR/"

echo "==> Done."
