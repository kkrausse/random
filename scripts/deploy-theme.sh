#!/usr/bin/env bash
set -euo pipefail

HOST="${DEPLOY_HOST:-lrpi}"
REMOTE_ROOT="${DEPLOY_WEB_ROOT:-/var/www/html}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ ! "$REMOTE_ROOT" =~ ^/[a-zA-Z0-9/._-]+$ || "$REMOTE_ROOT" == *'/../'* || "$REMOTE_ROOT" == */.. ]]; then
  echo "Invalid deployment root: $REMOTE_ROOT" >&2
  exit 1
fi
rsync -avz --rsync-path="sudo rsync" "$SCRIPT_DIR/site/theme.css" "$HOST:$REMOTE_ROOT/theme.css"
ssh "$HOST" "sudo python3 - '$REMOTE_ROOT'" < "$SCRIPT_DIR/theme-pages.py"
