#!/usr/bin/env bash
# ============================================================================
# Build the self-hosted basemap in basemap/ (no external tile servers at runtime)
#
#   basemap/us-core.pmtiles        OpenStreetMap vector tiles for the US (Protomaps
#                                  schema), extracted from the public Protomaps daily
#                                  build to a modest max zoom so it fits in git and on
#                                  GitHub Pages. MapLibre overzooms it past MAXZOOM.
#   basemap/counties-lines.geojson Census 1:500k county boundaries (shared edges only)
#   basemap/counties-labels.geojson County name points
#   basemap/fonts/, basemap/sprites/  Glyphs and icons (interstate shields) used by
#                                  the Protomaps style layers
#
# Full street detail is a separate, much larger file that lives on the web server,
# not in git: see tools/basemap/build-streets.sh and DEPLOYMENT.md.
#
# Requirements: bash, curl, node/npx, and the pmtiles CLI
#   go install github.com/protomaps/go-pmtiles@latest   (binary: go-pmtiles)
#   or a release from https://github.com/protomaps/go-pmtiles/releases (binary: pmtiles)
#
# Usage:  tools/basemap/build.sh            # everything
#         MAXZOOM=8 tools/basemap/build.sh  # sharper core (about 75 MB instead of 27 MB; GitHub max is 100 MB)
#         BUILD=20261006 tools/basemap/build.sh  # pin a Protomaps build (YYYYMMDD)
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/basemap"
WORK="${WORK:-$(mktemp -d)}"
MAXZOOM="${MAXZOOM:-7}"
CENSUS_YEAR="${CENSUS_YEAR:-2023}"
MAPSHAPER="npx --yes mapshaper@0.7"
ASSETS="https://protomaps.github.io/basemaps-assets"

PMTILES="${PMTILES:-}"
if [ -z "$PMTILES" ]; then
    PMTILES="$(command -v pmtiles || command -v go-pmtiles || true)"
    [ -z "$PMTILES" ] && [ -x "$HOME/go/bin/go-pmtiles" ] && PMTILES="$HOME/go/bin/go-pmtiles"
fi
[ -n "$PMTILES" ] || { echo "pmtiles CLI not found (see header)"; exit 1; }

# Latest Protomaps daily build that exists (or BUILD=YYYYMMDD)
if [ -z "${BUILD:-}" ]; then
    for i in $(seq 0 14); do
        d="$(date -u -d "-$i day" +%Y%m%d)"
        if curl -sfr 0-0 -o /dev/null "https://build.protomaps.com/$d.pmtiles"; then BUILD="$d"; break; fi
    done
fi
[ -n "${BUILD:-}" ] || { echo "No Protomaps build found in the last 14 days"; exit 1; }
SRC="https://build.protomaps.com/$BUILD.pmtiles"
echo "Protomaps build $BUILD, max zoom $MAXZOOM, work dir $WORK"

mkdir -p "$OUT" "$WORK"
cd "$WORK"

census() {
    [ -f "$1.zip" ] || curl -sSfO "https://www2.census.gov/geo/tiger/GENZ$CENSUS_YEAR/shp/$1.zip"
}
census "cb_${CENSUS_YEAR}_us_county_500k"

# Extract region (tools/basemap/region.json): boxes around CONUS, Alaska, Hawaii and
# Puerto Rico, so nearby ocean and the border areas of Canada/Mexico are included.
# Open-ocean tiles are nearly empty and deduplicated, so the boxes cost little.
"$PMTILES" extract "$SRC" "$OUT/us-core.pmtiles" --region="$ROOT/tools/basemap/region.json" --maxzoom="$MAXZOOM"

$MAPSHAPER -i "cb_${CENSUS_YEAR}_us_county_500k.zip" -proj wgs84 -simplify 12% keep-shapes \
    -innerlines -o format=geojson precision=0.0001 "$OUT/counties-lines.geojson"
$MAPSHAPER -i "cb_${CENSUS_YEAR}_us_county_500k.zip" -proj wgs84 -points inner \
    -filter-fields NAME,STUSPS -rename-fields name=NAME,st=STUSPS \
    -o format=geojson precision=0.0001 "$OUT/counties-labels.geojson"

# Sprites (v4 has light and dark) and the Latin/Greek/Cyrillic/punctuation glyph
# ranges of the three fonts the Protomaps layers use.
mkdir -p "$OUT/sprites"
for f in light dark; do
    for s in "" "@2x"; do
        for ext in json png; do
            curl -sSf -o "$OUT/sprites/$f$s.$ext" "$ASSETS/sprites/v4/$f$s.$ext"
        done
    done
done
for font in "Noto Sans Regular" "Noto Sans Medium" "Noto Sans Italic"; do
    mkdir -p "$OUT/fonts/$font"
    enc="${font// /%20}"
    for start in $(seq 0 256 8960); do
        range="$start-$((start + 255))"
        curl -sSf -o "$OUT/fonts/$font/$range.pbf" "$ASSETS/fonts/$enc/$range.pbf"
    done
done

echo "$BUILD" > "$OUT/BUILD"
du -sh "$OUT"/*
