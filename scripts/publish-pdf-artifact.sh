#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 [--private|--public] <input.pdf> [url-slug] [--full-pages] [--dpi 144]" >&2
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
VISIBILITY=--private
if [[ "${1:-}" == --private || "${1:-}" == --public ]]; then
  VISIBILITY="$1"
  shift
fi
[[ $# -ge 1 ]] || { echo "An input PDF is required." >&2; exit 1; }
INPUT_PATH="$1"
FILENAME="$(basename -- "$INPUT_PATH")"
DEFAULT_SLUG="${FILENAME%.*}"
shift
SLUG="$DEFAULT_SLUG"
if [[ $# -gt 0 && "$1" != --* ]]; then
  SLUG="$1"
  shift
fi
if [[ ! "$SLUG" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*$ ]]; then
  echo "Invalid URL slug: $SLUG" >&2
  exit 1
fi
OUTPUT_DIR="$SCRIPT_DIR/output/$SLUG"
BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pdf-artifact.XXXXXX")"
trap 'rm -rf "$BUILD_DIR"' EXIT

cd "$SCRIPT_DIR"
bun pdf:web "$INPUT_PATH" "$BUILD_DIR" --title "$SLUG" "$@"

[[ -s "$BUILD_DIR/index.html" ]] || {
  echo "Conversion did not create a non-empty index.html" >&2
  exit 1
}
mkdir -p "$OUTPUT_DIR"
# mktemp creates a private root; published directories must be traversable by the web server.
chmod -R u=rwX,go=rX "$BUILD_DIR"
rsync -a --delete "$BUILD_DIR/" "$OUTPUT_DIR/"

./deploy-artifact.sh "$VISIBILITY" "$OUTPUT_DIR" "$SLUG"
