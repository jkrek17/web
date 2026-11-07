// ============================================================================
// BASEMAP - Self-hosted vector basemap (no external tile servers)
// ============================================================================
//
// OpenStreetMap vector tiles in the Protomaps schema, read straight from a
// PMTiles file on this server via HTTP range requests, styled with the
// Protomaps layer definitions; plus Census county lines and labels.
//
// Two tiers (see CONFIG.BASEMAP):
//   CORE_URL     basemap/us-core.pmtiles, in the repo, low max zoom (overzoomed)
//   STREETS_URL  optional full-detail file on the web server (street level);
//                used instead of the core file when it answers, else core is used

import { layers, namedFlavor } from '../../lib/protomaps-basemaps/basemaps.js';

const BASEMAP_DIR = new URL('../../basemap/', import.meta.url).href;
const ATTRIBUTION = '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">&copy; OpenStreetMap</a> &middot; ' +
    '<a href="https://protomaps.com" target="_blank" rel="noopener">Protomaps</a> &middot; US Census';

/** Id of the first basemap label layer; app overlays go below it, reports above everything */
export const LABEL_ANCHOR_LAYER = 'basemap-label-anchor';

// Muted flavors so colored report icons stand out. Both themes must produce the
// same layer ids (applyBasemapTheme restyles in place), so the dark flavor drops
// the landcover and POI keys the white flavor does not have.
function flavorFor(theme) {
    if (theme === 'dark') {
        const { landcover, pois, ...dark } = namedFlavor('dark');
        return { ...dark, water: '#1f2a37', background: '#1f2a37', boundaries: '#7b8494' };
    }
    // background = water: areas outside the extract (far offshore) read as ocean
    return { ...namedFlavor('white'), water: '#cddcea', background: '#cddcea', boundaries: '#8a8a8a', earth: '#fbfbf9' };
}

const THEME_COLORS = {
    light: { county: '#9ca3af', countyLabel: '#6b7280', countyHalo: '#fbfbf9', state: '#6b7280' },
    dark: { county: '#4b5563', countyLabel: '#9ca3af', countyHalo: '#1f1f1f', state: '#94a3b8' }
};

function resolveUrl(url) {
    return new URL(url, document.baseURI).href;
}

function spriteUrl(theme) {
    return BASEMAP_DIR + 'sprites/' + (theme === 'dark' ? 'dark' : 'light');
}

/**
 * All basemap layers for a theme, in draw order. Ids are stable across themes.
 */
function basemapLayers(theme) {
    const colors = THEME_COLORS[theme] || THEME_COLORS.light;
    const base = layers('protomaps', flavorFor(theme), { lang: 'en' });

    // Weather-map tweaks: solid, heavier state lines
    for (const layer of base) {
        if (layer.id === 'boundaries') {
            layer.paint = {
                ...layer.paint,
                'line-color': colors.state,
                'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.6, 6, 1.1, 10, 1.6],
                'line-dasharray': ['literal', [1, 0]]
            };
        }
    }

    const counties = [
        {
            id: 'counties',
            type: 'line',
            source: 'counties',
            minzoom: 5,
            paint: {
                'line-color': colors.county,
                'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.3, 8, 0.6, 12, 1],
                'line-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.35, 7, 0.7]
            }
        }
    ];
    const countyLabels = [
        {
            id: 'county-labels',
            type: 'symbol',
            source: 'county-labels',
            minzoom: 7.5,
            layout: {
                'text-field': ['get', 'name'],
                'text-font': ['Noto Sans Italic'],
                'text-size': 11,
                'text-padding': 4
            },
            paint: {
                'text-color': colors.countyLabel,
                'text-halo-color': colors.countyHalo,
                'text-halo-width': 1.2
            }
        }
    ];

    const firstSymbol = base.findIndex(l => l.type === 'symbol');
    const split = firstSymbol === -1 ? base.length : firstSymbol;
    // Invisible marker layer so app overlays can be inserted just under the labels
    const anchor = { id: LABEL_ANCHOR_LAYER, type: 'background', layout: { visibility: 'none' }, paint: {} };
    return [...base.slice(0, split), ...counties, anchor, ...countyLabels, ...base.slice(split)];
}

/**
 * Probe the optional street-detail PMTiles; resolves to the URL to use.
 */
export async function resolveBasemapUrl(basemapConfig = {}) {
    const core = resolveUrl(basemapConfig.CORE_URL || (BASEMAP_DIR + 'us-core.pmtiles'));
    const streets = basemapConfig.STREETS_URL ? resolveUrl(basemapConfig.STREETS_URL) : '';
    if (!streets) {
        return { url: core, detail: 'core' };
    }
    try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 4000);
        const res = await fetch(streets, { headers: { Range: 'bytes=0-15' }, signal: ctrl.signal });
        clearTimeout(timer);
        if (res.status === 206) {
            const magic = new TextDecoder().decode(new Uint8Array(await res.arrayBuffer()).slice(0, 7));
            if (magic === 'PMTiles') {
                return { url: streets, detail: 'streets' };
            }
        }
        console.warn(`[Basemap] Street tiles at ${streets} unavailable (HTTP ${res.status}); using core basemap`);
    } catch (e) {
        console.warn(`[Basemap] Street tiles at ${streets} unreachable; using core basemap`, e);
    }
    return { url: core, detail: 'core' };
}

/**
 * Full MapLibre style for the basemap.
 * @param {string} theme 'light' | 'dark'
 * @param {string} pmtilesUrl absolute URL of the PMTiles file
 */
export function buildBasemapStyle(theme, pmtilesUrl) {
    return {
        version: 8,
        glyphs: BASEMAP_DIR + 'fonts/{fontstack}/{range}.pbf',
        sprite: spriteUrl(theme),
        sources: {
            protomaps: {
                type: 'vector',
                url: 'pmtiles://' + pmtilesUrl,
                attribution: ATTRIBUTION
            },
            counties: {
                type: 'geojson',
                data: BASEMAP_DIR + 'counties-lines.geojson',
                tolerance: 0.5
            },
            'county-labels': {
                type: 'geojson',
                data: BASEMAP_DIR + 'counties-labels.geojson'
            }
        },
        layers: basemapLayers(theme)
    };
}

/** Theme the map's basemap layers currently have */
let appliedTheme = null;

/**
 * Restyle the basemap layers in place for a theme, leaving app layers alone.
 */
export function applyBasemapTheme(map, theme) {
    if (!map || theme === appliedTheme) {
        return;
    }
    if (!map.getLayer(LABEL_ANCHOR_LAYER)) {
        map.once('load', () => applyBasemapTheme(map, theme));
        return;
    }
    const previous = appliedTheme ? basemapLayers(appliedTheme) : [];
    const prevById = new Map(previous.map(l => [l.id, l]));
    appliedTheme = theme;
    for (const layer of basemapLayers(theme)) {
        if (!map.getLayer(layer.id)) {
            continue;
        }
        const old = prevById.get(layer.id) || {};
        for (const kind of ['paint', 'layout']) {
            const next = layer[kind] || {};
            const prev = old[kind] || {};
            const set = kind === 'paint' ? map.setPaintProperty.bind(map) : map.setLayoutProperty.bind(map);
            for (const key of Object.keys(prev)) {
                if (!(key in next) && key !== 'visibility') {
                    set(layer.id, key, undefined);
                }
            }
            for (const [key, value] of Object.entries(next)) {
                set(layer.id, key, value);
            }
        }
    }
    map.setSprite(spriteUrl(theme));
}

/** Record the theme the initial style was built with */
export function setInitialBasemapTheme(theme) {
    appliedTheme = theme;
}
