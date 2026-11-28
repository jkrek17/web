/**
 * Oceanic Forecast - preloaded animation frames
 *
 * NOAA renders each 512 px tile in roughly 0.3-0.6 s, so a tiled forecast
 * step takes a second or more to appear. Here each forecast hour is fetched
 * as ONE GetMap image covering the visible map (plus a margin) and kept in
 * memory as a Blob. A cached step is shown instantly through a MapLibre
 * image source; the app keeps tiles for the sharp static view and uses
 * frames for scrubbing and playback.
 *
 * Frames belong to a "view" (bbox + pixel size). Small pans inside the
 * margin keep the current frames; a larger move or zoom starts a new view
 * and refetches. All requests share the throttled NOAA pool at low
 * priority, behind visible tiles.
 *
 * API: Oceanic.Frames.init(map, onChange), .prepare([{ id, ms }]),
 *      .isReady(id, ms), .whenReady(id, ms, timeoutMs), .show(slot, id, ms),
 *      .hide(slot), .setPaint(slot, prop, value), .progress()
 */
window.Oceanic = window.Oceanic || {};

window.Oceanic.Frames = (function () {
    'use strict';

    var Ndfd = window.Oceanic.Ndfd;
    var WORLD = 20037508.342789244 * 2;
    var MAX_LAT = 85;
    var MAX_SIDE = 2048;
    var MIN_SIDE = 256;
    var MARGIN = 0.15;        // fraction of the view added on each side
    var REZOOM = 0.6;         // zoom change that forces a new view

    var map;
    var onChange = function () {};
    var view = null;          // { bbox, coords, width, height, zoom, west, east, south, north }
    var cache = new Map();    // 'id|ms' -> { state, url, promise, resolve }
    var ctrl = null;          // AbortController for the current view's fetches
    var slots = {};           // slot -> { source, layer, shown }
    var wanted = 0;

    function key(id, ms) { return id + '|' + ms; }

    function mercX(lng) { return lng / 360 * WORLD; }

    function mercY(lat) {
        var r = lat * Math.PI / 180;
        return Math.log(Math.tan(Math.PI / 4 + r / 2)) / (2 * Math.PI) * WORLD;
    }

    function computeView() {
        var b = map.getBounds();
        var west = b.getWest();
        var east = b.getEast();
        var south = Math.max(-MAX_LAT, b.getSouth());
        var north = Math.min(MAX_LAT, b.getNorth());
        var spanX = east - west;
        var spanY = north - south;
        west -= spanX * MARGIN;
        east += spanX * MARGIN;
        south = Math.max(-MAX_LAT, south - spanY * MARGIN);
        north = Math.min(MAX_LAT, north + spanY * MARGIN);
        if (east - west >= 360) {
            var mid = (east + west) / 2;
            west = mid - 180;
            east = mid + 180;
        }
        // Express the bounds around the map's own longitude, then split at
        // the antimeridian: an image source on the globe must stay within
        // +/-180, so a view across the date line uses two images.
        var shift = Math.round((map.getCenter().wrap().lng - (west + east) / 2) / 360) * 360;
        west += shift;
        east += shift;
        var spans = west < -180 ? [[west + 360, 180], [-180, east]] :
            east > 180 ? [[west, 180], [-180, east - 360]] : [[west, east]];
        var zoom = map.getZoom();
        // Same resolution as 512 px tiles at this zoom
        var pxPerMerc = 512 * Math.pow(2, zoom) / WORLD;
        var y0 = mercY(south);
        var y1 = mercY(north);
        var totalW = (mercX(east) - mercX(west)) * pxPerMerc;
        var totalH = (y1 - y0) * pxPerMerc;
        var scale = Math.min(1, MAX_SIDE / Math.max(totalW, totalH));
        var parts = spans.map(function (sp) {
            var bbox = [mercX(sp[0]), y0, mercX(sp[1]), y1];
            return {
                bbox: bbox,
                width: Math.max(MIN_SIDE, Math.round((bbox[2] - bbox[0]) * pxPerMerc * scale)),
                height: Math.max(MIN_SIDE, Math.round(totalH * scale)),
                coords: [[sp[0], north], [sp[1], north], [sp[1], south], [sp[0], south]]
            };
        });
        return { parts: parts, zoom: zoom, west: west, east: east, south: south, north: north };
    }

    // Is the visible map still inside the current frames, at a similar zoom?
    function covers() {
        if (!view || Math.abs(view.zoom - map.getZoom()) > REZOOM) return false;
        var b = map.getBounds();
        var w = b.getWest();
        var e = b.getEast();
        // Compare in the view's longitude frame (bounds may be shifted by 360)
        var shift = Math.round(((view.west + view.east) / 2 - (w + e) / 2) / 360) * 360;
        return w + shift >= view.west && e + shift <= view.east &&
            Math.max(-MAX_LAT, b.getSouth()) >= view.south - 0.01 && Math.min(MAX_LAT, b.getNorth()) <= view.north + 0.01;
    }

    function resetView() {
        if (ctrl) ctrl.abort();
        ctrl = new AbortController();
        cache.forEach(function (entry) {
            if (entry.urls) entry.urls.forEach(function (u) { URL.revokeObjectURL(u); });
            if (entry.resolve) entry.resolve(false);
        });
        cache.clear();
        view = computeView();
    }

    function fetchFrame(id, ms) {
        var k = key(id, ms);
        var entry = { state: 'loading', urls: null };
        entry.promise = new Promise(function (resolve) { entry.resolve = resolve; });
        cache.set(k, entry);
        var v = view;
        var signal = ctrl.signal;
        Promise.all(v.parts.map(function (part) {
            return Ndfd.fetchViewImage(id, ms, part.bbox, part.width, part.height, signal);
        })).then(function (blobs) {
            if (cache.get(k) !== entry) return;
            entry.urls = blobs.map(function (blob) { return URL.createObjectURL(blob); });
            entry.state = 'ready';
            entry.resolve(true);
            entry.resolve = null;
            onChange();
        }, function () {
            if (cache.get(k) !== entry) return;
            entry.state = 'error';
            entry.resolve(false);
            entry.resolve = null;
            onChange();
        });
    }

    // requests: [{ id, ms }] in priority order (nearest steps first)
    function prepare(requests) {
        if (!map) return;
        if (!covers()) resetView();
        var seen = {};
        wanted = 0;
        requests.forEach(function (r) {
            var k = key(r.id, r.ms);
            if (seen[k]) return;
            seen[k] = true;
            wanted++;
            var entry = cache.get(k);
            if (!entry || entry.state === 'error') fetchFrame(r.id, r.ms);
        });
        // Drop frames no longer wanted (e.g. product switched)
        cache.forEach(function (entry, k) {
            if (seen[k]) return;
            if (entry.urls) entry.urls.forEach(function (u) { URL.revokeObjectURL(u); });
            if (entry.resolve) entry.resolve(false);
            cache.delete(k);
        });
        onChange();
    }

    function isReady(id, ms) {
        var e = cache.get(key(id, ms));
        return !!(e && e.state === 'ready' && covers());
    }

    function whenReady(id, ms, timeoutMs) {
        var e = cache.get(key(id, ms));
        if (!e) return Promise.resolve(false);
        if (e.state === 'ready') return Promise.resolve(true);
        if (e.state === 'error') return Promise.resolve(false);
        return Promise.race([e.promise, new Promise(function (r) { setTimeout(function () { r(false); }, timeoutMs); })]);
    }

    // Each slot has two image sources/layers (date-line views use both)
    function ensurePart(s, i, url, coords) {
        var p = s.parts[i];
        if (!p.added) {
            // Image sources take no attribution; the app credits NDFD globally
            map.addSource(p.source, { type: 'image', url: url, coordinates: coords });
            if (!map.getSource(p.source)) return false; // rejected by style validation
            map.addLayer({
                id: p.layer, type: 'raster', source: p.source,
                paint: Object.assign({ 'raster-fade-duration': 0, 'raster-opacity': s.opacity }, s.paint)
            }, s.beforeId);
            if (!map.getLayer(p.layer)) return false;
            p.added = true;
        } else if (p.shown !== url) {
            map.getSource(p.source).updateImage({ url: url, coordinates: coords });
        }
        p.shown = url;
        map.setLayoutProperty(p.layer, 'visibility', 'visible');
        return true;
    }

    // Show a cached frame in a slot; false if it isn't cached for this view
    function show(slot, id, ms) {
        var e = cache.get(key(id, ms));
        if (!e || e.state !== 'ready' || !covers()) return false;
        var s = slots[slot];
        var ok = true;
        s.parts.forEach(function (p, i) {
            if (i < view.parts.length) ok = ensurePart(s, i, e.urls[i], view.parts[i].coords) && ok;
            else if (p.added) map.setLayoutProperty(p.layer, 'visibility', 'none');
        });
        if (!ok) hide(slot); // fall back to tiles
        return ok;
    }

    function hide(slot) {
        slots[slot].parts.forEach(function (p) {
            if (p.added) map.setLayoutProperty(p.layer, 'visibility', 'none');
        });
    }

    function setPaint(slot, prop, value) {
        var s = slots[slot];
        if (prop === 'raster-opacity') s.opacity = value;
        else s.paint[prop] = value;
        s.parts.forEach(function (p) {
            if (p.added) map.setPaintProperty(p.layer, prop, value);
        });
    }

    function progress() {
        var ready = 0;
        var loading = 0;
        cache.forEach(function (e) {
            if (e.state === 'ready') ready++;
            else if (e.state === 'loading') loading++;
        });
        return { ready: ready, loading: loading, total: wanted };
    }

    function readyMs(id) {
        var out = new Set();
        if (!covers()) return out;
        cache.forEach(function (e, k) {
            var parts = k.split('|');
            if (parts[0] === id && e.state === 'ready') out.add(Number(parts[1]));
        });
        return out;
    }

    return {
        // slotDefs: { name: { beforeId, opacity } }
        init: function (m, slotDefs, changed) {
            map = m;
            onChange = changed || onChange;
            Object.keys(slotDefs).forEach(function (name) {
                slots[name] = {
                    beforeId: slotDefs[name].beforeId, opacity: slotDefs[name].opacity, paint: {},
                    parts: [0, 1].map(function (i) {
                        var id = 'frames-' + name + '-' + i;
                        return { source: id, layer: id, added: false, shown: null };
                    })
                };
            });
        },
        prepare: prepare,
        isReady: isReady,
        whenReady: whenReady,
        show: show,
        hide: hide,
        setPaint: setPaint,
        progress: progress,
        readyMs: readyMs,
        covers: covers
    };
})();
