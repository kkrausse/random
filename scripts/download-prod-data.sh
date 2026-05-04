#!/bin/bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-lrpi}"
REMOTE_DIR="${REMOTE_DIR:-/home/pi/deploys/birdmog}"
BACKUP_ROOT="${BACKUP_ROOT:-data_bakups}"
STAMP="${1:-prod-$(date +%Y%m%d-%H%M%S)}"
DEST="$BACKUP_ROOT/$STAMP"
REMOTE_DB_SNAPSHOT="/tmp/birdmog-$STAMP.db"

if [[ ! "$STAMP" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "Backup name must only contain letters, numbers, dots, underscores, and hyphens." >&2
  exit 1
fi

echo "Downloading prod data from $REMOTE_HOST:$REMOTE_DIR"
echo "Local backup: $DEST"

mkdir -p "$DEST/data" "$DEST/uploads"

cleanup() {
  ssh "$REMOTE_HOST" "rm -f '$REMOTE_DB_SNAPSHOT'" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "--- creating sqlite snapshot ---"
ssh "$REMOTE_HOST" "cd '$REMOTE_DIR' && sqlite3 data/bird-log.db \".backup '$REMOTE_DB_SNAPSHOT'\""

echo "--- downloading sqlite snapshot ---"
rsync -av "$REMOTE_HOST:$REMOTE_DB_SNAPSHOT" "$DEST/data/bird-log.db"

echo "--- downloading uploads ---"
rsync -av "$REMOTE_HOST:$REMOTE_DIR/uploads/" "$DEST/uploads/"

echo "--- summary ---"
printf "SQLite file: "
du -h "$DEST/data/bird-log.db" | awk '{print $1}'
printf "Upload files: "
find "$DEST/uploads" -maxdepth 1 -type f | wc -l | tr -d ' '
printf "Backup size: "
du -sh "$DEST" | awk '{print $1}'
echo "Done: $DEST"
