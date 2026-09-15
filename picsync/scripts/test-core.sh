#!/bin/bash
set -euo pipefail

# Use the compiler and SDK directly; device discovery/signing is not needed for core tests.
# This also works when Xcode's CoreDevice loader is broken but its compiler is intact.
developer="${PICSYNC_XCODE_DIR:-/Applications/Xcode.app/Contents/Developer}"
export SDKROOT="$developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk"
frameworks="$developer/Platforms/MacOSX.platform/Developer/Library/Frameworks"
root="$(cd "$(dirname "$0")/.." && pwd)"
exec "$developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift" test \
  --package-path "$root" --sdk "$SDKROOT" \
  -Xswiftc -F -Xswiftc "$frameworks" \
  -Xlinker -rpath -Xlinker "$frameworks" "$@"
