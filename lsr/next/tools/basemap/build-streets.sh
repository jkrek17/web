#!/usr/bin/env bash
# ============================================================================
# Build the optional street-detail basemap for the web server (NOT for git)
#
#   us-streets.pmtiles  OpenStreetMap vector tiles for the US down to street level,
#                       extracted from the public Protomaps daily build.
#
# Approximate sizes (Protomaps build 20261006, region-streets.json):
#   MAXZOOM=13  4.0 GB    MAXZOOM=14  8.3 GB (default)    MAXZOOM=15  18 GB
# MapLibre overzooms past MAXZOOM, so z14 already shows every street at full zoom;
# z15 mainly adds points of interest and address labels.
#
# Region: tools/basemap/region-streets.json (US states and territories plus a 60 km
# buffer). The in-repo core file covers a wider area at low detail.
#
# Copy the result to the web server (for example next to the app as
# basemap/us-streets.pmtiles) and set CONFIG.BASEMAP.STREETS_URL in config.js.
# The server must answer HTTP range requests and must not gzip .pmtiles
# (the shipped .htaccess handles this on Apache). See DEPLOYMENT.md, "Basemap".
#
# Requirements: curl and the pmtiles CLI (go install github.com/protomaps/go-pmtiles@latest,
# or a release binary from https://github.com/protomaps/go-pmtiles/releases).
# Needs outbound HTTPS to build.protomaps.com; if the web server has none, run this
# anywhere and copy the file over.
#
# Usage:  tools/basemap/build-streets.sh [output-file]
#         MAXZOOM=15 tools/basemap/build-streets.sh /var/www/html/lsr/basemap/us-streets.pmtiles
#         BUILD=20261006 tools/basemap/build-streets.sh   # pin a Protomaps build (YYYYMMDD)
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUTFILE="${1:-$ROOT/basemap/us-streets.pmtiles}"
MAXZOOM="${MAXZOOM:-14}"

PMTILES="${PMTILES:-}"
if [ -z "$PMTILES" ]; then
    PMTILES="$(command -v pmtiles || command -v go-pmtiles || true)"
    [ -z "$PMTILES" ] && [ -x "$HOME/go/bin/go-pmtiles" ] && PMTILES="$HOME/go/bin/go-pmtiles"
fi
[ -n "$PMTILES" ] || { echo "pmtiles CLI not found (see header)"; exit 1; }

if [ -z "${BUILD:-}" ]; then
    for i in $(seq 0 14); do
        d="$(date -u -d "-$i day" +%Y%m%d)"
        if curl -sfr 0-0 -o /dev/null "https://build.protomaps.com/$d.pmtiles"; then BUILD="$d"; break; fi
    done
fi
[ -n "${BUILD:-}" ] || { echo "No Protomaps build found in the last 14 days"; exit 1; }
SRC="https://build.protomaps.com/$BUILD.pmtiles"

echo "Protomaps build $BUILD, max zoom $MAXZOOM -> $OUTFILE"
"$PMTILES" extract "$SRC" "$OUTFILE" --region="$ROOT/tools/basemap/region-streets.json" \
    --maxzoom="$MAXZOOM" --download-threads=8
ls -lh "$OUTFILE"
echo "Done. Set CONFIG.BASEMAP.STREETS_URL in config.js to this file's URL (relative to index.html)."
