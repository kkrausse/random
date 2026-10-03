#!/usr/bin/env bash
set -euo pipefail

HOST="${DEPLOY_HOST:-lrpi}"
REMOTE_ROOT="${DEPLOY_WEB_ROOT:-/var/www/html}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Deploying homepage to $HOST:$REMOTE_ROOT/index.html..."
rsync -avz --rsync-path="sudo rsync" \
  "$SCRIPT_DIR/site/index.html" \
  "$HOST:$REMOTE_ROOT/index.html"

echo "==> Done."
