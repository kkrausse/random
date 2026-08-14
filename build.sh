#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SDK=$(cat "$HOME/Library/Application Support/Garmin/ConnectIQ/current-sdk.cfg")

mkdir -p "$ROOT/bin"
"$SDK/bin/monkeyc" \
    -f "$ROOT/monkey.jungle" \
    -d fr165 \
    -y "$ROOT/developer_key.der" \
    -o "$ROOT/bin/simple-analog.prg" \
    -w
