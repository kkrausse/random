#!/usr/bin/env bash
# Run from any directory. Builds a tiny border-spanning OSM API extract, NOT a useful Tahoe region.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="${1:?pass a clean Organic Maps checkout at 98099c37a3c353a240a9d41959492e67990a2083}"
OUT="${2:?pass an output directory outside the repository}"
ROOT="$(cd "$ROOT" && pwd)"
mkdir -p "$OUT" "$OUT/build" "$OUT/maps/borders" "$OUT/intermediate"
OUT="$(cd "$OUT" && pwd)"
test "$(git -C "$ROOT" rev-parse HEAD)" = 98099c37a3c353a240a9d41959492e67990a2083
git -C "$ROOT" apply --check "$HERE/empty-restrictions.patch" && git -C "$ROOT" apply "$HERE/empty-restrictions.patch"
curl -fL 'https://api.openstreetmap.org/api/0.6/map?bbox=-120.025,39.225,-119.985,39.255' -o "$OUT/kings-beach.osm"
shasum -a 256 "$OUT/kings-beach.osm"
cat > "$OUT/maps/borders/US_Nevada.poly" <<'EOF'
US_Nevada
1
 -120.07 39.19
 -119.94 39.19
 -119.94 39.28
 -120.07 39.28
 -120.07 39.19
END
END
EOF
cmake -S "$ROOT" -B "$OUT/build" -DCMAKE_BUILD_TYPE=Release -DSKIP_QT_GUI=ON -DUSE_CCACHE=OFF
cmake --build "$OUT/build" --target generator_tool -j 6
COMMON=(--output=US_Nevada --data_path="$OUT/maps" --intermediate_data_path="$OUT/intermediate" --user_resource_path="$ROOT/data" --threads_count=4)
"$OUT/build/generator_tool" "${COMMON[@]}" --preprocess --osm_file_name="$OUT/kings-beach.osm" --osm_file_type=xml
"$OUT/build/generator_tool" "${COMMON[@]}" --generate_features --osm_file_name="$OUT/kings-beach.osm" --osm_file_type=xml
"$OUT/build/generator_tool" "${COMMON[@]}" --generate_geometry --generate_index --generate_search_index --make_routing_index
"$OUT/build/generator_tool" "${COMMON[@]}" --check_mwm --stats_general
python3 "$HERE/export-way-evidence.py" "$OUT/kings-beach.osm" "$OUT/maps/US_Nevada.mwm" "$OUT/maps/US_Nevada.evidence.json"
shasum -a 256 "$OUT/maps/US_Nevada.mwm" "$OUT/maps/US_Nevada.evidence.json"
