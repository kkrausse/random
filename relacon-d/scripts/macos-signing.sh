#!/bin/sh

# Sourced by install.sh. Same approach as hex-rust/scripts/macos-signing.sh: print
# only the selected identity so callers can capture it; diagnostics go to stderr.
#
# Order: $RELACON_CODESIGN_IDENTITY, then a "Developer ID Application" identity
# (restricted to $RELACON_TEAM_ID if set), then an "Apple Development" identity.
# Both certificate kinds give a stable designated requirement, so Input Monitoring
# and Accessibility grants survive rebuilds. Prints nothing (and returns 1) if no
# identity is found; the caller falls back to ad-hoc signing.
relacon_codesign_identity() {
  identity=${RELACON_CODESIGN_IDENTITY:-}
  if [ -n "$identity" ]; then
    printf '%s\n' "$identity"
    return 0
  fi
  identities=$(security find-identity -v -p codesigning 2>/dev/null)
  team=${RELACON_TEAM_ID:-}
  if [ -n "$team" ]; then
    identity=$(printf '%s\n' "$identities" | sed -n "s/.*\"\(Developer ID Application:.*($team)\)\"/\1/p" | head -1)
  else
    identity=$(printf '%s\n' "$identities" | sed -n 's/.*"\(Developer ID Application:.*\)"/\1/p' | head -1)
  fi
  if [ -z "$identity" ]; then
    identity=$(printf '%s\n' "$identities" | sed -n 's/.*"\(Apple Development:.*\)"/\1/p' | head -1)
    if [ -n "$identity" ]; then
      echo "No Developer ID Application identity found; using \"$identity\" (also stable across rebuilds)." >&2
    fi
  fi
  if [ -z "$identity" ]; then
    return 1
  fi
  printf '%s\n' "$identity"
}
