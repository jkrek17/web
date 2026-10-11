// ============================================================================
// OVERLAY LAYERS - Selected area outline, warnings/watches
// ============================================================================

import { createAlertIcon, ensureIconImage } from './iconService.js';

const AREA_COLOR = '#dc2626';

/**
 * Selected location outline (state / CWA / NWS region polygons, bbox rectangles)
 * and the first corner marker of the "click two corners" bounds tool.
 */
export class AreaOverlay {
    constructor(id = 'user-area') {
        this.id = id;
        this.map = null;
        this.features = [];
    }

    addTo(map, beforeId) {
        this.map = map;
        map.addSource(this.id, { type: 'geojson', data: this.collection() });
        map.addLayer({
            id: `${this.id}-fill`,
            type: 'fill',
            source: this.id,
            filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['==', ['get', 'fill'], true]],
            paint: { 'fill-color': AREA_COLOR, 'fill-opacity': 0.06 }
        }, beforeId);
        map.addLayer({
            id: `${this.id}-line`,
            type: 'line',
            source: this.id,
            filter: ['==', ['geometry-type'], 'Polygon'],
            paint: { 'line-color': AREA_COLOR, 'line-width': 2, 'line-dasharray': [2.5, 2.5] }
        }, beforeId);
        map.addLayer({
            id: `${this.id}-point`,
            type: 'circle',
            source: this.id,
            filter: ['==', ['geometry-type'], 'Point'],
            paint: {
                'circle-radius': 6,
                'circle-color': AREA_COLOR,
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 2
            }
        });
        return this;
    }

    collection() {
        return { type: 'FeatureCollection', features: this.features };
    }

    update() {
        const source = this.map?.getSource(this.id);
        if (source) {
            source.setData(this.collection());
        }
    }

    clear() {
        this.features = [];
        this.update();
    }

    /** Add GeoJSON polygon features (filled, dashed outline) */
    addFeatures(features) {
        for (const f of features) {
            this.features.push({ type: 'Feature', geometry: f.geometry, properties: { fill: true } });
        }
        this.update();
    }

    /** Add an unfilled dashed rectangle */
    addRectangle(south, north, east, west) {
        this.features.push({
            type: 'Feature',
            geometry: {
                type: 'Polygon',
                coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]]
            },
            properties: { fill: false }
        });
        this.update();
    }

    addPoint(lat, lon) {
        this.features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [lon, lat] },
            properties: {}
        });
        this.update();
    }
}

/**
 * NWS alerts (warnings or watches): translucent polygons plus point markers,
 * each with an HTML popup.
 */
export class AlertLayer {
    /**
     * @param {object} maplibregl  the MapLibre module (for Popup)
     * @param {string} id
     */
    constructor(maplibregl, id, { sourceOptions, paint, acceptsAlert } = {}) {
        this.maplibregl = maplibregl;
        this.id = id;
        // Optional: extra source options (e.g. { promoteId: 'i' } for feature state),
        // paint overrides per sub-layer ({ fill: {...}, line: {...}, point: {...} }),
        // and a click filter (alert) => boolean
        this.sourceOptions = sourceOptions || {};
        this.paintOverrides = paint || {};
        this.acceptsAlert = acceptsAlert || null;
        this.map = null;
        this.alerts = [];
        this.visible = true;
        this.popup = null;
        this.extraFilter = null;
    }

    /** Geometry filter of each sub-layer, combined with extraFilter */
    layerFilter(suffix) {
        const geom = suffix === 'point'
            ? ['==', ['geometry-type'], 'Point']
            : ['==', ['geometry-type'], 'Polygon'];
        return this.extraFilter ? ['all', geom, this.extraFilter] : geom;
    }

    /**
     * Extra filter on all alerts, e.g. a time window over properties set
     * through setAlerts(... { properties }) (null for none)
     */
    setFilter(filter) {
        this.extraFilter = filter;
        if (!this.map) return;
        for (const suffix of ['fill', 'line', 'point']) {
            if (this.map.getLayer(`${this.id}-${suffix}`)) {
                this.map.setFilter(`${this.id}-${suffix}`, this.layerFilter(suffix));
            }
        }
    }

    /**
     * @param {string} areaBeforeId layer to put polygons under (basemap labels)
     */
    addTo(map, areaBeforeId) {
        this.map = map;
        map.addSource(this.id, { type: 'geojson', data: this.collection(), ...this.sourceOptions });
        map.addLayer({
            id: `${this.id}-fill`,
            type: 'fill',
            source: this.id,
            filter: this.layerFilter('fill'),
            paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.12, ...this.paintOverrides.fill }
        }, areaBeforeId);
        map.addLayer({
            id: `${this.id}-line`,
            type: 'line',
            source: this.id,
            filter: this.layerFilter('line'),
            paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-opacity': 0.5, ...this.paintOverrides.line }
        }, areaBeforeId);
        map.addLayer({
            id: `${this.id}-point`,
            type: 'symbol',
            source: this.id,
            filter: this.layerFilter('point'),
            layout: {
                'icon-image': ['get', 'icon'],
                'icon-allow-overlap': true,
                'icon-ignore-placement': true
            },
            paint: { 'icon-opacity': 0.85, ...this.paintOverrides.point }
        });
        // Leave the crosshair alone while the bounds tool is active
        const setCursor = (cursor) => {
            const canvas = map.getCanvas();
            if (canvas.style.cursor !== 'crosshair') canvas.style.cursor = cursor;
        };
        for (const layerId of this.layerIds) {
            map.on('mouseenter', layerId, () => setCursor('pointer'));
            map.on('mouseleave', layerId, () => setCursor(''));
        }
        this.applyVisibility();
        return this;
    }

    collection() {
        const features = [];
        if (this.visible) {
            this.alerts.forEach((a, i) => {
                const geom = a.geometry;
                if (!geom) return;
                const properties = { ...(a.properties || {}), i, color: a.color, icon: a.icon?.id || '' };
                if (geom.type === 'Point' || geom.type === 'Polygon') {
                    features.push({ type: 'Feature', geometry: geom, properties });
                } else if (geom.type === 'MultiPolygon') {
                    // Outer rings only, as before
                    for (const poly of geom.coordinates) {
                        features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [poly[0]] }, properties });
                    }
                }
            });
        }
        return { type: 'FeatureCollection', features };
    }

    update() {
        if (!this.map) return;
        for (const a of this.alerts) {
            if (a.icon) ensureIconImage(this.map, a.icon);
        }
        const source = this.map.getSource(this.id);
        if (source) source.setData(this.collection());
    }

    /**
     * @param {Array<{geometry, color, emoji, popupHtml, properties?}>} alerts
     */
    setAlerts(alerts) {
        this.alerts = alerts.map(a => ({ ...a, icon: createAlertIcon(a.color, a.emoji) }));
        this.closePopup();
        this.update();
    }

    clear() {
        this.setAlerts([]);
    }

    show() {
        this.visible = true;
        this.applyVisibility();
    }

    hide() {
        this.visible = false;
        this.applyVisibility();
    }

    isVisible() {
        return this.visible;
    }

    applyVisibility() {
        if (!this.map) return;
        const v = this.visible ? 'visible' : 'none';
        for (const suffix of ['fill', 'line', 'point']) {
            if (this.map.getLayer(`${this.id}-${suffix}`)) {
                this.map.setLayoutProperty(`${this.id}-${suffix}`, 'visibility', v);
            }
        }
        if (!this.visible) this.closePopup();
    }

    closePopup() {
        if (this.popup) {
            this.popup.remove();
            this.popup = null;
        }
    }

    /** Clickable layer ids (see routeFeatureClick in mapSetup.js) */
    get layerIds() {
        return [`${this.id}-point`, `${this.id}-fill`];
    }

    /** Whether a click on this feature should open it (see routeFeatureClick) */
    acceptsFeature(feature) {
        const alert = this.alerts[feature.properties.i];
        return Boolean(alert) && (!this.acceptsAlert || this.acceptsAlert(alert));
    }

    /** Handle a click on one of this layer's features */
    handleFeature(feature, lngLat) {
        const alert = this.alerts[feature.properties.i];
        if (!alert) return;
        this.closePopup();
        this.popup = new this.maplibregl.Popup({ maxWidth: '400px', className: 'warning-popup-container', focusAfterOpen: false })
            .setLngLat(lngLat)
            .setHTML(alert.popupHtml)
            .addTo(this.map);
    }
}
