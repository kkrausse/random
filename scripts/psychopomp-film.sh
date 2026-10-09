#!/usr/bin/env bash
# Build (and publish) a narrated psychopomp film from this machine's permanent
# psychopomp checkout, whichever worktree the scene lives in.
#
#   psychopomp-film.sh                       list scenes that have a build.sh
#   psychopomp-film.sh <scene> [flags...]    run that scene's build.sh
#
# Flags are the scene's own (see `psychopomp-film.sh <scene> --help`). For the
# scenes built on gromen-inflate:
#   --voice              regenerate narration from narration/script.json (GPU)
#   --stills             one PNG per cue, no render (the quick check)
#   --publish            render, package and deploy privately (Tailscale)
#   --publish --tunnel   ... to the opentunnel shelf served from this machine
#   --publish --public   ... to kkrausse.com
#
# Typical loop: edit scenes/<scene>/narration/script.json or src/main.rs, then
#   psychopomp-film.sh <scene> --voice --stills
#   psychopomp-film.sh <scene> --voice --publish --tunnel
#
# Environment:
#   PSYCHOPOMP_DIR  the checkout (default: $HOME/devfs/repos/kitlangton/psychopomp)
set -euo pipefail

PSYCHOPOMP_DIR="${PSYCHOPOMP_DIR:-$HOME/devfs/repos/kitlangton/psychopomp}"
[[ -d "$PSYCHOPOMP_DIR/.git" ]] || {
  echo "No psychopomp checkout at $PSYCHOPOMP_DIR (git clone https://github.com/kitlangton/psychopomp.git there, or set PSYCHOPOMP_DIR)." >&2
  exit 1
}

# The main checkout first, then its worktrees: scenes are developed on
# worktree branches and usually not merged into the checkout's main.
roots=("$PSYCHOPOMP_DIR")
while IFS= read -r line; do
  [[ "$line" == "worktree "* && "${line#worktree }" != "$PSYCHOPOMP_DIR" ]] && roots+=("${line#worktree }")
done < <(git -C "$PSYCHOPOMP_DIR" worktree list --porcelain)

if [[ $# -eq 0 || "$1" == -h || "$1" == --help ]]; then
  sed -n '2,21p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  echo
  echo "Scenes with a build.sh:"
  # A scene present in several worktrees is listed once, at the copy that runs:
  # the worktree named after it if there is one.
  declare -A found=()
  for root in "${roots[@]}"; do
    for build in "$root"/scenes/*/build.sh; do
      name="$(basename -- "$(dirname -- "$build")")"
      [[ -x "$build" && "$(basename -- "${found[$name]:-}")" != "$name" ]] && found["$name"]="$root"
    done
  done
  for name in $(printf '%s\n' "${!found[@]}" | sort); do
    echo "  $name  (${found[$name]})"
  done
  exit 0
fi

scene="$1"
shift
# A worktree named after the scene is where that scene is edited, so it wins;
# otherwise the last match, preferring any worktree over the main checkout.
build=""
for root in "${roots[@]}"; do
  [[ -x "$root/scenes/$scene/build.sh" ]] || continue
  build="$root/scenes/$scene/build.sh"
  [[ "$(basename -- "$root")" == "$scene" ]] && break
done
[[ -n "$build" ]] || { echo "No scenes/$scene/build.sh in $PSYCHOPOMP_DIR or its worktrees (run without arguments to list)." >&2; exit 1; }

# One build cache for every worktree; a cold release build takes many minutes.
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$PSYCHOPOMP_DIR/target}"
echo "==> $build $*" >&2
exec "$build" "$@"
