#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

if ! command -v mtp-sendfile >/dev/null 2>&1; then
    echo "mtp-sendfile is required; install it with: brew install libmtp" >&2
    exit 1
fi

"$ROOT/build.sh"
mtp-sendfile "$ROOT/bin/simple-analog.prg" /GARMIN/Apps
