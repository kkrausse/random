#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
APK="$ROOT/app/build/outputs/apk/debug/app-debug.apk"
SERIAL="${1:-${ANDROID_SERIAL:-}}"

if [ -n "${ADB:-}" ] && [ -x "$ADB" ]; then
    ADB_BIN="$ADB"
elif command -v adb >/dev/null 2>&1; then
    ADB_BIN=$(command -v adb)
elif [ -n "${ANDROID_HOME:-}" ] && [ -x "$ANDROID_HOME/platform-tools/adb" ]; then
    ADB_BIN="$ANDROID_HOME/platform-tools/adb"
elif [ -n "${ANDROID_SDK_ROOT:-}" ] && [ -x "$ANDROID_SDK_ROOT/platform-tools/adb" ]; then
    ADB_BIN="$ANDROID_SDK_ROOT/platform-tools/adb"
elif [ -x "$HOME/Library/Android/sdk/platform-tools/adb" ]; then
    ADB_BIN="$HOME/Library/Android/sdk/platform-tools/adb"
else
    printf '%s\n' 'adb not found. Set ADB or ANDROID_HOME, or add adb to PATH.' >&2
    exit 1
fi

if [ -z "${ANDROID_HOME:-}" ]; then
    ADB_DIR=$(dirname -- "$ADB_BIN")
    SDK_ROOT=$(dirname -- "$ADB_DIR")
    if [ "$(basename -- "$ADB_DIR")" = "platform-tools" ] && [ -d "$SDK_ROOT/platforms" ]; then
        ANDROID_HOME="$SDK_ROOT"
        export ANDROID_HOME
    fi
fi

DEVICES=$("$ADB_BIN" devices | awk 'NR > 1 && $2 == "device" { print $1 }')

if [ -n "$SERIAL" ]; then
    if ! printf '%s\n' "$DEVICES" | grep -Fxq "$SERIAL"; then
        printf 'Device %s is not connected and authorized.\n' "$SERIAL" >&2
        "$ADB_BIN" devices -l >&2
        exit 1
    fi
else
    DEVICE_COUNT=$(printf '%s\n' "$DEVICES" | awk 'NF { count++ } END { print count + 0 }')
    if [ "$DEVICE_COUNT" -ne 1 ]; then
        printf 'Expected one connected device, found %s. Pass a serial: %s [serial]\n' "$DEVICE_COUNT" "$0" >&2
        "$ADB_BIN" devices -l >&2
        exit 1
    fi
    SERIAL="$DEVICES"
fi

printf 'Building debug APK...\n'
"$ROOT/gradlew" --no-daemon -p "$ROOT" assembleDebug

printf 'Installing on %s...\n' "$SERIAL"
"$ADB_BIN" -s "$SERIAL" install -r "$APK"

printf 'Launching Kindle Context...\n'
"$ADB_BIN" -s "$SERIAL" shell am start -n dev.example.kindlecontext/.MainActivity
