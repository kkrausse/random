#!/bin/sh
# Build, bundle, sign and install Relacon.app, and write the LaunchAgent plist.
# Idempotent. Does NOT start the daemon unless you pass --load (which does
# launchctl bootout + bootstrap so a reinstall picks up the new binary).
#
#   scripts/install.sh                # build + install, don't start
#   scripts/install.sh --load         # ... and (re)start the LaunchAgent
#   scripts/install.sh --bundle-only  # build + bundle + sign into target/Relacon.app, stop
#
# Env: RELACON_CODESIGN_IDENTITY, RELACON_TEAM_ID (see scripts/macos-signing.sh).
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
. "$root/scripts/macos-signing.sh"

load=0
bundle_only=0
for arg in "$@"; do
  case "$arg" in
    --load) load=1 ;;
    --bundle-only) bundle_only=1 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

label=com.kkrausse.relacon-d
apps="$HOME/Applications"
app="$apps/Relacon.app"
plist="$HOME/Library/LaunchAgents/$label.plist"
log="$HOME/Library/Logs/relacon-d.log"
config_dir="$HOME/.config/relacon"
version=$(sed -n 's/^version = "\(.*\)"/\1/p' "$root/Cargo.toml" | head -1)

echo "==> cargo build --release"
(cd "$root" && cargo build --release)

echo "==> bundle"
stage="$root/target/Relacon.app"
rm -rf "$stage"
mkdir -p "$stage/Contents/MacOS"
cp "$root/target/release/relacon-d" "$stage/Contents/MacOS/relacon-d"
cat > "$stage/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>$label</string>
  <key>CFBundleName</key><string>Relacon</string>
  <key>CFBundleDisplayName</key><string>Relacon</string>
  <key>CFBundleExecutable</key><string>relacon-d</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$version</string>
  <key>CFBundleVersion</key><string>$version</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
EOF

echo "==> sign"
if identity=$(relacon_codesign_identity); then
  echo "signing with: $identity"
  codesign --force --timestamp=none --options runtime --identifier "$label" --sign "$identity" "$stage"
else
  cat >&2 <<'WARN'

  !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
  !!  No code signing identity found. Falling back to AD-HOC signing.        !!
  !!  Input Monitoring / Accessibility grants are tied to the cdhash and     !!
  !!  WILL BREAK ON EVERY REBUILD. Set RELACON_CODESIGN_IDENTITY to fix.     !!
  !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

WARN
  codesign --force --sign - --identifier "$label" "$stage"
fi
codesign --verify --strict --verbose=1 "$stage"
if [ "$bundle_only" = 1 ]; then
  echo "$stage"
  exit 0
fi

echo "==> install $app"
mkdir -p "$apps"
# Replace contents in place rather than the bundle directory itself.
mkdir -p "$app"
rsync -a --delete "$stage/" "$app/"

echo "==> config"
mkdir -p "$config_dir"
cp "$root/relacon.d.ts" "$config_dir/relacon.d.ts"
if [ ! -e "$config_dir/config.ts" ]; then
  sed 's#/// <reference path="../relacon.d.ts" />#/// <reference path="./relacon.d.ts" />#' \
    "$root/examples/config.ts" > "$config_dir/config.ts"
  echo "wrote starter $config_dir/config.ts"
else
  echo "kept existing $config_dir/config.ts"
fi
"$app/Contents/MacOS/relacon-d" check "$config_dir/config.ts"

echo "==> LaunchAgent $plist"
mkdir -p "$(dirname "$plist")" "$(dirname "$log")"
cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>$app/Contents/MacOS/relacon-d</string>
    <string>run</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Interactive</string>
  <key>LimitLoadToSessionType</key><string>Aqua</string>
  <key>StandardOutPath</key><string>$log</string>
  <key>StandardErrorPath</key><string>$log</string>
</dict>
</plist>
EOF
plutil -lint "$plist" >/dev/null

if [ "$load" = 1 ]; then
  echo "==> launchctl (re)load"
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  # bootout returns before the job is fully gone; bootstrap fails with EIO until it is.
  for i in 1 2 3 4 5 6 7 8 9 10; do
    launchctl bootstrap "gui/$(id -u)" "$plist" 2>/dev/null && break
    [ "$i" = 10 ] && { echo "launchctl bootstrap failed" >&2; exit 1; }
    sleep 0.5
  done
  echo "started; log: $log"
else
  echo
  echo "Installed but NOT started. To start:"
  echo "  launchctl bootstrap gui/$(id -u) $plist"
  echo "(or rerun with --load)"
fi
