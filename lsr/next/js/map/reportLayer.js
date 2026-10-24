// ============================================================================
// REPORT LAYER - Storm report icons drawn with WebGL (MapLibre symbol layer)
// ============================================================================
//
// One GeoJSON source + one symbol layer per report set (LSR, PNS). All reports
// are drawn, overlapping allowed; symbol-sort-key puts severe/large reports on
// top. Clicking an icon opens the report's popup.

import { ensureIconImage } from './iconService.js';

/** Draw priority by report type (higher draws on top) */
const TYPE_PRIORITY = {
    'Tornado': 900,
    'Waterspout': 850,
    'Funnel Cloud': 800,
    'Hail': 700,
    'Thunderstorm': 650,
    'Tropical': 600,
    'Wind': 550,
    'Flood': 500,
    'Coastal Flooding': 480,
    'Snow Squall': 450,
    'Freezing Rain': 420,
    'Ice': 400,
    'Sleet': 380,
    'Snow': 350,
    'Rain': 300,
    'Wildfire': 250,
    'Temperature': 200,
    'Fog': 150
};

function sortKey(report) {
    const base = TYPE_PRIORITY[report.filterType] ?? TYPE_PRIORITY[report.category] ?? 100;
    const mag = Number(report.magnitude) || 0;
    // Larger magnitude on top within a type (log keeps it below the next type's band)
    return base + Math.min(49, Math.log10(1 + Math.abs(mag)) * 20);
}

export class ReportLayer {
    /**
     * @param {object} maplibregl  the MapLibre module (for Popup)
     * @param {object} options
     * @param {string} options.id               source/layer id
     * @param {Function} options.popupHtml      (report) => html string, or null for no popup
     * @param {Function} [options.onOpen]       (report, popupElement) => void after the popup opens
     * @param {Function} [options.onClick]      (report) => void for reports without a popup
     * @param {Function} [options.isClickBlocked] () => boolean, e.g. while drawing bounds
     * @param {Function} [options.featureProperties] (report) => extra feature properties (e.g. time)
     * @param {object} [options.sourceOptions] extra GeoJSON source options (e.g. { promoteId: 'i' } for feature state)
     * @param {Function} [options.acceptsReport] (report) => false to ignore clicks on it (e.g. hidden)
     */
    constructor(maplibregl, { id, popupHtml, onOpen, onClick, isClickBlocked, featureProperties, sourceOptions, acceptsReport }) {
        this.maplibregl = maplibregl;
        this.id = id;
        this.popupHtml = popupHtml;
        this.onOpen = onOpen;
        this.onClick = onClick;
        this.isClickBlocked = isClickBlocked || (() => false);
        this.featureProperties = featureProperties || null;
        this.sourceOptions = sourceOptions || {};
        this.acceptsReport = acceptsReport || null;
        this.filter = null;
        this.paintOverrides = {};
        this.map = null;
        this.reports = [];
        this.popup = null;
    }

    /**
     * Add the source and layer (call once the style has loaded).
     */
    addTo(map, beforeId) {
        this.map = map;
        map.addSource(this.id, {
            type: 'geojson',
            data: this.featureCollection(),
            buffer: 32,
            ...this.sourceOptions
        });
        map.addLayer({
            id: this.id,
            type: 'symbol',
            source: this.id,
            layout: {
                'icon-image': ['get', 'icon'],
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
                'symbol-sort-key': ['get', 'sort']
            },
            paint: { ...this.paintOverrides },
            ...(this.filter ? { filter: this.filter } : {})
        }, beforeId);

        map.on('mouseenter', this.id, () => {
            if (!this.isClickBlocked()) map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', this.id, () => {
            if (!this.isClickBlocked()) map.getCanvas().style.cursor = '';
        });
        this.render();
        return this;
    }

    featureCollection() {
        const features = [];
        for (let i = 0; i < this.reports.length; i++) {
            const r = this.reports[i];
            if (!r.icon || !Number.isFinite(r.lat) || !Number.isFinite(r.lon)) {
                continue;
            }
            features.push({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
                properties: {
                    ...(this.featureProperties ? this.featureProperties(r) : {}),
                    i,
                    icon: r.icon.id,
                    sort: sortKey(r)
                }
            });
        }
        return { type: 'FeatureCollection', features };
    }

    render() {
        if (!this.map) {
            return;
        }
        for (const r of this.reports) {
            ensureIconImage(this.map, r.icon);
        }
        const source = this.map.getSource(this.id);
        if (source) {
            source.setData(this.featureCollection());
        }
    }

    /** Layer filter expression (null for none); kept across addTo */
    setFilter(filter) {
        this.filter = filter;
        if (this.map?.getLayer(this.id)) {
            this.map.setFilter(this.id, filter);
        }
    }

    /** Paint property on the icon layer (e.g. icon-opacity); kept across addTo */
    setPaintProperty(name, value) {
        this.paintOverrides[name] = value;
        if (this.map?.getLayer(this.id)) {
            this.map.setPaintProperty(this.id, name, value);
        }
    }

    /** Replace the displayed reports */
    setReports(reports) {
        this.reports = reports || [];
        this.closePopup();
        this.render();
    }

    clear() {
        this.setReports([]);
    }

    /**
     * Bounds of the displayed reports as {south, north, east, west}, or null
     */
    getBounds() {
        let south = Infinity, north = -Infinity, west = Infinity, east = -Infinity;
        for (const r of this.reports) {
            if (!Number.isFinite(r.lat) || !Number.isFinite(r.lon)) continue;
            south = Math.min(south, r.lat);
            north = Math.max(north, r.lat);
            west = Math.min(west, r.lon);
            east = Math.max(east, r.lon);
        }
        return south === Infinity ? null : { south, north, east, west };
    }

    closePopup() {
        if (this.popup) {
            this.popup.remove();
            this.popup = null;
        }
    }

    /** Clickable layer ids (see routeFeatureClick in mapSetup.js) */
    get layerIds() {
        return [this.id];
    }

    /** Whether a click on this feature should open it (see routeFeatureClick) */
    acceptsFeature(feature) {
        const report = this.reports[feature.properties.i];
        return Boolean(report) && (!this.acceptsReport || this.acceptsReport(report));
    }

    /** Handle a click on one of this layer's features */
    handleFeature(feature) {
        if (this.isClickBlocked()) {
            return;
        }
        const report = this.reports[feature.properties.i];
        if (!report) {
            return;
        }
        if (!this.popupHtml) {
            if (this.onClick) this.onClick(report);
            return;
        }
        const html = this.popupHtml(report);
        if (!html) {
            if (this.onClick) this.onClick(report);
            return;
        }
        this.closePopup();
        const offset = Math.round((report.icon?.size || 28) / 2);
        this.popup = new this.maplibregl.Popup({
            maxWidth: '350px',
            className: 'custom-popup',
            offset,
            focusAfterOpen: false
        })
            .setLngLat([report.lon, report.lat])
            .setHTML(html)
            .addTo(this.map);
        if (this.onOpen) {
            this.onOpen(report, this.popup.getElement());
        }
    }
}
