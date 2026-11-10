#!/bin/bash
# new-diagram.sh <dir>: a self-contained static diagram page in <dir> (index.html, app.js, diagram.js, excs.js,
# cli.js and a starter scene.js, which is the only file you write). Existing scene files are kept; the rest is refreshed.
# View: serve the folder (python3 -m http.server) or publish it (deploy-artifact.sh <dir> <slug>). No build.
set -e
S="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"; D="${1:?usage: new-diagram.sh <dir>}"
mkdir -p "$D"
cp "$S/site/index.html" "$S/site/diagram.js" "$S/scripts/excs.js" "$D/"
sed 's#import "../scripts/excs.js";.*sets#import "./excs.js"; // sets#' "$S/site/app.js" > "$D/app.js"
sed 's#^import "../scripts/excs.js";#import "./excs.js";#' "$S/site/cli.js" > "$D/cli.js"
[ -f "$D/scene.js" ] || cp "$S/site/scene.js" "$D/scene.js"
echo "$D: edit scene.js; check it with: bunx tsc --noEmit --allowJs --checkJs --target es2022 --module esnext --moduleResolution bundler --strict $D/scene.js"
