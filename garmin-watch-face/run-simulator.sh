#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SDK=$(cat "$HOME/Library/Application Support/Garmin/ConnectIQ/current-sdk.cfg")

"$ROOT/build.sh"
open "$SDK/bin/ConnectIQ.app"
sleep 2
"$SDK/bin/monkeydo" "$ROOT/bin/simple-analog.prg" fr165
