/**
 * Oceanic Forecast - application shell
 *
 * MapLibre GL globe with NDFD grids (js/oceanic-ndfd.js) and OPC PGEN
 * fronts/isobars (js/oceanic-pgen.js): timeline + playback, layer panel,
 * legend, click readout, status reporting and keyboard shortcuts.
 *
 * Page options (set window.OCEANIC_CONFIG before this script):
 *   geojsonDir     PGEN GeoJSON directory (default '/data/geoJson/')
 *   demoFrontsDir  load synthetic fronts named by hours from the current
 *                  cycle (Pacific_p024.geo.json, Atlantic_m006.geo.json)
 *   demoHours      hours that have demo files
 *   homeLink       { href, label } shown in the top bar
 */
(function () {
    'use strict';

    var Ndfd = window.Oceanic.Ndfd;
    var Pgen = window.Oceanic.Pgen;
    var Frames = window.Oceanic.Frames;

    var CONFIG = window.OCEANIC_CONFIG || {};
    var GEOJSON_DIR = CONFIG.geojsonDir || '/data/geoJson/';
    var DEMO_FRONTS_DIR = CONFIG.demoFrontsDir || null;
    var DEMO_HOURS = CONFIG.demoHours || [-12, -6, 0, 24, 48, 72, 96];

    var ESRI_OCEAN = 'https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}';
    var WARNINGS_WMS = 'https://mapservices.weather.noaa.gov/eventdriven/services/WWA/watch_warn_adv/MapServer/WMSServer';
    var HAZARDS_QUERY = 'https://mapservices.weather.noaa.gov/eventdriven/rest/services/WWA/watch_warn_adv/MapServer/1/query';
    var BASINS = ['Pacific', 'Atlantic'];

    var MIN_H = -12;
    var MAX_H = 96;
    var STEP_H = 3;
    var HOUR_MS = 3600000;
    var FRAME_MS = 1000;          // dwell per frame at 1x
    var END_HOLD_MS = 1500;       // extra pause on the last frame
    var SPEEDS = [0.5, 1, 2, 4];
    var HOME_VIEW = { center: [-105, 35], zoom: 1.8, bearing: 0, pitch: 0 };
    var PREFS_KEY = 'oceanic.prefs.v1';
    var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    var ICONS = {
        layers: '<path d="M12 3 2 8l10 5 10-5-10-5Z"/><path d="m2 13 10 5 10-5"/><path d="m2 18 10 5 10-5" opacity=".5"/>',
        help: '<circle cx="12" cy="12" r="9.5"/><path d="M9.5 9.2a2.6 2.6 0 0 1 5 1c0 1.8-2.5 2.2-2.5 3.8"/><circle cx="12" cy="17.3" r=".6" fill="currentColor"/>',
        close: '<path d="M6 6l12 12M18 6 6 18"/>',
        prev: '<path d="M15 6l-6 6 6 6"/>',
        next: '<path d="M9 6l6 6-6 6"/>',
        play: '<path d="M8 5.5v13l10.5-6.5L8 5.5Z" fill="currentColor"/>',
        pause: '<path d="M8 5v14M16 5v14" stroke-width="3"/>',
        waves: '<path d="M2 9c2.5-2.5 4.5-2.5 7 0s4.5 2.5 7 0 4.5-2.5 6-1"/><path d="M2 15c2.5-2.5 4.5-2.5 7 0s4.5 2.5 7 0 4.5-2.5 6-1"/>',
        wind: '<path d="M3 8h11a3 3 0 1 0-3-3"/><path d="M3 12h16a3 3 0 1 1-3 3"/><path d="M3 16h7"/>',
        gust: '<path d="M3 7h9a2.5 2.5 0 1 0-2.5-2.5"/><path d="M3 12h15a3 3 0 1 1-3 3"/><path d="M3 17h5M12 17h2"/>',
        none: '<circle cx="12" cy="12" r="8.5"/><path d="M6 18 18 6"/>',
        barb: '<path d="M4 20 18 6"/><path d="m18 6 3 4M15 9l3 4M12 12l1.6 2.2"/><circle cx="4" cy="20" r="1.4" fill="currentColor"/>'
    };

    var $ = function (id) { return document.getElementById(id); };

    // --- State ------------------------------------------------------------
    var state = {
        baseTime: getBaseTime(),
        hour: 0,
        product: 'waveh',
        opacity: 0.7,
        scale: 1,
        overlays: { fronts: true, isobars: true, centers: true, warnings: false, barbs: false },
        barbColor: 'black',
        speed: 1,
        holdEnd: true,
        playing: false,
        grid: null // last resolved grid time { status, ms }
    };

    var map;
    var gridLayer;
    var barbLayer;
    var popup = null;
    var applySeq = 0;
    var applyTimer = null;
    var frontsCache = new Map();

    // --- Utilities --------------------------------------------------------
    function getBaseTime() {
        var d = new Date();
        d.setUTCHours(Math.floor(d.getUTCHours() / 6) * 6, 0, 0, 0);
        return d.getTime();
    }

    function validMs(h) {
        return state.baseTime + h * HOUR_MS;
    }

    function pad(n, width) {
        return String(n).padStart(width, '0');
    }

    function sleep(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function icon(name) {
        return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" ' +
            'stroke-linecap="round" stroke-linejoin="round">' + ICONS[name] + '</svg>';
    }

    function fmtValid(ms) {
        var d = new Date(ms);
        return DAYS[d.getUTCDay()] + ' ' + pad(d.getUTCDate(), 2) + ' ' + MONTHS[d.getUTCMonth()] +
            ' · ' + pad(d.getUTCHours(), 2) + ':00 UTC';
    }

    function fmtShort(ms) {
        var d = new Date(ms);
        return DAYS[d.getUTCDay()] + ' ' + pad(d.getUTCHours(), 2) + 'Z';
    }

    function fmtCycle(ms) {
        var d = new Date(ms);
        return pad(d.getUTCHours(), 2) + 'Z ' + pad(d.getUTCDate(), 2) + ' ' + MONTHS[d.getUTCMonth()];
    }

    function fmtHour(h) {
        return (h > 0 ? '+' : h < 0 ? '−' : '') + Math.abs(h) + ' h';
    }

    function fmtLatLon(lat, lng, digits) {
        return Math.abs(lat).toFixed(digits) + '°' + (lat >= 0 ? 'N' : 'S') + ' ' +
            Math.abs(lng).toFixed(digits) + '°' + (lng >= 0 ? 'E' : 'W');
    }

    function fmtDegMin(lat, lng) {
        function dm(v) {
            var a = Math.abs(v);
            var deg = Math.floor(a);
            var min = Math.round((a - deg) * 60);
            if (min === 60) { deg += 1; min = 0; }
            return deg + '°' + pad(min, 2) + '′';
        }
        return dm(lat) + (lat >= 0 ? 'N' : 'S') + '  ' + dm(lng) + (lng >= 0 ? 'E' : 'W');
    }

    function isMobile() {
        return window.matchMedia('(max-width: 760px)').matches;
    }

    function loadPrefs() {
        try {
            var p = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
            if (!p) return;
            if (p.product && Ndfd.product(p.product).id === p.product) state.product = p.product;
            if (p.barbColor === 'black' || p.barbColor === 'white') state.barbColor = p.barbColor;
            if (SPEEDS.indexOf(p.speed) >= 0) state.speed = p.speed;
            if (typeof p.holdEnd === 'boolean') state.holdEnd = p.holdEnd;
            if (p.opacity >= 0.2 && p.opacity <= 1) state.opacity = p.opacity;
            if (p.scale >= 0.75 && p.scale <= 2) state.scale = p.scale;
            if (p.overlays) {
                Object.keys(state.overlays).forEach(function (k) {
                    if (typeof p.overlays[k] === 'boolean') state.overlays[k] = p.overlays[k];
                });
            }
            // Barbs used to be a base grid; keep showing them as the overlay
            if (p.product === 'wind') {
                state.product = 'none';
                state.overlays.barbs = true;
            }
        } catch (e) { /* storage unavailable: use defaults */ }
    }

    function savePrefs() {
        try {
            localStorage.setItem(PREFS_KEY, JSON.stringify({
                product: state.product, opacity: state.opacity, scale: state.scale, overlays: state.overlays,
                barbColor: state.barbColor, speed: state.speed, holdEnd: state.holdEnd
            }));
        } catch (e) { /* ignore */ }
    }

    // --- Status: chips, progress bar, toasts ---------------------------------
    function setChip(id, chipState, text, title) {
        var el = $(id);
        el.dataset.state = chipState;
        el.querySelector('span').textContent = text;
        el.title = title || text;
    }

    var progressCount = 0;
    var progressTimer = null;

    function progress(delta) {
        progressCount = Math.max(0, progressCount + delta);
        clearTimeout(progressTimer);
        if (progressCount > 0) {
            // Only show for loads that take a noticeable time
            progressTimer = setTimeout(function () { $('progress').classList.add('active'); }, 150);
        } else {
            $('progress').classList.remove('active');
        }
    }

    var toastTimes = {};

    function toast(message, opts) {
        opts = opts || {};
        var key = opts.key || message;
        var now = Date.now();
        if (opts.throttle && toastTimes[key] && now - toastTimes[key] < opts.throttle) return;
        toastTimes[key] = now;

        var existing = document.querySelector('.toast[data-key="' + CSS.escape(key) + '"]');
        if (existing) existing.remove();

        var el = document.createElement('div');
        el.className = 'toast toast-' + (opts.kind || 'info');
        el.dataset.key = key;
        var msg = document.createElement('span');
        msg.textContent = message;
        el.appendChild(msg);
        if (opts.action) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn btn-small';
            btn.textContent = opts.action.label;
            btn.addEventListener('click', function () { el.remove(); opts.action.run(); });
            el.appendChild(btn);
        }
        var close = document.createElement('button');
        close.type = 'button';
        close.className = 'icon-btn icon-btn-xs';
        close.setAttribute('aria-label', 'Dismiss');
        close.innerHTML = icon('close');
        close.addEventListener('click', function () { el.remove(); });
        el.appendChild(close);

        $('toasts').appendChild(el);
        if (opts.timeout !== 0) {
            setTimeout(function () { el.remove(); }, opts.timeout || 7000);
        }
    }

    // --- Fronts (PGEN) --------------------------------------------------------
    // Cycle that issued a fronts chart valid at validTime: analyses every 6 h,
    // F024/F048 from 00Z & 12Z, F072/F096 from 12Z only.
    function getBestFrontsFile(validTime) {
        for (var hoursBack = 0; hoursBack <= 96; hoursBack += 6) {
            var cycle = state.baseTime - hoursBack * HOUR_MS;
            var fHour = (validTime - cycle) / HOUR_MS;
            var cycleH = new Date(cycle).getUTCHours();
            if (fHour === 0 ||
                ((fHour === 24 || fHour === 48) && (cycleH === 0 || cycleH === 12)) ||
                ((fHour === 72 || fHour === 96) && cycleH === 12)) {
                return { cycle: cycle, fHour: fHour };
            }
        }
        return null;
    }

    function frontsSource(h) {
        if (DEMO_FRONTS_DIR) {
            if (DEMO_HOURS.indexOf(h) < 0) return null;
            var tag = (h < 0 ? 'm' : 'p') + pad(Math.abs(h), 3);
            return {
                key: 'demo' + tag,
                label: h === 0 ? 'Demo analysis' : 'Demo ' + fmtHour(h),
                paths: BASINS.map(function (b) { return DEMO_FRONTS_DIR + b + '_' + tag + '.geo.json'; })
            };
        }
        var info = getBestFrontsFile(validMs(h));
        if (!info) return null;
        var d = new Date(info.cycle);
        var stamp = d.getUTCFullYear() + pad(d.getUTCMonth() + 1, 2) + pad(d.getUTCDate(), 2) + '.' +
            pad(d.getUTCHours(), 2) + '00.F' + pad(info.fHour, 3);
        var cycleZ = pad(d.getUTCHours(), 2) + 'Z';
        return {
            key: stamp,
            label: info.fHour === 0 ? 'Analysis ' + cycleZ : 'F' + pad(info.fHour, 3) + ' · ' + cycleZ + ' cycle',
            paths: BASINS.map(function (b) { return GEOJSON_DIR + b + '_HS_Surface.' + stamp + '.geo.json'; })
        };
    }

    // [] for a missing basin file (404); throws on network/server errors
    function fetchFeatures(path) {
        var ctrl = new AbortController();
        var timer = setTimeout(function () { ctrl.abort(); }, 15000);
        return fetch(path, { signal: ctrl.signal }).then(function (r) {
            clearTimeout(timer);
            if (r.status === 404) return [];
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json().then(function (j) { return (j && j.features) || []; });
        }, function (err) {
            clearTimeout(timer);
            throw err;
        });
    }

    // -> Promise<{ fc } | { empty: true } | { error }>, cached per chart
    function loadFronts(src) {
        if (frontsCache.has(src.key)) return frontsCache.get(src.key);
        var p = Promise.all(src.paths.map(fetchFeatures)).then(function (results) {
            var all = [].concat.apply([], results);
            if (!all.length) return { empty: true };
            return { fc: Pgen.process(all) };
        }).catch(function (err) {
            frontsCache.delete(src.key); // retry on next visit
            return { error: err };
        });
        frontsCache.set(src.key, p);
        return p;
    }

    function nextFrontsHour(h) {
        for (var x = h + STEP_H; x <= MAX_H; x += STEP_H) {
            if (frontsSource(x)) return x;
        }
        return null;
    }

    async function updateFronts(h, seq) {
        var src = frontsSource(h);
        if (!src) {
            Pgen.setData(null);
            var next = nextFrontsHour(h);
            setChip('chipFronts', 'none', 'No fronts this step',
                next === null ? 'No fronts chart for this valid time' :
                    'No fronts chart for this valid time. Next: ' + fmtHour(next));
            return;
        }
        if (!state.playing) setChip('chipFronts', 'loading', 'Fronts · loading');
        progress(1);
        var result = await loadFronts(src);
        progress(-1);
        if (seq !== applySeq) return;
        if (result.fc) {
            Pgen.setData(result.fc);
            setChip('chipFronts', 'ok', 'Fronts · ' + src.label);
        } else if (result.empty) {
            Pgen.setData(null);
            setChip('chipFronts', 'warn', 'Fronts · not issued', 'No fronts files found for ' + src.label);
        } else {
            Pgen.setData(null);
            setChip('chipFronts', 'error', 'Fronts · unavailable', 'Could not load fronts (' + result.error.message + ')');
            toast('Fronts could not be loaded. They will be retried on the next step.', { kind: 'warn', key: 'fronts-error', throttle: 60000 });
        }
    }

    // --- NDFD grid ------------------------------------------------------------
    function baseId() {
        return state.product === 'none' ? null : state.product;
    }

    // Layer whose time list drives the timeline's grid row (null: no grid shown)
    function availId() {
        return baseId() || (state.overlays.barbs ? Ndfd.BARBS_ID : null);
    }

    function gridStatus(id, h) {
        return id ? Ndfd.resolveGridTime(id, validMs(h)).status : 'none';
    }

    // Show one NDFD layer for the current step -> { grid, result } | { off } | { stale }
    async function showNdfd(layer, id, ms, seq) {
        if (!id) {
            layer.hide();
            return { off: true };
        }
        await Ndfd.loadTimes(id);
        if (seq !== applySeq) return { stale: true };
        var grid = Ndfd.resolveGridTime(id, ms);
        if (grid.status === 'none') {
            layer.hide();
            return { grid: grid };
        }
        var result = await layer.show(Ndfd.tileUrl(id, grid));
        return result === 'stale' ? { stale: true } : { grid: grid, result: result };
    }

    // -> { state, text, title } for one layer's outcome
    function describe(r, id, label, ms) {
        if (r.grid.status === 'none') {
            var range = Ndfd.range(id);
            var why = !range ? '' : ms < range.first ? 'NDFD keeps no past grids.' : 'NDFD runs to ' + fmtShort(range.last) + '.';
            return { state: 'none', text: 'No ' + label.toLowerCase(), title: 'No NDFD ' + label.toLowerCase() + ' grid for this valid time. ' + why };
        }
        if (r.grid.status === 'unknown') {
            return { state: 'warn', text: label + ' · unverified', title: 'Grid availability could not be checked; the server may have no grid for this time.' };
        }
        if (r.result === 'timeout') {
            return { state: 'warn', text: label + ' · slow', title: 'The NDFD server is responding slowly; some tiles may be missing.' };
        }
        if (r.grid.status === 'nearest') {
            return { state: 'ok', text: label + ' · ' + fmtShort(r.grid.ms), title: label + ': nearest NDFD grid, valid ' + fmtValid(r.grid.ms) };
        }
        return { state: 'ok', text: label, title: label + ' valid ' + fmtValid(r.grid.ms) };
    }

    // Show the preloaded frame for a slot -> 'shown' | 'pending' | 'none'
    function showFrame(slot, id, grid) {
        if (!id || grid.status === 'none') {
            Frames.hide(slot);
            return 'none';
        }
        if ((grid.status === 'exact' || grid.status === 'nearest') && Frames.show(slot, id, grid.ms)) return 'shown';
        return 'pending';
    }

    function setGridChip(base, barbs, b, w, ms) {
        var p = Ndfd.product(state.product);
        state.grid = (b.grid && b.grid.status !== 'none' ? b.grid : null) ||
            (w.grid && w.grid.status !== 'none' ? w.grid : null);
        if (!base) {
            var only = describe(w, barbs, 'Barbs', ms);
            setChip('chipGrid', only.state, only.text, only.title);
            return;
        }
        // Full product name only when it's the whole message
        var plain = !barbs && b.grid && b.grid.status === 'exact' && b.result !== 'timeout';
        var d = describe(b, base, plain ? p.name : p.short, ms);
        if (!barbs) {
            setChip('chipGrid', d.state, d.text, d.title);
            return;
        }
        var wd = describe(w, barbs, 'Barbs', ms);
        var text = d.state === 'none' && wd.state === 'none' ? 'No grid' :
            d.text + (wd.state === 'none' ? ' · no barbs' : ' + barbs');
        var chipState = d.state === 'none' && wd.state !== 'none' ? wd.state :
            d.state === 'ok' && wd.state === 'warn' ? 'warn' : d.state;
        setChip('chipGrid', chipState, text, d.title + ' ' + wd.title);
    }

    async function updateGrid(seq) {
        var p = Ndfd.product(state.product);
        var base = baseId();
        var barbs = state.overlays.barbs ? Ndfd.BARBS_ID : null;
        var ms = validMs(state.hour);

        if (!base && !barbs) {
            gridLayer.hide();
            barbLayer.hide();
            Frames.hide('base');
            Frames.hide('barbs');
            state.grid = null;
            setChip('chipGrid', 'none', 'Base grid off', 'No base grid selected');
            return;
        }

        var loadingLabel = base ? p.short : 'Barbs';
        // During playback the progress bar suffices; don't flash the chip each frame
        if (!state.playing) setChip('chipGrid', 'loading', loadingLabel + ' · loading');
        progress(1);
        try {
            await Promise.all([base && Ndfd.loadTimes(base), barbs && Ndfd.loadTimes(barbs)]);
            if (seq !== applySeq) return;
            var gb = base ? Ndfd.resolveGridTime(base, ms) : null;
            var gw = barbs ? Ndfd.resolveGridTime(barbs, ms) : null;

            // Preloaded frames appear instantly; tiles (when not playing)
            // then load underneath and replace them at full detail.
            var fb = showFrame('base', base, gb);
            var fw = showFrame('barbs', barbs, gw);
            // Don't leave the previous step's tiles stacked under the frame
            if (fb === 'shown' && !gridLayer.isShowing(Ndfd.tileUrl(base, gb))) gridLayer.hide();
            if (fw === 'shown' && !barbLayer.isShowing(Ndfd.tileUrl(barbs, gw))) barbLayer.hide();
            if (state.playing) {
                if (fb === 'pending' && await Frames.whenReady(base, gb.ms, 20000)) fb = showFrame('base', base, gb);
                if (fw === 'pending' && await Frames.whenReady(barbs, gw.ms, 20000)) fw = showFrame('barbs', barbs, gw);
                if (seq !== applySeq) return;
                if (fb !== 'pending' && fw !== 'pending') {
                    gridLayer.hide();
                    barbLayer.hide();
                    setGridChip(base, barbs,
                        base ? { grid: gb, result: 'loaded' } : { off: true },
                        barbs ? { grid: gw, result: 'loaded' } : { off: true }, ms);
                    return;
                }
            }

            var results = await Promise.all([
                showNdfd(gridLayer, base, ms, seq),
                showNdfd(barbLayer, barbs, ms, seq)
            ]);
            if (seq !== applySeq || results[0].stale || results[1].stale) return;
            var b = results[0];
            var w = results[1];
            // Tiles are up: retire the frame unless the tiles timed out
            if (b.result !== 'timeout' || fb !== 'shown') Frames.hide('base');
            if (w.result !== 'timeout' || fw !== 'shown') Frames.hide('barbs');
            setGridChip(base, barbs, b, w, ms);
        } finally {
            progress(-1);
        }
    }

    // --- Preloading -----------------------------------------------------------
    var preloadTimer = null;

    function schedulePreload(delay) {
        clearTimeout(preloadTimer);
        preloadTimer = setTimeout(runPreload, delay === undefined ? 700 : delay);
    }

    // Queue whole-view frames for every step that has a grid (playback order
    // from the current step) and warm the fronts cache.
    function runPreload() {
        if (!gridLayer) return;
        if (map.isMoving()) return schedulePreload();
        var ids = [baseId(), state.overlays.barbs ? Ndfd.BARBS_ID : null].filter(Boolean);
        var reqs = [];
        var span = MAX_H - MIN_H + STEP_H;
        for (var i = 0; i < span / STEP_H; i++) {
            var h = state.hour + i * STEP_H;
            if (h > MAX_H) h -= span;
            ids.forEach(function (id) {
                var g = Ndfd.resolveGridTime(id, validMs(h));
                if (g.status === 'exact' || g.status === 'nearest') reqs.push({ id: id, ms: g.ms });
            });
            var src = frontsSource(h);
            if (src) loadFronts(src);
        }
        Frames.prepare(reqs);
    }

    var cachedRaf = 0;

    function onFramesChange() {
        if (cachedRaf) return;
        cachedRaf = requestAnimationFrame(function () {
            cachedRaf = 0;
            renderCached();
        });
    }

    // Timeline marks for steps whose frames are preloaded, plus a counter
    function renderCached() {
        var el = $('tlCached');
        el.innerHTML = '';
        var ids = [baseId(), state.overlays.barbs ? Ndfd.BARBS_ID : null].filter(Boolean);
        var sets = ids.map(function (id) { return { id: id, ready: Frames.readyMs(id) }; });
        for (var h = MIN_H; ids.length && h <= MAX_H; h += STEP_H) {
            var all = sets.every(function (x) {
                var g = Ndfd.resolveGridTime(x.id, validMs(h));
                return (g.status === 'exact' || g.status === 'nearest') && x.ready.has(g.ms);
            });
            if (!all) continue;
            var seg = document.createElement('div');
            seg.className = 'cached';
            var left = Math.max(0, pct(h - STEP_H / 2));
            seg.style.left = left + '%';
            seg.style.width = (Math.min(100, pct(h + STEP_H / 2)) - left) + '%';
            el.appendChild(seg);
        }
        var pr = Frames.progress();
        var status = $('preloadStatus');
        if (!pr.total) status.textContent = '';
        else if (pr.ready < pr.total && pr.loading) status.textContent = 'Preloading ' + pr.ready + '/' + pr.total;
        else if (pr.ready < pr.total) status.textContent = 'Preloaded ' + pr.ready + '/' + pr.total;
        else status.textContent = 'Loop ready';
        status.dataset.state = pr.ready >= pr.total ? 'ready' : 'loading';
    }

    // --- Time --------------------------------------------------------------
    function applyTime() {
        if (!gridLayer) return Promise.resolve(); // map not ready; onMapLoad applies
        var seq = ++applySeq;
        return Promise.all([updateGrid(seq), updateFronts(state.hour, seq)]);
    }

    function renderTimeLabels() {
        var h = state.hour;
        var ms = validMs(h);
        $('validTime').textContent = fmtValid(ms);
        $('validRel').textContent = (h === 0 ? 'Analysis' : fmtHour(h)) + ' · ' + fmtCycle(state.baseTime) + ' cycle';
        $('validTime').title = 'Local: ' + new Date(ms).toLocaleString();
        $('tlHour').textContent = h === 0 ? '0 h' : fmtHour(h);
        $('tlCycle').textContent = fmtShort(ms);
        var slider = $('timeSlider');
        slider.value = h;
        slider.setAttribute('aria-valuetext', fmtValid(ms) + ', ' + fmtHour(h));
    }

    // immediate: apply now (buttons, playback); otherwise debounce (dragging)
    function setHour(h, immediate) {
        h = Math.max(MIN_H, Math.min(MAX_H, h));
        state.hour = h;
        renderTimeLabels();
        clearTimeout(applyTimer);
        if (immediate) return applyTime();
        applyTimer = setTimeout(applyTime, 160);
        return Promise.resolve();
    }

    function step(delta) {
        stopPlay();
        setHour(state.hour + delta * STEP_H, true);
    }

    function hasAnything(h) {
        return gridStatus(availId(), h) !== 'none' || !!frontsSource(h);
    }

    function nextPlayable(h) {
        for (var i = 1; i <= (MAX_H - MIN_H) / STEP_H + 1; i++) {
            var x = h + i * STEP_H;
            if (x > MAX_H) x = MIN_H + (x - MAX_H - STEP_H);
            if (hasAnything(x)) return x;
        }
        return null;
    }

    async function play() {
        if (state.playing) return;
        state.playing = true;
        renderPlayButton();
        runPreload();
        while (state.playing) {
            var t0 = performance.now();
            var next = nextPlayable(state.hour);
            if (next === null) break;
            await setHour(next, true);
            if (!state.playing) break;
            var after = nextPlayable(next);
            var isLast = after !== null && after < next;
            var wait = FRAME_MS / state.speed + (isLast && state.holdEnd ? END_HOLD_MS : 0) - (performance.now() - t0);
            if (wait > 0) await sleep(wait);
        }
        stopPlay();
    }

    function stopPlay() {
        if (!state.playing) return;
        state.playing = false;
        renderPlayButton();
        applyTime(); // bring back full-detail tiles for the paused step
    }

    function setSpeed(speed) {
        state.speed = speed;
        savePrefs();
        $('btnSpeed').textContent = (speed === 0.5 ? '½' : speed) + '×';
        $('btnSpeed').setAttribute('aria-label', 'Loop speed ' + speed + 'x');
        document.querySelectorAll('[data-speed]').forEach(function (b) {
            b.setAttribute('aria-checked', String(parseFloat(b.dataset.speed) === speed));
        });
    }

    function setSpeedMenuOpen(open) {
        $('speedMenu').hidden = !open;
        $('btnSpeed').setAttribute('aria-expanded', String(open));
    }

    function renderPlayButton() {
        var btn = $('btnPlay');
        btn.innerHTML = icon(state.playing ? 'pause' : 'play');
        btn.setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
        btn.setAttribute('aria-pressed', String(state.playing));
    }

    // Re-anchor on a newer 6-hourly cycle, keeping the same valid time
    function reanchor() {
        var keep = validMs(state.hour);
        state.baseTime = getBaseTime();
        frontsCache.clear();
        renderTimeline();
        schedulePreload(0);
        setHour(Math.round((keep - state.baseTime) / (STEP_H * HOUR_MS)) * STEP_H, true);
    }

    // --- Timeline ------------------------------------------------------------
    function pct(h) {
        return ((h - MIN_H) / (MAX_H - MIN_H)) * 100;
    }

    function renderTimeline() {
        var ticks = $('tlTicks');
        ticks.innerHTML = '';
        for (var h = MIN_H; h <= MAX_H; h += STEP_H) {
            var d = new Date(validMs(h));
            var tick = document.createElement('div');
            tick.className = 'tick';
            tick.style.left = pct(h) + '%';
            if (d.getUTCHours() === 0) {
                tick.classList.add('tick-day');
                tick.innerHTML = '<span>' + DAYS[d.getUTCDay()] + '<em> ' + pad(d.getUTCDate(), 2) + '</em></span>';
            } else if (d.getUTCHours() === 12) {
                tick.classList.add('tick-mid');
                tick.innerHTML = '<span>12Z</span>';
            }
            ticks.appendChild(tick);
        }
        renderAvailability();
        renderNow();
    }

    function renderAvailability() {
        var avail = $('tlAvail');
        avail.innerHTML = '';
        for (var h = MIN_H; h <= MAX_H; h += STEP_H) {
            var g = gridStatus(availId(), h);
            var seg = document.createElement('div');
            seg.className = 'seg seg-' + ({ exact: 'on', nearest: 'near', none: 'off', unknown: 'unk' }[g]);
            var left = Math.max(0, pct(h - STEP_H / 2));
            var right = Math.min(100, pct(h + STEP_H / 2));
            seg.style.left = left + '%';
            seg.style.width = (right - left) + '%';
            avail.appendChild(seg);
            if (frontsSource(h)) {
                var dot = document.createElement('div');
                dot.className = 'fronts-dot';
                dot.style.left = pct(h) + '%';
                avail.appendChild(dot);
            }
        }
        if (gridLayer) renderCached();
    }

    function renderNow() {
        var h = (Date.now() - state.baseTime) / HOUR_MS;
        var el = $('tlNow');
        el.hidden = h < MIN_H || h > MAX_H;
        el.style.left = pct(h) + '%';
    }

    // --- Legend --------------------------------------------------------------
    var BARB_KEY =
        '<svg viewBox="0 0 220 34" class="barb-key" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">' +
        '<g transform="translate(10 26)"><circle r="2" fill="currentColor"/><path d="M0 0 32 0M32 0l4 -6"/></g>' +
        '<g transform="translate(80 26)"><circle r="2" fill="currentColor"/><path d="M0 0 32 0M32 0l6 -12"/></g>' +
        '<g transform="translate(150 26)"><circle r="2" fill="currentColor"/><path d="M0 0 32 0"/><path d="M32 0 28 -12 24 0Z" fill="currentColor"/></g>' +
        '</svg><div class="barb-labels"><span>5 kt</span><span>10 kt</span><span>50 kt</span></div>';

    function legendHead(name, unit) {
        return '<div class="legend-head"><span>' + escapeHtml(name) + '</span><span class="unit">' + unit + '</span></div>';
    }

    async function renderLegend() {
        var p = Ndfd.product(state.product);
        var el = $('legend');
        var barbs = state.overlays.barbs ? '<div class="legend-barbs">' + legendHead('Wind barbs', 'kt') + BARB_KEY + '</div>' : '';
        if (!baseId()) {
            el.hidden = !barbs;
            el.innerHTML = barbs;
            return;
        }
        el.hidden = false;
        var head = legendHead(p.name, p.unit);
        el.innerHTML = head + '<div class="legend-bar legend-loading"></div>' + barbs;
        var stops = await Ndfd.legend(p.id);
        if (state.product !== p.id) return;
        // Re-read barbs state: it may have been toggled while the legend loaded
        barbs = state.overlays.barbs ? '<div class="legend-barbs">' + legendHead('Wind barbs', 'kt') + BARB_KEY + '</div>' : '';
        if (!stops) {
            el.innerHTML = head + '<div class="legend-empty">Legend unavailable</div>' + barbs;
            return;
        }
        var n = stops.length;
        var gradient = stops.map(function (s, i) {
            return s[1] + ' ' + ((i / (n - 1)) * 100).toFixed(2) + '%';
        }).join(', ');
        var every = n > 12 ? 2 : 1;
        var labels = stops.map(function (s, i) {
            if (i % every && i !== n - 1) return '';
            return '<span style="left:' + ((i / (n - 1)) * 100).toFixed(2) + '%">' + s[0] + '</span>';
        }).join('');
        el.innerHTML = head + '<div class="legend-bar" style="background:linear-gradient(90deg,' + gradient + ')"></div>' +
            '<div class="legend-labels">' + labels + '</div>' + barbs;
    }

    // --- Layer panel ------------------------------------------------------------
    function renderProducts() {
        var list = $('productList');
        list.innerHTML = '';
        Ndfd.PRODUCTS.forEach(function (p, i) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'product';
            btn.setAttribute('role', 'radio');
            btn.dataset.product = p.id;
            btn.innerHTML = icon(p.icon) + '<span class="product-name">' + escapeHtml(p.name) + '</span>' +
                '<span class="product-unit">' + p.unit + '</span><kbd>' + (i + 1) + '</kbd>';
            btn.addEventListener('click', function () { setProduct(p.id); });
            list.appendChild(btn);
        });
        markProduct();
    }

    function markProduct() {
        document.querySelectorAll('.product').forEach(function (b) {
            var on = b.dataset.product === state.product;
            b.setAttribute('aria-checked', String(on));
            b.tabIndex = on ? 0 : -1;
        });
    }

    function setProduct(id) {
        if (id === state.product) return;
        state.product = id;
        savePrefs();
        markProduct();
        renderLegend();
        renderAvailability();
        if (baseId()) {
            Ndfd.loadTimes(id).then(function () {
                if (state.product === id) {
                    renderAvailability();
                    schedulePreload(300);
                }
            });
        }
        applyTime();
        schedulePreload(300);
    }

    function setBarbColor(color) {
        state.barbColor = color;
        savePrefs();
        document.querySelectorAll('[data-barb-color]').forEach(function (b) {
            b.setAttribute('aria-checked', String(b.dataset.barbColor === color));
        });
        // Brightness floor of 1 maps NOAA's black barbs to white
        if (barbLayer) barbLayer.setPaint('raster-brightness-min', color === 'white' ? 1 : 0);
        if (barbLayer) Frames.setPaint('barbs', 'raster-brightness-min', color === 'white' ? 1 : 0);
    }

    // quiet: don't re-apply the time step (used while initializing)
    function setOverlay(name, on, quiet) {
        state.overlays[name] = on;
        savePrefs();
        var input = document.querySelector('[data-overlay="' + name + '"]');
        if (input) input.checked = on;
        if (name === 'barbs') {
            document.body.classList.toggle('barbs-on', on);
            renderLegend();
            renderAvailability();
        }
        if (!gridLayer) return; // applied in onMapLoad
        if (name === 'warnings') {
            map.setLayoutProperty('warnings', 'visibility', on ? 'visible' : 'none');
        } else if (name === 'barbs') {
            if (on) Ndfd.loadTimes(Ndfd.BARBS_ID).then(function () { renderAvailability(); schedulePreload(300); });
            if (!quiet) {
                applyTime();
                schedulePreload(300);
            }
        } else {
            Pgen.setGroupVisible(name, on);
        }
    }

    function setPanelOpen(open) {
        document.body.classList.toggle('panel-open', open);
        $('btnLayers').setAttribute('aria-expanded', String(open));
        $('scrim').hidden = !(open && isMobile());
    }

    // Re-read the server's time list (at most once a minute) and re-apply
    // the current step if its grid availability changed.
    var lastRefresh = 0;

    function refreshAvailability() {
        if (Date.now() - lastRefresh < 60000) return;
        lastRefresh = Date.now();
        var id = availId();
        if (!id) return;
        var before = Ndfd.resolveGridTime(id, validMs(state.hour));
        Ndfd.loadTimes(id, true).then(function () {
            renderAvailability();
            var after = Ndfd.resolveGridTime(id, validMs(state.hour));
            if (after.status !== before.status || after.ms !== before.ms) applyTime();
            schedulePreload();
        });
    }

    // --- Click readout ------------------------------------------------------------
    function hazardRows(json) {
        var feats = (json && json.features) || [];
        var seen = {};
        var rows = [];
        feats.forEach(function (f) {
            var a = f.attributes || {};
            var key = a.prod_type + '|' + a.expiration;
            if (!a.prod_type || seen[key]) return;
            seen[key] = true;
            var kind = /warning/i.test(a.prod_type) ? 'warning' : /watch/i.test(a.prod_type) ? 'watch' : 'advisory';
            var until = a.expiration ? Date.parse(a.expiration) : NaN;
            rows.push('<li class="hz hz-' + kind + '"><span>' + escapeHtml(a.prod_type) + '</span>' +
                (isNaN(until) ? '' : '<time>until ' + fmtShort(until) + '</time>') + '</li>');
        });
        return rows;
    }

    function queryHazards(lng, lat) {
        var url = HAZARDS_QUERY + '?geometry=' + lng.toFixed(4) + ',' + lat.toFixed(4) +
            '&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects' +
            '&outFields=prod_type,expiration&returnGeometry=false&f=json';
        return Ndfd.fetchWithTimeout(url, 15000).then(function (r) { return r.json(); });
    }

    function valueRow(label, value) {
        return '<div class="ro-row"><span>' + label + '</span><strong>' + value + '</strong></div>';
    }

    function openReadout(lngLat) {
        var ll = lngLat.wrap();
        // Grid times are shared by all NDFD layers; waveh stands in when no grid is shown
        var grid = state.grid || Ndfd.resolveGridTime('waveh', validMs(state.hour));
        if (popup) popup.remove();
        popup = new maplibregl.Popup({ className: 'readout', maxWidth: '300px', focusAfterOpen: false })
            .setLngLat(lngLat)
            .setHTML(
                '<div class="ro-head"><strong>' + fmtDegMin(ll.lat, ll.lng) + '</strong>' +
                '<span>' + (grid.status === 'nearest' ? 'Grid valid ' : 'Valid ') + fmtValid(grid.ms) + '</span></div>' +
                '<div class="ro-values"><div class="ro-skel"></div><div class="ro-skel"></div><div class="ro-skel"></div></div>' +
                '<div class="ro-sub">Active hazards (current)</div><ul class="ro-hazards"><li class="ro-skel"></li></ul>')
            .addTo(map);
        var current = popup;
        var root = current.getElement();

        var valuesEl = root.querySelector('.ro-values');
        if (grid.status === 'none') {
            valuesEl.innerHTML = '<div class="ro-note">No NDFD grid for this valid time.</div>';
        } else {
            Ndfd.pointValues(ll.lng, ll.lat, grid.ms).then(function (v) {
                if (popup !== current) return;
                if (v.waveh === undefined && v.wspd === undefined && v.wgust === undefined) {
                    valuesEl.innerHTML = '<div class="ro-note">No forecast data here (land or outside NDFD coverage).</div>';
                    return;
                }
                valuesEl.innerHTML =
                    valueRow('Wave height', v.waveh === undefined ? '—' : v.waveh.toFixed(1) + ' ft <small>' + (v.waveh * 0.3048).toFixed(1) + ' m</small>') +
                    valueRow('Wind speed', v.wspd === undefined ? '—' : Math.round(v.wspd) + ' kt') +
                    valueRow('Wind gust', v.wgust === undefined ? '—' : Math.round(v.wgust) + ' kt');
            }).catch(function (err) {
                if (popup !== current) return;
                valuesEl.innerHTML = err.code === 'nogrid' ?
                    '<div class="ro-note">This grid is no longer on the NDFD server.</div>' :
                    '<div class="ro-note ro-error">Point values unavailable (NDFD server did not respond).</div>';
                if (err.code === 'nogrid') refreshAvailability();
            });
        }

        var hzEl = root.querySelector('.ro-hazards');
        queryHazards(ll.lng, ll.lat).then(function (json) {
            if (popup !== current) return;
            var rows = hazardRows(json);
            hzEl.innerHTML = rows.length ? rows.join('') : '<li class="ro-note">None in effect</li>';
        }).catch(function () {
            if (popup === current) hzEl.innerHTML = '<li class="ro-note ro-error">Hazard lookup unavailable</li>';
        });
    }

    // --- Map ---------------------------------------------------------------
    function createMap() {
        map = new maplibregl.Map({
            container: 'map',
            center: HOME_VIEW.center,
            zoom: HOME_VIEW.zoom,
            maxZoom: 12,
            attributionControl: false,
            style: {
                version: 8,
                projection: { type: 'globe' },
                // Atmosphere glow around the globe, faded out before it hazes zoomed-in views
                sky: { 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 2.5, 1, 4, 0] },
                sources: {
                    ocean: { type: 'raster', tiles: [ESRI_OCEAN], tileSize: 256, maxzoom: 13, attribution: 'Basemap &copy; Esri' },
                    warnings: {
                        type: 'raster', tileSize: Ndfd.TILE_SIZE, attribution: 'Hazards &copy; NOAA/NWS',
                        tiles: [Ndfd.wmsGetMapUrl(WARNINGS_WMS, { LAYERS: '1' })]
                    }
                },
                layers: [
                    { id: 'ocean', type: 'raster', source: 'ocean', paint: { 'raster-saturation': -0.15, 'raster-brightness-max': 0.95 } },
                    { id: 'warnings', type: 'raster', source: 'warnings', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.75 } }
                ]
            }
        });

        window.Oceanic.map = map; // for console diagnostics
        map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
        // NDFD credit is always shown: preloaded frames are image sources, which carry no attribution
        map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: 'NDFD &copy; NOAA/NWS' }), 'bottom-left');
        map.addControl(new maplibregl.ScaleControl({ unit: 'nautical' }), 'bottom-left');
    }

    function onMapLoad() {
        gridLayer = new Ndfd.GridLayer(map, 'warnings', state.opacity, 'ndfd');
        // Barbs sit above the grid and warnings, below the fronts
        barbLayer = new Ndfd.GridLayer(map, undefined, 0.95, 'barbs');
        Pgen.init(map, state.scale);
        // Frame layers sit just above their tiled counterparts
        Frames.init(map, {
            base: { beforeId: 'warnings', opacity: state.opacity },
            barbs: { beforeId: 'isobars', opacity: 0.95 }
        }, onFramesChange);
        setBarbColor(state.barbColor);
        map.on('moveend', function () { schedulePreload(); });
        Object.keys(state.overlays).forEach(function (k) { setOverlay(k, state.overlays[k], true); });

        map.on('click', function (e) { setSpeedMenuOpen(false); openReadout(e.lngLat); });

        var coordsEl = $('coords');
        var pending = null;
        map.on('mousemove', function (e) {
            pending = e.lngLat;
            requestAnimationFrame(function () {
                if (!pending) return;
                var ll = pending.wrap();
                coordsEl.textContent = fmtLatLon(ll.lat, ll.lng, 2);
                pending = null;
            });
        });
        map.getCanvas().addEventListener('mouseleave', function () { coordsEl.textContent = ''; });

        var gridErrors = 0;
        map.on('error', function (e) {
            var sid = e.sourceId || (e.source && e.source.id);
            if (gridLayer.isGridSource(sid) || barbLayer.isGridSource(sid)) {
                gridErrors++;
                // Usually the requested time just rolled off the server
                refreshAvailability();
                if (gridErrors >= 6) {
                    toast('Some NDFD tiles failed to load. The server may be busy.', { kind: 'warn', key: 'grid-tiles', throttle: 60000 });
                }
            } else if (sid === 'ocean') {
                toast('Basemap tiles failed to load.', { kind: 'warn', key: 'basemap', throttle: 120000 });
            } else if (sid === 'warnings') {
                toast('Watches & warnings overlay failed to load.', { kind: 'warn', key: 'warnings', throttle: 120000 });
            }
        });
        map.on('dataloading', function () { gridErrors = 0; });

        // Start with attribution collapsed on small screens (it sits beside the legend)
        if (isMobile()) {
            var attrib = document.querySelector('.maplibregl-ctrl-attrib');
            if (attrib) attrib.classList.remove('maplibregl-compact-show');
        }

        applyTime();
        // Let the visible tiles go first, then preload frames in the background
        schedulePreload(1500);
    }

    // --- Wiring -----------------------------------------------------------
    function bindUi() {
        $('btnLayers').innerHTML = icon('layers');
        $('btnHelp').innerHTML = icon('help');
        $('btnPanelClose').innerHTML = icon('close');
        $('btnHelpClose').innerHTML = icon('close');
        $('btnPrev').innerHTML = icon('prev');
        $('btnNext').innerHTML = icon('next');
        renderPlayButton();

        $('btnLayers').addEventListener('click', function () {
            setPanelOpen(!document.body.classList.contains('panel-open'));
        });
        $('btnPanelClose').addEventListener('click', function () { setPanelOpen(false); });
        $('scrim').addEventListener('click', function () { setPanelOpen(false); });

        var dialog = $('helpDialog');
        $('btnHelp').addEventListener('click', function () { dialog.showModal(); });
        $('btnHelpClose').addEventListener('click', function () { dialog.close(); });
        dialog.addEventListener('click', function (e) { if (e.target === dialog) dialog.close(); });

        $('btnPrev').addEventListener('click', function () { step(-1); });
        $('btnNext').addEventListener('click', function () { step(1); });
        $('btnPlay').addEventListener('click', function () { state.playing ? stopPlay() : play(); });

        setSpeed(state.speed);
        $('btnSpeed').addEventListener('click', function (e) {
            e.stopPropagation();
            setSpeedMenuOpen($('speedMenu').hidden);
        });
        document.querySelectorAll('[data-speed]').forEach(function (b) {
            b.addEventListener('click', function () {
                setSpeed(parseFloat(b.dataset.speed));
                setSpeedMenuOpen(false);
            });
        });
        $('holdEnd').checked = state.holdEnd;
        $('holdEnd').addEventListener('change', function () {
            state.holdEnd = this.checked;
            savePrefs();
        });
        $('speedMenu').addEventListener('click', function (e) { e.stopPropagation(); });
        document.addEventListener('click', function () { setSpeedMenuOpen(false); });

        $('timeSlider').addEventListener('input', function () {
            stopPlay();
            setHour(parseInt(this.value, 10), false);
        });

        $('opacity').value = state.opacity;
        $('opacityOut').textContent = Math.round(state.opacity * 100) + '%';
        $('opacity').addEventListener('input', function () {
            state.opacity = parseFloat(this.value);
            $('opacityOut').textContent = Math.round(state.opacity * 100) + '%';
            if (gridLayer) {
                gridLayer.setOpacity(state.opacity);
                Frames.setPaint('base', 'raster-opacity', state.opacity);
            }
            savePrefs();
        });

        $('sizeSlider').value = state.scale;
        $('sizeOut').textContent = state.scale.toFixed(2).replace(/0$/, '') + '×';
        $('sizeSlider').addEventListener('input', function () {
            state.scale = parseFloat(this.value);
            $('sizeOut').textContent = state.scale.toFixed(2).replace(/0$/, '') + '×';
            if (map && map.getSource('pgen')) Pgen.setScale(state.scale);
            savePrefs();
        });

        document.querySelectorAll('[data-barb-color]').forEach(function (btn) {
            btn.addEventListener('click', function () { setBarbColor(btn.dataset.barbColor); });
        });
        setBarbColor(state.barbColor);
        document.body.classList.toggle('barbs-on', state.overlays.barbs);

        document.querySelectorAll('[data-overlay]').forEach(function (input) {
            input.checked = state.overlays[input.dataset.overlay];
            input.addEventListener('change', function () {
                setOverlay(input.dataset.overlay, input.checked);
            });
        });

        // Arrow keys move between products like a radio group
        $('productList').addEventListener('keydown', function (e) {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            e.preventDefault();
            var ids = Ndfd.PRODUCTS.map(function (p) { return p.id; });
            var i = ids.indexOf(state.product) + (e.key === 'ArrowDown' ? 1 : -1);
            setProduct(ids[(i + ids.length) % ids.length]);
            document.querySelector('.product[data-product="' + state.product + '"]').focus();
        });

        document.addEventListener('keydown', onKey);

        if (CONFIG.homeLink) {
            var a = $('homeLink');
            a.href = CONFIG.homeLink.href;
            a.textContent = CONFIG.homeLink.label;
            a.hidden = false;
        }
        if (DEMO_FRONTS_DIR) $('chipDemo').hidden = false;
    }

    function onKey(e) {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        var t = e.target;
        var tag = t && t.tagName;
        if (tag === 'SELECT' || tag === 'TEXTAREA' || (tag === 'INPUT' && t.type !== 'checkbox')) return;
        if ($('helpDialog').open && e.key !== '?') return;

        var key = e.key;
        var handled = true;
        if (key === 'ArrowLeft') step(-1);
        else if (key === 'ArrowRight') step(1);
        else if (key === ' ' && tag !== 'BUTTON') { state.playing ? stopPlay() : play(); }
        else if (key === 'Home') { stopPlay(); setHour(MIN_H, true); }
        else if (key === 'End') { stopPlay(); setHour(MAX_H, true); }
        else if (key >= '1' && key <= String(Ndfd.PRODUCTS.length)) setProduct(Ndfd.PRODUCTS[parseInt(key, 10) - 1].id);
        else if (key === 'f' || key === 'F') setOverlay('fronts', !state.overlays.fronts);
        else if (key === 'i' || key === 'I') setOverlay('isobars', !state.overlays.isobars);
        else if (key === 'c' || key === 'C') setOverlay('centers', !state.overlays.centers);
        else if (key === 'w' || key === 'W') setOverlay('warnings', !state.overlays.warnings);
        else if (key === 'b' || key === 'B') setOverlay('barbs', !state.overlays.barbs);
        else if (key === '[' || key === ']') {
            var i = SPEEDS.indexOf(state.speed) + (key === ']' ? 1 : -1);
            setSpeed(SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i))]);
        }
        else if (key === 'l' || key === 'L') setPanelOpen(!document.body.classList.contains('panel-open'));
        else if (key === 'r' || key === 'R') map.easeTo(Object.assign({ duration: 800 }, HOME_VIEW));
        else if (key === '?') { var d = $('helpDialog'); d.open ? d.close() : d.showModal(); }
        else if (key === 'Escape') {
            if (!$('speedMenu').hidden) setSpeedMenuOpen(false);
            else if (popup) { popup.remove(); popup = null; } else if (isMobile()) setPanelOpen(false);
        } else handled = false;
        if (handled) e.preventDefault();
    }

    // Refresh availability and detect a newer cycle while the page stays open
    function startHousekeeping() {
        setInterval(function () {
            renderNow();
            if (availId()) Ndfd.loadTimes(availId()).then(renderAvailability);
            var latest = getBaseTime();
            if (latest > state.baseTime) {
                toast('A newer forecast cycle (' + fmtCycle(latest) + ') is available.', {
                    key: 'new-cycle', timeout: 0,
                    action: { label: 'Update', run: reanchor }
                });
            }
        }, 5 * 60 * 1000);
    }

    function init() {
        loadPrefs();
        renderProducts();
        bindUi();
        renderTimeLabels();
        renderTimeline();
        renderLegend();
        setPanelOpen(!isMobile());

        // waveh times also serve the click readout when no grid is shown
        if (state.overlays.barbs) Ndfd.loadTimes(Ndfd.BARBS_ID).then(renderAvailability);
        Ndfd.loadTimes(baseId() || 'waveh').then(function (c) {
            renderAvailability();
            if (c.state === 'error') {
                toast('Could not check which NDFD grids are available. Grids will still be requested.', { kind: 'warn', key: 'caps' });
            }
        });

        try {
            createMap();
        } catch (err) {
            $('fatal').hidden = false;
            $('fatalMsg').textContent = 'This page needs a browser with WebGL enabled (' + err.message + ').';
            return;
        }
        map.on('load', onMapLoad);
        map.on('webglcontextlost', function () {
            toast('The graphics context was lost.', { kind: 'error', key: 'webgl', timeout: 0, action: { label: 'Reload', run: function () { location.reload(); } } });
        });
        startHousekeeping();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
