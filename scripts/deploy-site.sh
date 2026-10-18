#!/usr/bin/env bash
set -euo pipefail

HOST="${DEPLOY_HOST:-lrpi}"
REMOTE_ROOT="${DEPLOY_WEB_ROOT:-/var/www/html}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Deploying homepage to $HOST:$REMOTE_ROOT/index.html..."
rsync -avz --rsync-path="sudo rsync" \
  "$SCRIPT_DIR/site/index.html" \
  "$HOST:$REMOTE_ROOT/index.html"

bash "$SCRIPT_DIR/deploy-theme.sh"

# Record what is now live in the kkrausse.com snapshot repo, if present.
SNAPSHOT="${KKRAUSSE_COM_REPO:-$HOME/devfs/repos/kkrausse/kkrausse.com}/snapshot.sh"
if [[ -x "$SNAPSHOT" ]]; then
  "$SNAPSHOT" "deploy-site.sh from random@$(git -C "$SCRIPT_DIR" rev-parse --abbrev-ref HEAD) $(git -C "$SCRIPT_DIR" rev-parse --short HEAD)" || echo "kkrausse.com snapshot failed" >&2
fi

echo "==> Done."
