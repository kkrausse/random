#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
VISIBILITY=private
if [[ "${1:-}" == --private || "${1:-}" == --public ]]; then
  VISIBILITY="${1#--}"
  shift
fi
if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: $0 [--private|--public] <artifact-directory-or-file> [url-slug]" >&2
  echo "       $0 [--private|--public] --remove <url-slug>" >&2
  exit 1
fi

HOST="${DEPLOY_HOST:-lrpi}"
if [[ "$VISIBILITY" == private ]]; then
  WEB_ROOT="${DEPLOY_PRIVATE_ROOT:-/srv/private-artifacts}"
  BASE_URL="${DEPLOY_PRIVATE_URL:-}"
  if [[ -z "$BASE_URL" ]]; then
    DNS_NAME="$(ssh "$HOST" 'tailscale status --json' | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')"
    BASE_URL="https://$DNS_NAME"
  fi
else
  WEB_ROOT="${DEPLOY_WEB_ROOT:-/var/www/html}"
  BASE_URL="${DEPLOY_PUBLIC_URL:-https://kkrausse.com}"
fi
# Paths are interpolated into remote shell commands: only allow safe absolute paths.
if [[ ! "$WEB_ROOT" =~ ^/[a-zA-Z0-9/._-]+$ || "$WEB_ROOT" == *'/../'* || "$WEB_ROOT" == */.. ]]; then
  echo "Invalid deployment root: $WEB_ROOT" >&2
  exit 1
fi
if [[ "$VISIBILITY" == private && ( "$WEB_ROOT" == /var/www || "$WEB_ROOT" == /var/www/* ) ]]; then
  echo "Private artifacts must be outside /var/www." >&2
  exit 1
fi
REMOTE_ROOT="$WEB_ROOT/artifacts"
SOURCE_DIR=""
FILE_URL=""
WORK_DIR="$(mktemp -d)"
trap 'rm -rf -- "$WORK_DIR"' EXIT

if [[ "$1" == --remove ]]; then
  [[ $# -eq 2 ]] || { echo "Removal requires a slug." >&2; exit 1; }
  SLUG="$2"
else
  SOURCE="${1%/}"
  SLUG="${2:-$(basename -- "$SOURCE")}"
  if [[ -d "$SOURCE" ]]; then
    if [[ -f "$SOURCE/index.html" ]]; then
      SOURCE_DIR="$SOURCE"
    else
      SOURCE_DIR="$WORK_DIR/artifact"
      mkdir -p "$SOURCE_DIR"
      rsync -a "$SOURCE/" "$SOURCE_DIR/"
      # Generate listings in the staging copy, never modify the source folder.
      python3 - "$SOURCE_DIR" "$(basename -- "$SOURCE")" <<'PY'
import html, os, pathlib, sys, urllib.parse
root = pathlib.Path(sys.argv[1])
for directory, _, _ in os.walk(root):
    path = pathlib.Path(directory)
    if (path / "index.html").exists():
        continue
    title = sys.argv[2] if path == root else path.name
    links = []
    for entry in sorted(path.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
        if entry.name == ".published-at":
            continue
        name = entry.name + ("/" if entry.is_dir() else "")
        links.append('<li><a href="' + urllib.parse.quote(name) + '">'
                     + html.escape(name) + '</a></li>')
    (path / "index.html").write_text('<!doctype html><meta charset="utf-8">'
        + '<meta name="viewport" content="width=device-width, initial-scale=1">'
        + '<title>' + html.escape(title) + '</title><h1>' + html.escape(title)
        + '</h1><ul>' + ''.join(links) + '</ul>')
PY
    fi
  elif [[ -f "$SOURCE" ]]; then
    SOURCE_DIR="$WORK_DIR/artifact"
    mkdir -p "$SOURCE_DIR"
    cp -- "$SOURCE" "$SOURCE_DIR/"
    # A file-only artifact gets a landing page linking to the original download.
    python3 - "$SOURCE" "$SOURCE_DIR/index.html" <<'PY'
import html, pathlib, sys, urllib.parse
name = pathlib.Path(sys.argv[1]).name
target = pathlib.Path(sys.argv[2])
if name != "index.html":
    target.write_text('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">'
        + '<title>' + html.escape(name) + '</title><p><a href="'
        + urllib.parse.quote(name) + '">Open ' + html.escape(name) + '</a></p>')
PY
    FILE_URL="$(python3 - "$SOURCE" <<'PY'
import pathlib, sys, urllib.parse
name = pathlib.Path(sys.argv[1]).name
print(urllib.parse.quote(name) if name != "index.html" else "")
PY
)"
  else
    echo "Artifact must be an existing file or directory: $SOURCE" >&2
    exit 1
  fi
fi
if [[ ! "$SLUG" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*$ ]]; then
  echo "Invalid URL slug: $SLUG" >&2
  exit 1
fi

if [[ -z "$SOURCE_DIR" ]]; then
  echo "==> Removing $VISIBILITY artifact from $HOST:$REMOTE_ROOT/$SLUG..."
  ssh "$HOST" "sudo rm -rf -- '$REMOTE_ROOT/$SLUG'"
else
  echo "==> Deploying $VISIBILITY artifact to $HOST:$REMOTE_ROOT/$SLUG..."
  ssh "$HOST" "sudo mkdir -p '$REMOTE_ROOT/$SLUG'"
  rsync -avz --delete --rsync-path="sudo rsync" \
    "$SOURCE_DIR/" "$HOST:$REMOTE_ROOT/$SLUG/"
  # rsync preserves source mtimes; record server publish time separately.
  ssh "$HOST" "sudo chmod -R u=rwX,go=rX '$REMOTE_ROOT/$SLUG' && sudo touch '$REMOTE_ROOT/$SLUG/.published-at'"
fi

ssh "$HOST" "python3 - '$REMOTE_ROOT' '$VISIBILITY'" \
  < "$SCRIPT_DIR/artifact-index.py" > "$WORK_DIR/index.html"
chmod 0644 "$WORK_DIR/index.html"
rsync -avz --rsync-path="sudo rsync" "$WORK_DIR/index.html" "$HOST:$REMOTE_ROOT/index.html"
if [[ "$VISIBILITY" == private ]]; then
  # The private homepage and /artifacts/ share the same generated shelf.
  rsync -avz --rsync-path="sudo rsync" "$WORK_DIR/index.html" "$HOST:$WEB_ROOT/index.html"
fi
if [[ -z "$SOURCE_DIR" ]]; then
  echo "Index: ${BASE_URL%/}/artifacts/"
else
  echo "Published ($VISIBILITY): ${BASE_URL%/}/artifacts/$SLUG/$FILE_URL"
fi
