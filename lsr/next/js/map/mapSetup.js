// ============================================================================
// MAP SETUP - Shared by the main map (app.js) and the playback page
// ============================================================================

import * as maplibregl from '../../lib/maplibre/maplibre-gl.js';
import { installIconImageHandler } from './iconService.js';
import { buildBasemapStyle, resolveBasemapUrl, setInitialBasemapTheme } from './basemap.js';

export { maplibregl };

const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
let protocolInstalled = false;

/**
 * Theme to start with: saved preference, or system preference for 'auto'
 */
export function getSavedTheme() {
    let savedTheme = 'light';
    try {
        savedTheme = localStorage.getItem('lsr-theme') || 'light';
    } catch (e) {
        // Storage unavailable (private mode); use the default
    }
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    return savedTheme === 'auto' ? (prefersDark ? 'dark' : 'light') : savedTheme;
}

/**
 * Create a MapLibre map on the self-hosted basemap.
 * @param {string} container element id
 * @param {object} options
 * @param {string} options.theme 'light' | 'dark'
 * @param {[number, number]} options.center [lon, lat]
 * @param {number} options.zoom
 * @returns {Promise<{map: object, basemapSource: {url: string, detail: string}}>}
 */
export async function createMap(container, { theme, center, zoom }) {
    if (!protocolInstalled) {
        // Vendored as .js (not .mjs) so any web server sends a JavaScript MIME type
        maplibregl.setWorkerUrl(new URL('../../lib/maplibre/maplibre-gl-worker.js', import.meta.url).href);
        const protocol = new pmtiles.Protocol();
        maplibregl.addProtocol('pmtiles', protocol.tile);
        protocolInstalled = true;
    }

    const basemapSource = await resolveBasemapUrl(CONFIG.BASEMAP);
    setInitialBasemapTheme(theme);

    const map = new maplibregl.Map({
        container,
        style: buildBasemapStyle(theme, basemapSource.url),
        center,
        zoom,
        maxZoom: 18,
        attributionControl: false,
        // Flat 2D map
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false
    });
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
    map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-left');
    // Bottom-left: the bottom-right corner is left free for page controls
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
    installIconImageHandler(map);
    if (basemapSource.detail === 'streets') {
        document.getElementById(container)?.setAttribute('data-basemap', 'streets');
    }

    if (isLocalhost) {
        window.lsrMap = map; // debugging / browser tests
    }
    map.on('error', (e) => {
        if (isLocalhost) {
            console.warn('[Map]', e.error?.message || e);
        }
    });

    return { map, basemapSource };
}

/**
 * Open the popup of the topmost report or alert under a click (one per click).
 * @param {object} map
 * @param {object} e  MapLibre click event
 * @param {Array} targets  layers exposing layerIds and handleFeature(feature, lngLat)
 * @returns {boolean} true if a feature handled the click
 */
export function routeFeatureClick(map, e, targets) {
    const owners = new Map();
    for (const target of targets) {
        for (const id of target?.layerIds || []) {
            if (map.getLayer(id)) {
                owners.set(id, target);
            }
        }
    }
    if (owners.size === 0) {
        return false;
    }
    const tolerance = 3;
    const box = [[e.point.x - tolerance, e.point.y - tolerance], [e.point.x + tolerance, e.point.y + tolerance]];
    // Topmost first; skip features their layer says are not clickable right now
    // (e.g. reports not yet reached by the playback clock, drawn fully transparent)
    const feature = map.queryRenderedFeatures(box, { layers: [...owners.keys()] })
        .find(f => owners.get(f.layer.id).acceptsFeature?.(f) !== false);
    if (!feature) {
        return false;
    }
    owners.get(feature.layer.id).handleFeature(feature, e.lngLat);
    return true;
}
