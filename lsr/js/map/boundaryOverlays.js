// ============================================================================
// NWS boundary GeoJSON for map overlays (states + County Warning Areas)
// Source: NOAA mapservices FeatureServer (same boundaries NWS uses for GIS)
// ============================================================================

const CWA_URL =
    'https://mapservices.weather.noaa.gov/static/rest/services/nws_reference_maps/nws_reference_map/FeatureServer/1/query?' +
    'where=1%3D1&outFields=cwa%2Cwfo%2Ccitystate%2Cregion&returnGeometry=true&outSR=4326&maxAllowableOffset=0.02&f=geojson';

const STATE_URL =
    'https://mapservices.weather.noaa.gov/static/rest/services/nws_reference_maps/nws_reference_map/FeatureServer/3/query?' +
    'where=1%3D1&outFields=state%2Cname&returnGeometry=true&outSR=4326&maxAllowableOffset=0.02&f=geojson';

/** NWS admin region keys -> CWA `region` attribute (ER, CR, SR, WR, AR, PR) */
const NWS_REGION_TO_CWA_REGION = {
    nws_eastern: ['ER'],
    nws_southern: ['SR'],
    nws_central: ['CR'],
    nws_western: ['WR'],
    nws_alaska: ['AR'],
    nws_pacific: ['PR']
};

let cwaCollection = null;
let stateCollection = null;
let loadPromise = null;

async function fetchJson(url) {
    const res = await fetch(url, { headers: { Accept: 'application/geo+json, application/json' } });
    if (!res.ok) {
        throw new Error(`Boundary fetch failed: ${res.status}`);
    }
    return res.json();
}

/**
 * Load CWA + state polygons (cached). Safe to call multiple times.
 */
export function loadBoundaryGeoJson() {
    if (!loadPromise) {
        loadPromise = Promise.all([fetchJson(CWA_URL), fetchJson(STATE_URL)])
            .then(([cwa, states]) => {
                cwaCollection = cwa && cwa.type === 'FeatureCollection' ? cwa : null;
                stateCollection = states && states.type === 'FeatureCollection' ? states : null;
            })
            .catch((err) => {
                loadPromise = null;
                throw err;
            });
    }
    return loadPromise;
}

export function boundariesReady() {
    return Boolean(cwaCollection && stateCollection);
}

function normalizeWfoCode(code) {
    if (!code) {
        return '';
    }
    const c = String(code).trim().toUpperCase();
    return c.startsWith('K') ? c.slice(1) : c;
}

function featuresForState(stateCode) {
    if (!stateCollection?.features || !stateCode) {
        return [];
    }
    const want = String(stateCode).toUpperCase();
    return stateCollection.features.filter((f) => {
        const st = f.properties?.state || f.properties?.STATE;
        return st && String(st).toUpperCase() === want;
    });
}

function featureForWfo(wfoCode) {
    if (!cwaCollection?.features || !wfoCode) {
        return null;
    }
    const want = normalizeWfoCode(wfoCode);
    return (
        cwaCollection.features.find((f) => {
            const w = f.properties?.wfo || f.properties?.WFO;
            return w && String(w).toUpperCase() === want;
        }) || null
    );
}

function featuresForNwsAdminRegion(regionKey) {
    const codes = NWS_REGION_TO_CWA_REGION[regionKey];
    if (!codes || !cwaCollection?.features) {
        return [];
    }
    const upper = new Set(codes.map((c) => String(c).toUpperCase()));
    return cwaCollection.features.filter((f) => {
        const r = f.properties?.region || f.properties?.REGION;
        return r && upper.has(String(r).toUpperCase());
    });
}

/**
 * Bounding box of GeoJSON polygon features as {south, north, east, west}, or null
 */
export function boundsOfFeatures(features) {
    if (!features || features.length === 0) {
        return null;
    }
    let south = Infinity, north = -Infinity, west = Infinity, east = -Infinity;
    const visit = (coords) => {
        if (typeof coords[0] === 'number') {
            const [lng, lat] = coords;
            if (lat < south) south = lat;
            if (lat > north) north = lat;
            if (lng < west) west = lng;
            if (lng > east) east = lng;
            return;
        }
        for (const c of coords) visit(c);
    };
    for (const f of features) {
        if (f?.geometry?.coordinates) visit(f.geometry.coordinates);
    }
    return south === Infinity ? null : { south, north, east, west };
}

/**
 * @param {string} stateCode e.g. IL
 * @returns {Array} polygon features (empty if unknown or not loaded)
 */
export function getStateBoundaryFeatures(stateCode) {
    return featuresForState(stateCode);
}

/**
 * @param {string} wfoCode e.g. LOT or KLOT
 */
export function getWfoBoundaryFeatures(wfoCode) {
    const f = featureForWfo(wfoCode);
    return f ? [f] : [];
}

/**
 * @param {string} regionKey CONFIG.REGIONS key for NWS admin regions
 */
export function getNwsAdminRegionFeatures(regionKey) {
    return featuresForNwsAdminRegion(regionKey);
}

export function isNwsAdminRegionWithGeoJson(regionKey) {
    return Boolean(NWS_REGION_TO_CWA_REGION[regionKey]);
}

/**
 * GeoJSON features for point-in-polygon filtering (same polygons as map overlay).
 * Returns null to use axis-aligned bbox only (full US, custom region, or GeoJSON not loaded).
 */
export function getClipFeaturesForSelection(selectedRegion, wfoCode) {
    if (!boundariesReady()) {
        return null;
    }
    if (wfoCode) {
        const f = featureForWfo(wfoCode);
        return f ? [f] : null;
    }
    if (selectedRegion && featuresForState(selectedRegion).length) {
        return featuresForState(selectedRegion);
    }
    if (selectedRegion && isNwsAdminRegionWithGeoJson(selectedRegion)) {
        const list = featuresForNwsAdminRegion(selectedRegion);
        return list.length ? list : null;
    }
    return null;
}

function ringContainsLngLat(lng, lat, ring) {
    if (!ring || ring.length < 3) {
        return false;
    }
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0];
        const yi = ring[i][1];
        const xj = ring[j][0];
        const yj = ring[j][1];
        const intersect =
            yi > lat !== yj > lat &&
            lng < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-12) + xi;
        if (intersect) {
            inside = !inside;
        }
    }
    return inside;
}

function polygonContainsLngLat(lng, lat, coordinates) {
    if (!coordinates || !coordinates.length) {
        return false;
    }
    if (!ringContainsLngLat(lng, lat, coordinates[0])) {
        return false;
    }
    for (let h = 1; h < coordinates.length; h++) {
        if (ringContainsLngLat(lng, lat, coordinates[h])) {
            return false;
        }
    }
    return true;
}

function geometryContainsLngLat(lng, lat, geometry) {
    if (!geometry) {
        return false;
    }
    const { type, coordinates } = geometry;
    if (type === 'Polygon') {
        return polygonContainsLngLat(lng, lat, coordinates);
    }
    if (type === 'MultiPolygon') {
        for (const poly of coordinates) {
            if (polygonContainsLngLat(lng, lat, poly)) {
                return true;
            }
        }
        return false;
    }
    return false;
}

/**
 * True if (lat, lon) lies inside any of the GeoJSON polygon / multipolygon features.
 */
export function pointInClipFeatures(lat, lon, features) {
    if (!features || features.length === 0) {
        return false;
    }
    const lng = lon;
    for (const f of features) {
        const g = f.geometry;
        if (g && geometryContainsLngLat(lng, lat, g)) {
            return true;
        }
    }
    return false;
}
