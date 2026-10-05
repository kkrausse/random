#!/bin/sh
# Launcher used by bun-web-terminal. Execs the venv interpreter directly, so it
# needs neither uv nor any PATH entry at runtime and keeps the caller as parent.
set -eu
cd "$(dirname "$0")"
[ -x .venv/bin/python ] || { echo "dictation-server-linux: no .venv; run ./setup.sh" >&2; exit 1; }
# Local files only: the service never downloads at runtime.
export HF_HUB_OFFLINE=1 PYTHONUNBUFFERED=1
exec .venv/bin/python server.py "$@"
