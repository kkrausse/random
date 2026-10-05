#!/bin/sh
# Launcher used by bun-web-terminal. Execs the venv interpreter directly, so it
# needs neither uv nor any PATH entry at runtime and keeps the caller as parent.
set -eu
cd "$(dirname "$0")"
[ -x .venv/bin/python ] || { echo "dictation-server-linux: no .venv; run ./setup.sh" >&2; exit 1; }
# Pin the NVIDIA shader cache to the directory setup.sh warmed. By default it
# follows XDG_CACHE_HOME or HOME, which differ between a shell and a service.
export __GL_SHADER_DISK_CACHE_PATH="$PWD/.cache/shaders" PYTHONUNBUFFERED=1
exec .venv/bin/python server.py "$@"
