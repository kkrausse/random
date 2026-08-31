#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE_DIR="${ROOT_DIR}/.chromium-dev-profile"

find_chromium() {
  if [[ -n "${CHROMIUM_BIN:-}" ]]; then
    printf '%s\n' "${CHROMIUM_BIN}"
    return
  fi

  local candidates=(
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"
    "chromium"
    "chromium-browser"
    "google-chrome"
    "google-chrome-stable"
  )

  for candidate in "${candidates[@]}"; do
    if [[ -x "${candidate}" ]]; then
      printf '%s\n' "${candidate}"
      return
    fi

    if command -v "${candidate}" >/dev/null 2>&1; then
      command -v "${candidate}"
      return
    fi
  done

  return 1
}

CHROMIUM="$(find_chromium || true)"

if [[ -z "${CHROMIUM}" ]]; then
  printf 'Could not find Chromium. Set CHROMIUM_BIN to your browser binary path.\n' >&2
  printf 'Example: CHROMIUM_BIN="/Applications/Chromium.app/Contents/MacOS/Chromium" make dev\n' >&2
  exit 1
fi

mkdir -p "${PROFILE_DIR}"

exec "${CHROMIUM}" \
  --user-data-dir="${PROFILE_DIR}" \
  --load-extension="${ROOT_DIR}" \
  --no-first-run \
  --new-window \
  "https://substack.com"
