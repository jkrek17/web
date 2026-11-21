// ============================================================================
// PLAYBACK & LIVE - Storm reports over time, with archived radar and warnings
// ============================================================================
//
// Playback: load a time range, then play/scrub a clock across it. Reports up to
// the playhead are drawn (cumulative); those within the highlight window get a
// halo and full opacity. Radar (IEM N0Q composite) and storm-based warnings in
// effect follow the same clock.
//
// Live: the range ends at "now" and refreshes every minute; the playhead follows
// now (LIVE badge) until you scrub or play the last-hour loop.
//
// URL parameters (shared with index.html): start, end (YYYY-MM-DDTHHMM, UTC),
// region, types (comma list), mode=live, hours (live window), t (playhead).

import { maplibregl, createMap, routeFeatureClick, getSavedTheme } from './js/map/mapSetup.js';
import { applyBasemapTheme, LABEL_ANCHOR_LAYER } from './js/map/basemap.js';
import { getIconForReport } from './js/map/iconService.js';
import { createPopupContent } from './js/map/popupService.js';
import { ReportLayer } from './js/map/reportLayer.js';
import { AreaOverlay, AlertLayer } from './js/map/overlayLayers.js';
import { RadarPlayer } from './js/map/radarPlayer.js';
import {
    ReportTimeStates,
    AlertTimeStates,
    REPORT_ICON_OPACITY,
    RECENT_HALO_PAINT,
    ALERT_TIME_PAINT
} from './js/map/timeStates.js';
import {
    loadBoundaryGeoJson,
    getClipFeaturesForSelection,
    pointInClipFeatures,
    boundsOfFeatures
} from './js/map/boundaryOverlays.js';
import LSRService from './js/api/lsrService.js';
import { requestManager } from './js/api/requestManager.js';
import { normalizeLSRReports } from './js/lsr/normalizeLSR.js';
import { extractWindSpeed } from './js/utils/formatters.js';
import { showStatusToast, hideStatusToast } from './js/ui/toastService.js';
import { errorHandler } from './js/errors/errorHandler.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const LIVE_REFRESH_MS = CONFIG.LIVE_MODE_REFRESH_INTERVAL || 60000;
const LIVE_LOOP_MS = HOUR; // live-mode Play loops the last hour, like the old live radar
const MAX_RANGE_MS = 7 * 24 * HOUR;
const SBW_URL = 'https://mesonet.agron.iastate.edu/api/1/vtec/sbw_interval.geojson';

const $ = (id) => document.getElementById(id);

const state = {
    mode: 'playback',
    startMs: 0,
    endMs: 0,
    stepMin: 5,
    speed: 30, // minutes of weather per second of playback
    t: 0,
    playing: false,
    follow: true, // live: playhead tracks "now"
    trailMin: 60,
    liveHours: 6,
    region: '',
    typesKey: 'all',
    customTypes: null,
    showRadar: true,
    radarOpacity: 0.7,
    showWarnings: true
};

let map = null;
let reportLayer = null;
let warningsLayer = null;
let areaOverlay = null;
let radar = null;
let lsrService = null;

let rawReports = []; // normalized reports for the loaded range (all locations / types)
let rawWarnings = []; // storm-based warnings for the loaded range
let reports = []; // after location / type filters, sorted by time
let times = []; // reports[i].tms, sorted
let regionClip = null; // GeoJSON polygons for the selected location (null = bbox / all)
let regionBounds = null;
let bins = { size: HOUR, counts: [], rects: [] };

let loadToken = 0;
let liveTimer = null;
let urlTimer = null;

// ============================================================================
// TIME HELPERS (all UTC)
// ============================================================================

const pad = (n) => String(n).padStart(2, '0');
const floorTo = (ms, step) => Math.floor(ms / step) * step;
const stepMs = () => state.stepMin * MINUTE;

function utcDate(ms) {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function utcHHMM(ms) {
    const d = new Date(ms);
    return `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
}

/** URL form used by both pages: YYYY-MM-DDTHHMM */
function toParam(ms) {
    return `${utcDate(ms)}T${utcHHMM(ms)}`;
}

function fromParam(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):?(\d{2})$/.exec(value || '');
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : NaN;
}

/** datetime-local inputs hold UTC wall time */
function toInput(ms) {
    return new Date(ms).toISOString().slice(0, 16);
}

function fromInput(value) {
    const ms = Date.parse(`${value}:00Z`);
    return Number.isFinite(ms) ? ms : NaN;
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatUtc(ms, withDay = true) {
    const d = new Date(ms);
    const hm = `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}Z`;
    return withDay ? `${WEEKDAY[d.getUTCDay()]} ${MONTH[d.getUTCMonth()]} ${d.getUTCDate()} · ${hm}` : hm;
}

function formatLocal(ms) {
    return new Date(ms).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}

/** Number of reports with time <= ms */
function countUpTo(ms) {
    let lo = 0, hi = times.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (times[mid] <= ms) lo = mid + 1; else hi = mid;
    }
    return lo;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
}

// ============================================================================
// DATA
// ============================================================================

function activeTypes() {
    if (state.typesKey === 'custom' && state.customTypes) return new Set(state.customTypes);
    if (state.typesKey !== 'all' && WEATHER_CATEGORIES[state.typesKey]) return new Set(WEATHER_CATEGORIES[state.typesKey]);
    return null; // all
}

function regionBbox(region) {
    const def = CONFIG.STATES[region] || CONFIG.REGIONS[region];
    if (!def) return null;
    const [south, north, east, west] = def.bounds;
    return { south, north, east, west };
}

async function resolveRegion() {
    regionClip = null;
    regionBounds = null;
    if (!state.region) return;
    try {
        await loadBoundaryGeoJson();
        regionClip = getClipFeaturesForSelection(state.region, '');
    } catch (e) {
        regionClip = null; // fall back to the CONFIG bounding box
    }
    regionBounds = (regionClip && boundsOfFeatures(regionClip)) || regionBbox(state.region);
}

function inRegion(lat, lon) {
    if (!regionBounds) return true;
    const b = regionBounds;
    if (lat < b.south || lat > b.north || lon < b.west || lon > b.east) return false;
    return regionClip ? pointInClipFeatures(lat, lon, regionClip) : true;
}

/** Apply location and type filters to the loaded data and redraw */
function applyFilters() {
    const types = activeTypes();
    reports = rawReports
        .filter(r => (!types || types.has(r.filterType)) && inRegion(r.lat, r.lon))
        .sort((a, b) => a.tms - b.tms);
    times = reports.map(r => r.tms);
    if (reportLayer) reportLayer.setReports(reports);
    reportStates?.reset(times);

    if (warningsLayer) {
        const b = regionBounds;
        const visible = !b ? rawWarnings : rawWarnings.filter(w => {
            const wb = w.bounds;
            return wb && wb.west <= b.east && wb.east >= b.west && wb.south <= b.north && wb.north >= b.south;
        });
        warningsLayer.setAlerts(visible);
        alertStates?.reset(visible);
    }

    if (areaOverlay) {
        areaOverlay.clear();
        if (regionClip && regionClip.length) areaOverlay.addFeatures(regionClip);
        else if (regionBounds) areaOverlay.addRectangle(regionBounds.south, regionBounds.north, regionBounds.east, regionBounds.west);
    }

    buildTimeline();
    renderTime();
}

function prepareReports(geoJson) {
    const { normalized } = normalizeLSRReports(geoJson, REPORT_TYPE_MAP);
    const out = [];
    for (const r of normalized) {
        const tms = Date.parse(String(r.time).replace(' ', 'T'));
        if (!Number.isFinite(tms)) continue;
        r.tms = tms;
        r.icon = getIconForReport(r.iconRtype, r.iconMagnitude, r.remark, ICON_CONFIG, CONFIG.ICON_SIZE, extractWindSpeed, r.typetext);
        out.push(r);
    }
    return out;
}

function warningPopup(p) {
    const fmt = (v) => (v ? formatUtc(Date.parse(v)) : '');
    const color = p.nws_color || '#64748b';
    return `
        <div class="warning-popup">
            <div class="warning-header" style="border-left: 4px solid ${escapeHtml(color)};">
                <div class="warning-title"><strong>${escapeHtml(p.event_label || p.ph_sig || 'Warning')}</strong></div>
                <div class="warning-severity" style="color: ${escapeHtml(color)};">${escapeHtml(p.wfo || '')} · ${escapeHtml(p.status || '')}</div>
            </div>
            <div class="warning-body">
                ${p.locations ? `<div class="warning-area"><i class="fas fa-map-marker-alt"></i> ${escapeHtml(p.locations)}</div>` : ''}
                <div class="warning-time"><i class="fas fa-clock"></i> Issued ${escapeHtml(fmt(p.utc_issue))}</div>
                <div class="warning-time"><i class="fas fa-hourglass-end"></i> Expires ${escapeHtml(fmt(p.utc_expire))}</div>
                <div class="warning-time"><i class="fas fa-draw-polygon"></i> Polygon valid ${escapeHtml(fmt(p.utc_polygon_begin))} – ${escapeHtml(fmt(p.utc_polygon_end))}</div>
            </div>
        </div>`;
}

function prepareWarnings(geoJson) {
    const out = [];
    for (const f of geoJson?.features || []) {
        const p = f.properties || {};
        const b = Date.parse(p.utc_polygon_begin || p.utc_issue);
        const e = Date.parse(p.utc_polygon_end || p.utc_expire);
        if (!f.geometry || !Number.isFinite(b) || !Number.isFinite(e)) continue;
        out.push({
            geometry: f.geometry,
            color: p.nws_color || '#64748b',
            emoji: '',
            popupHtml: warningPopup(p),
            properties: { b, e },
            bounds: boundsOfFeatures([f])
        });
    }
    return out;
}

async function fetchWarnings(startMs, endMs) {
    const url = `${SBW_URL}?begints=${new Date(startMs).toISOString().slice(0, 16)}Z&endts=${new Date(endMs).toISOString().slice(0, 16)}Z`;
    const response = await requestManager.fetchWithRetry(url, { headers: { Accept: 'application/geo+json, application/json' } });
    return prepareWarnings(await response.json());
}

/**
 * Load reports (and warnings) for state.startMs..state.endMs.
 * @param {object} [options]
 * @param {boolean} [options.fit] zoom to the reports / location afterwards
 * @param {number} [options.playhead] where to put the playhead (default: start, or end in live mode)
 * @param {boolean} [options.quiet] no loading toast (live refresh)
 */
async function loadData({ fit = true, playhead, quiet = false } = {}) {
    const token = ++loadToken;
    if (!quiet) showStatusToast('Loading storm reports...', 'loading');
    if (state.playing) setPlaying(false);
    try {
        if (!lsrService) lsrService = new LSRService(CONFIG);
        const [geoJson, warnings] = await Promise.all([
            lsrService.fetchLSRData({
                startDate: utcDate(state.startMs),
                startHour: utcHHMM(state.startMs),
                endDate: utcDate(state.endMs),
                endHour: utcHHMM(state.endMs),
                useCache: state.mode !== 'live'
            }),
            fetchWarnings(state.startMs, state.endMs).catch((e) => {
                errorHandler.log('Warning archive unavailable', e);
                return [];
            }),
            resolveRegion()
        ]);
        if (token !== loadToken) return;
        rawReports = prepareReports(geoJson);
        rawWarnings = warnings;

        const live = state.mode === 'live';
        const target = playhead ?? (live ? state.endMs : state.startMs);
        state.t = Math.min(state.endMs, Math.max(state.startMs, target));
        applyFilters();
        if (fit) fitToData();
        settleRadar();
        if (live) $('liveUpdated').textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        if (!quiet) {
            hideStatusToast();
            showStatusToast(`Loaded ${reports.length.toLocaleString()} reports and ${rawWarnings.length.toLocaleString()} warnings`, 'success');
        }
    } catch (error) {
        if (token !== loadToken) return;
        hideStatusToast();
        const handled = errorHandler.handleError(error, 'Playback load');
        showStatusToast(handled.message || 'Could not load storm reports', 'error', () => loadData({ fit, playhead }));
    }
}

function fitToData() {
    let b = regionBounds;
    if (!b && reports.length) {
        b = { south: 90, north: -90, west: 180, east: -180 };
        for (const r of reports) {
            b.south = Math.min(b.south, r.lat); b.north = Math.max(b.north, r.lat);
            b.west = Math.min(b.west, r.lon); b.east = Math.max(b.east, r.lon);
        }
    }
    if (!b || !map) return;
    map.fitBounds([[b.west, b.south], [b.east, b.north]], { padding: { top: 60, bottom: 40, left: 60, right: 340 }, maxZoom: 9, duration: 600 });
}

// ============================================================================
// CLOCK
// ============================================================================
//
// While playing, the playhead advances every animation frame at state.speed
// minutes of weather per second. Each frame only updates feature states
// (reports that appeared or aged, warnings that began or ended) and the radar
// crossfade; text and histogram updates are throttled.

const MAX_BUFFER_WAIT_MS = 4000; // give up waiting for slow radar after this

/** Radar frames to keep loading ahead (frames are thinned while playing fast) */
const bufferFrames = () => 8;

/**
 * Radar frame interval while playing: at most ~1.5 new frames per second, which
 * IEM's tile server can keep up with (5-min frames at 5 min/s, 20-min at 30 min/s).
 * Paused or stepping, every 5-minute frame is used.
 */
function radarStepMs() {
    return state.playing ? 5 * MINUTE * Math.max(1, Math.ceil(state.speed / 7.5)) : 5 * MINUTE;
}
const FADE_REAL_MS = 450; // new reports fade in over this much real time
const UI_INTERVAL_MS = 120;

let reportStates = null;
let alertStates = null;
let rafId = 0;
let lastFrameAt = 0;
let lastUiAt = 0;
let buffering = false;
let bufferingSince = 0;
let holdUntil = 0; // live loop: pause on the newest frame before looping

const weatherMsPerRealMs = () => (state.speed * MINUTE) / 1000;
const radarOn = () => Boolean(radar && state.showRadar);

/** Push the playhead into feature states, radar and (unless ui is false) the text/histogram */
function renderTime({ ui = true } = {}) {
    const t = state.t;
    if (!t) return; // nothing loaded yet
    const fadeMs = state.playing ? FADE_REAL_MS * weatherMsPerRealMs() : 0;
    reportStates?.update(t, state.trailMin * MINUTE, fadeMs);
    alertStates?.update(t);
    if (radarOn()) radar.render(t);
    updatePlayhead();
    if (ui) {
        updateReadout();
        updateTimelineBars();
        scheduleUrlUpdate();
    }
}

/** Move the playhead (scrubbing, stepping, loading) */
function setTime(ms, { userScrub = false } = {}) {
    state.t = Math.min(state.endMs, Math.max(state.startMs, ms));
    if (userScrub && state.mode === 'live') {
        state.follow = state.t >= state.endMs;
        updateLiveBadge();
    }
    if (radarOn()) radar.bufferAhead(state.t, 2);
    renderTime();
    if (!state.playing) settleRadar();
}

/** While paused, redraw the radar as the frames for the playhead finish loading */
let settleId = 0;
function settleRadar() {
    cancelAnimationFrame(settleId);
    if (!radarOn()) return;
    const until = performance.now() + 8000;
    const step = (now) => {
        if (state.playing) return;
        radar.render(state.t);
        updateRadarStatus();
        if (!radar.isReady(state.t) && now < until) settleId = requestAnimationFrame(step);
    };
    settleId = requestAnimationFrame(step);
}

function setPlaying(playing) {
    state.playing = playing;
    cancelAnimationFrame(rafId);
    const icon = $('btnPlay').querySelector('i');
    icon.className = playing ? 'fas fa-pause' : 'fas fa-play';
    $('btnPlay').title = playing ? 'Pause (Space)' : 'Play (Space)';
    holdUntil = 0;
    radar?.setFrameStep(radarStepMs());
    if (playing) {
        if (state.mode === 'live') {
            state.follow = false;
            updateLiveBadge();
            // Live loop: last hour of the window
            if (state.t >= state.endMs) state.t = Math.max(state.startMs, state.endMs - LIVE_LOOP_MS);
        } else if (state.t >= state.endMs) {
            state.t = state.startMs; // replay from the start
        }
        // Fill the radar buffer before moving so playback does not stutter
        if (radarOn()) radar.bufferAhead(state.t, bufferFrames());
        buffering = radarOn() && !radar.isReady(state.t, 2);
        bufferingSince = performance.now();
        lastFrameAt = performance.now();
        rafId = requestAnimationFrame(tick);
    } else {
        buffering = false;
        renderTime(); // settle fades (fade length is 0 while paused)
        settleRadar();
    }
    updateRadarStatus();
}

function tick(now) {
    if (!state.playing) return;
    // Real-time rate even at low frame rates; cap only long gaps (e.g. a background tab)
    const dt = Math.min(now - lastFrameAt, 250);
    lastFrameAt = now;
    if (radarOn()) radar.bufferAhead(state.t, bufferFrames());

    if (holdUntil) {
        if (now < holdUntil) {
            rafId = requestAnimationFrame(tick);
            return;
        }
        holdUntil = 0;
        state.t = Math.max(state.startMs, state.endMs - LIVE_LOOP_MS);
    }

    // Keep moving while radar keeps up (a frame that is late just skips its
    // crossfade); hold only when the radar would fall a whole frame behind
    if (buffering) {
        if (!radarOn() || radar.isReady(state.t, 2) || now - bufferingSince > MAX_BUFFER_WAIT_MS) {
            buffering = false;
            updateRadarStatus();
        } else {
            renderTime({ ui: false });
            rafId = requestAnimationFrame(tick);
            return;
        }
    } else if (radarOn() && !radar.isFrameLoaded(state.t)) {
        buffering = true;
        bufferingSince = now;
        updateRadarStatus();
        rafId = requestAnimationFrame(tick);
        return;
    }

    const next = state.t + dt * weatherMsPerRealMs();
    if (next >= state.endMs) {
        state.t = state.endMs;
        if (state.mode === 'live') {
            holdUntil = now + 1500; // hold on the newest frame, then loop the last hour
            renderTime();
            rafId = requestAnimationFrame(tick);
        } else {
            setPlaying(false);
        }
        return;
    }
    state.t = next;
    const uiDue = now - lastUiAt >= UI_INTERVAL_MS;
    if (uiDue) lastUiAt = now;
    renderTime({ ui: uiDue });
    rafId = requestAnimationFrame(tick);
}

/** Step buttons / arrow keys: snap to the step grid */
function stepBy(n) {
    if (state.playing) setPlaying(false);
    const step = stepMs();
    const index = Math.round((state.t - state.startMs) / step) + n;
    setTime(state.startMs + index * step, { userScrub: true });
}

function updateRadarStatus() {
    const el = $('radarStatus');
    if (!el) return;
    if (!radarOn()) {
        el.textContent = 'Radar off';
    } else if (buffering) {
        el.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Buffering radar…';
    } else {
        const frame = radar.dominantFrame;
        el.textContent = frame ? `Radar ${formatUtc(frame, false)}` : 'Radar loading…';
    }
}

// ============================================================================
// TIMELINE (histogram + scrubber)
// ============================================================================

const BIN_SIZES = [5, 10, 15, 30, 60, 120, 180, 360, 720].map(m => m * MINUTE);

function buildTimeline() {
    const range = Math.max(MINUTE, state.endMs - state.startMs);
    const size = BIN_SIZES.find(s => range / s <= 144) || 24 * HOUR;
    const n = Math.max(1, Math.ceil(range / size));
    const counts = new Array(n).fill(0);
    for (const t of times) {
        const i = Math.floor((t - state.startMs) / size);
        if (i >= 0 && i < n) counts[i]++;
    }
    bins = { size, counts, rects: [] };

    // Scrubber resolution: one minute
    $('scrubber').max = String(Math.max(1, Math.round(range / MINUTE)));
    drawHistogram();
    drawAxis();
    updatePlayhead();
    updateTimelineBars();
}

function drawHistogram() {
    const svg = $('histogram');
    const width = svg.clientWidth || 600;
    const height = svg.clientHeight || 44;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.textContent = '';
    const ns = 'http://www.w3.org/2000/svg';
    const range = state.endMs - state.startMs || 1;
    const peak = Math.max(1, ...bins.counts);
    const top = 12; // room for the peak label
    bins.rects = bins.counts.map((count, i) => {
        const x0 = ((i * bins.size) / range) * width;
        const x1 = Math.min(width, (((i + 1) * bins.size) / range) * width);
        const w = Math.max(1, x1 - x0 - 2); // 2px surface gap between bars
        const h = count ? Math.max(2, ((height - top) * count) / peak) : 0;
        const r = Math.min(2, w / 2, h);
        const x = x0 + 1, y = height - h;
        const rect = document.createElementNS(ns, 'path');
        // Rounded data end (top), square at the baseline
        rect.setAttribute('d', h ? `M${x},${height}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${height}Z` : '');
        svg.appendChild(rect);
        return rect;
    });
    const label = document.createElementNS(ns, 'text');
    label.setAttribute('class', 'peak-label');
    label.setAttribute('x', '2');
    label.setAttribute('y', '9');
    const per = bins.size >= HOUR ? `${bins.size / HOUR} h` : `${bins.size / MINUTE} min`;
    label.textContent = `max ${peak.toLocaleString()} reports / ${per}`;
    svg.appendChild(label);
}

function drawAxis() {
    const axis = $('axis');
    axis.textContent = '';
    const range = state.endMs - state.startMs;
    if (range <= 0) return;
    const tickSizes = [HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, 24 * HOUR];
    const width = axis.clientWidth || 600;
    const tick = tickSizes.find(s => (range / s) * 70 <= width) || 24 * HOUR;
    for (let t = Math.ceil(state.startMs / tick) * tick; t <= state.endMs; t += tick) {
        const span = document.createElement('span');
        span.style.left = `${((t - state.startMs) / range) * 100}%`;
        const d = new Date(t);
        span.textContent = d.getUTCHours() === 0 ? `${MONTH[d.getUTCMonth()]} ${d.getUTCDate()}` : `${pad(d.getUTCHours())}Z`;
        axis.appendChild(span);
    }
}

/** Playhead marker and scrubber (every animation frame while playing) */
function updatePlayhead() {
    const range = state.endMs - state.startMs || 1;
    const fraction = (state.t - state.startMs) / range;
    $('playhead').style.left = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
    $('scrubber').value = String(Math.round((state.t - state.startMs) / MINUTE));
}

/** Histogram bars before the playhead are drawn as played */
function updateTimelineBars() {
    bins.rects.forEach((rect, i) => {
        const binEnd = state.startMs + (i + 1) * bins.size;
        rect.setAttribute('class', binEnd <= state.t + 1 ? 'bar-played' : 'bar-future');
    });
}

function showTrackTooltip(clientX) {
    const track = $('track');
    const box = track.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (clientX - box.left) / box.width));
    const ms = state.startMs + fraction * (state.endMs - state.startMs);
    const i = Math.min(bins.counts.length - 1, Math.floor((ms - state.startMs) / bins.size));
    if (i < 0) return;
    const b0 = state.startMs + i * bins.size;
    const b1 = Math.min(state.endMs, b0 + bins.size);
    const tip = $('trackTooltip');
    const count = bins.counts[i];
    tip.textContent = `${formatUtc(b0)}–${formatUtc(b1, false)} · ${count.toLocaleString()} report${count === 1 ? '' : 's'}`;
    tip.style.left = `${fraction * 100}%`;
    tip.hidden = false;
    bins.rects.forEach((r, j) => r.classList.toggle('bar-hover', j === i));
}

function hideTrackTooltip() {
    $('trackTooltip').hidden = true;
    bins.rects.forEach(r => r.classList.remove('bar-hover'));
}

function updateReadout() {
    $('timeUtc').textContent = state.endMs ? formatUtc(state.t) : '--';
    $('timeLocal').textContent = state.endMs ? `${formatLocal(state.t)} local` : '';
    const shown = countUpTo(state.t);
    const recent = shown - Math.min(shown, countUpTo(state.t - state.trailMin * MINUTE)); // same rule as ReportTimeStates
    const trailLabel = state.trailMin >= 60 ? `${state.trailMin / 60} h` : `${state.trailMin} min`;
    $('reportCount').innerHTML = `${shown.toLocaleString()} of ${reports.length.toLocaleString()} reports · ` +
        `<span class="pb-recent-dot"></span> ${recent.toLocaleString()} in last ${trailLabel}`;
    updateRadarStatus();
}

// ============================================================================
// LIVE MODE
// ============================================================================

function liveRange() {
    const end = floorTo(Date.now(), 5 * MINUTE);
    return { start: end - state.liveHours * HOUR, end };
}

function updateLiveBadge() {
    const badge = $('btnGoLive');
    badge.hidden = state.mode !== 'live';
    badge.classList.toggle('following', state.follow);
    badge.title = state.follow ? 'Following the latest time' : 'Jump back to now';
}

function setMode(mode, { load = true } = {}) {
    state.mode = mode;
    const live = mode === 'live';
    $('modePlayback').classList.toggle('active', !live);
    $('modePlayback').setAttribute('aria-pressed', String(!live));
    $('modeLive').classList.toggle('active', live);
    $('modeLive').setAttribute('aria-pressed', String(live));
    $('rangeFields').hidden = live;
    $('liveFields').hidden = !live;
    $('loadButton').hidden = live;
    const title = $('modeTitle');
    title.textContent = live ? 'Live' : 'Playback';
    title.classList.toggle('live', live);
    document.title = `NWS Local Storm Reports - ${live ? 'Live' : 'Playback'}`;
    clearInterval(liveTimer);
    liveTimer = null;
    if (live) {
        state.follow = true;
        const { start, end } = liveRange();
        state.startMs = start;
        state.endMs = end;
        state.stepMin = 5;
        state.speed = 10; // the last-hour loop takes about 6 seconds, like the old live radar
        $('stepSelect').value = String(state.stepMin);
        $('speedSelect').value = String(state.speed);
        markPresets('livePresets', state.liveHours);
        liveTimer = setInterval(refreshLive, LIVE_REFRESH_MS);
        if (load) loadData({ fit: true });
    } else {
        state.follow = false;
        setRangeInputs();
    }
    updateLiveBadge();
}

async function refreshLive() {
    if (state.mode !== 'live') return;
    const { start, end } = liveRange();
    const keep = state.follow ? end : Math.max(start, state.t);
    state.startMs = start;
    state.endMs = end;
    const wasPlaying = state.playing;
    await loadData({ fit: false, playhead: keep, quiet: true });
    if (wasPlaying) setPlaying(true);
}

function goLive() {
    setPlaying(false);
    state.follow = true;
    updateLiveBadge();
    setTime(state.endMs);
}

// ============================================================================
// SETTINGS PANEL
// ============================================================================

function buildRegionSelect() {
    const select = $('regionSelect');
    const add = (parent, value, label) => {
        const o = document.createElement('option');
        o.value = value;
        o.textContent = label;
        parent.appendChild(o);
    };
    add(select, '', 'All (United States)');
    const nwsKeys = CONFIG.NWS_ADMIN_REGION_KEYS || [];
    const groups = [
        ['Regions', Object.keys(CONFIG.REGIONS).filter(k => !nwsKeys.includes(k)).map(k => [k, CONFIG.REGIONS[k].name])],
        ['NWS Administrative Regions', nwsKeys.filter(k => CONFIG.REGIONS[k]).map(k => [k, CONFIG.REGIONS[k].name])],
        ['States', Object.keys(CONFIG.STATES).map(k => [k, CONFIG.STATES[k].name]).sort((a, b) => a[1].localeCompare(b[1]))]
    ];
    for (const [label, items] of groups) {
        const group = document.createElement('optgroup');
        group.label = label;
        items.forEach(([value, name]) => add(group, value, name));
        select.appendChild(group);
    }
}

function setRangeInputs() {
    $('rangeStart').value = toInput(state.startMs);
    $('rangeEnd').value = toInput(state.endMs);
}

function markPresets(containerId, hours) {
    document.querySelectorAll(`#${containerId} button`).forEach(b => {
        b.classList.toggle('active', Number(b.dataset.hours) === hours);
    });
}

function setPlaybackRange(startMs, endMs) {
    if (!(endMs > startMs)) {
        showStatusToast('The end time must be after the start time.', 'error');
        return false;
    }
    if (endMs - startMs > MAX_RANGE_MS) {
        showStatusToast('Playback ranges are limited to 7 days.', 'error');
        return false;
    }
    state.startMs = startMs;
    state.endMs = endMs;
    // Defaults: a few minutes of real time to play any range; fine steps for short ranges
    const hours = (endMs - startMs) / HOUR;
    state.stepMin = hours <= 12 ? 5 : hours <= 48 ? 15 : 60;
    state.speed = hours <= 6 ? 5 : hours <= 24 ? 15 : hours <= 48 ? 30 : 120;
    $('stepSelect').value = String(state.stepMin);
    $('speedSelect').value = String(state.speed);
    setRangeInputs();
    return true;
}

/**
 * IEM N0Q reflectivity colors (read from the palette of IEM's n0q GIS composite,
 * the same colors its tiles use), every 5 dBZ.
 */
const N0Q_LEGEND = [
    [5, '#6376a8'], [10, '#4568a6'], [15, '#60b4d4'], [20, '#43d67e'], [25, '#0eb314'],
    [30, '#0b840e'], [35, '#327308'], [40, '#ffe200'], [45, '#ffac00'], [50, '#f80000'],
    [55, '#aa0000'], [60, '#ffeaff'], [65, '#f960fa'], [70, '#a400f7'], [75, '#05eaf0']
];

function buildRadarLegend() {
    const first = N0Q_LEGEND[0][0];
    const span = N0Q_LEGEND[N0Q_LEGEND.length - 1][0] - first;
    const stops = N0Q_LEGEND.map(([dbz, color]) => `${color} ${((dbz - first) / span) * 100}%`).join(', ');
    $('radarLegendBar').style.background = `linear-gradient(to right, ${stops})`;
    const ticks = $('radarLegendTicks');
    ticks.textContent = '';
    for (const dbz of [10, 20, 30, 40, 50, 60, 70]) {
        const label = document.createElement('span');
        label.style.left = `${((dbz - first) / span) * 100}%`;
        label.textContent = String(dbz);
        ticks.appendChild(label);
    }
}

function setupControls() {
    buildRadarLegend();
    $('modePlayback').addEventListener('click', () => {
        if (state.mode === 'playback') return;
        setPlaying(false);
        setMode('playback');
        renderTime();
    });
    $('modeLive').addEventListener('click', () => {
        if (state.mode === 'live') return;
        setPlaying(false);
        setMode('live');
    });

    $('rangePresets').addEventListener('click', (e) => {
        const hours = Number(e.target.closest('button')?.dataset.hours);
        if (!hours) return;
        const end = floorTo(Date.now(), 5 * MINUTE);
        if (setPlaybackRange(end - hours * HOUR, end)) {
            markPresets('rangePresets', hours);
            loadData({ fit: true });
        }
    });
    $('livePresets').addEventListener('click', (e) => {
        const hours = Number(e.target.closest('button')?.dataset.hours);
        if (!hours) return;
        state.liveHours = hours;
        setMode('live');
    });
    for (const id of ['rangeStart', 'rangeEnd']) {
        $(id).addEventListener('change', () => markPresets('rangePresets', 0));
    }
    $('loadButton').addEventListener('click', () => {
        if (setPlaybackRange(fromInput($('rangeStart').value), fromInput($('rangeEnd').value))) {
            loadData({ fit: true });
        }
    });

    $('regionSelect').addEventListener('change', async (e) => {
        state.region = e.target.value;
        await resolveRegion();
        applyFilters();
        fitToData();
    });
    $('typeSelect').addEventListener('change', (e) => {
        state.typesKey = e.target.value;
        applyFilters();
    });
    $('showRadar').addEventListener('change', (e) => {
        state.showRadar = e.target.checked;
        $('radarFields').hidden = !state.showRadar;
        radar?.setEnabled(state.showRadar);
        renderTime();
        settleRadar();
        updateRadarStatus();
    });
    $('radarOpacity').addEventListener('input', (e) => {
        state.radarOpacity = Number(e.target.value) / 100;
        $('radarOpacityValue').textContent = `${e.target.value}%`;
        radar?.setOpacity(state.radarOpacity);
        if (radarOn()) radar.render(state.t);
    });
    $('showWarnings').addEventListener('change', (e) => {
        state.showWarnings = e.target.checked;
        if (state.showWarnings) warningsLayer?.show(); else warningsLayer?.hide();
    });
    $('trailSelect').addEventListener('change', (e) => {
        state.trailMin = Number(e.target.value);
        renderTime();
    });
    $('togglePanel').addEventListener('click', () => {
        const panel = $('settingsPanel');
        const collapsed = panel.classList.toggle('collapsed');
        $('togglePanel').setAttribute('aria-expanded', String(!collapsed));
        $('togglePanel').querySelector('i').className = collapsed ? 'fas fa-chevron-down' : 'fas fa-chevron-up';
        $('togglePanel').title = collapsed ? 'Show settings' : 'Collapse settings';
    });

    // Transport
    $('btnPlay').addEventListener('click', () => setPlaying(!state.playing));
    $('btnBack').addEventListener('click', () => stepBy(-1));
    $('btnForward').addEventListener('click', () => stepBy(1));
    $('btnStart').addEventListener('click', () => { if (state.playing) setPlaying(false); setTime(state.startMs, { userScrub: true }); });
    $('btnEnd').addEventListener('click', () => { if (state.playing) setPlaying(false); setTime(state.endMs, { userScrub: true }); });
    $('btnGoLive').addEventListener('click', goLive);
    $('stepSelect').addEventListener('change', (e) => {
        state.stepMin = Number(e.target.value);
    });
    $('speedSelect').addEventListener('change', (e) => {
        state.speed = Number(e.target.value);
        radar?.setFrameStep(radarStepMs());
    });

    const scrubber = $('scrubber');
    scrubber.addEventListener('input', () => {
        // Read before pausing: pausing redraws the playhead and resets the scrubber
        const minutes = Number(scrubber.value);
        if (state.playing) setPlaying(false);
        setTime(state.startMs + minutes * MINUTE, { userScrub: true });
    });
    scrubber.addEventListener('pointermove', (e) => showTrackTooltip(e.clientX));
    scrubber.addEventListener('pointerleave', hideTrackTooltip);

    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => { drawHistogram(); drawAxis(); updatePlayhead(); updateTimelineBars(); }, 150);
    });

    // Keyboard: Space play/pause, arrows step, Home/End, L live
    document.addEventListener('keydown', (e) => {
        const tag = e.target.tagName;
        const onScrubber = e.target === scrubber;
        if (!onScrubber && (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || e.target.isContentEditable)) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.key === ' ') {
            e.preventDefault();
            setPlaying(!state.playing);
        } else if (!onScrubber && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
            e.preventDefault();
            stepBy(e.key === 'ArrowLeft' ? -1 : 1);
        } else if (!onScrubber && e.key === 'Home') {
            e.preventDefault();
            $('btnStart').click();
        } else if (!onScrubber && e.key === 'End') {
            e.preventDefault();
            $('btnEnd').click();
        } else if (e.key.toLowerCase() === 'l') {
            if (state.mode === 'live') goLive(); else $('modeLive').click();
        }
    });

    $('closeStatusToast')?.addEventListener('click', () => { $('statusToast').style.display = 'none'; });
}

// ============================================================================
// URL STATE
// ============================================================================

function filterParams() {
    const params = new URLSearchParams();
    if (state.region) params.set('region', state.region);
    const types = activeTypes();
    if (types) params.set('types', [...types].join(','));
    return params;
}

function scheduleUrlUpdate() {
    clearTimeout(urlTimer);
    urlTimer = setTimeout(() => {
        const params = filterParams();
        if (state.mode === 'live') {
            params.set('mode', 'live');
            params.set('hours', String(state.liveHours));
        } else if (state.endMs) {
            params.set('start', toParam(state.startMs));
            params.set('end', toParam(state.endMs));
            params.set('t', toParam(state.t));
        }
        history.replaceState(null, '', `${location.pathname}?${params}`);

        // "Map" link: same range and filters on the main map
        const mapParams = filterParams();
        if (state.endMs) {
            mapParams.set('start', toParam(state.startMs));
            mapParams.set('end', toParam(state.endMs));
        }
        $('linkMainMap').href = `index.html?${mapParams}`;
    }, 300);
}

function readUrl() {
    const params = new URLSearchParams(location.search);
    state.region = params.get('region') || '';
    if (state.region && !CONFIG.STATES[state.region] && !CONFIG.REGIONS[state.region]) state.region = '';
    $('regionSelect').value = state.region;

    const types = (params.get('types') || '').split(',').map(s => s.trim()).filter(Boolean);
    if (types.length && types.length < CONFIG.WEATHER_TYPES.length) {
        const key = Object.keys(WEATHER_CATEGORIES).find(k => {
            const set = WEATHER_CATEGORIES[k];
            return set.length === types.length && set.every(t => types.includes(t));
        });
        if (key) {
            state.typesKey = key;
        } else {
            state.typesKey = 'custom';
            state.customTypes = types;
            const o = document.createElement('option');
            o.value = 'custom';
            o.textContent = `Custom (${types.length} type${types.length === 1 ? '' : 's'})`;
            $('typeSelect').appendChild(o);
        }
    }
    $('typeSelect').value = state.typesKey;

    const hours = Number(params.get('hours'));
    if ([3, 6, 12, 24].includes(hours)) state.liveHours = hours;

    if (params.get('mode') === 'live') {
        return { live: true };
    }
    let start = fromParam(params.get('start'));
    let end = fromParam(params.get('end'));
    if (!(end > start)) {
        end = floorTo(Date.now(), 5 * MINUTE);
        start = end - 24 * HOUR;
        markPresets('rangePresets', 24);
    }
    if (end - start > MAX_RANGE_MS) start = end - MAX_RANGE_MS;
    setPlaybackRange(start, end);
    return { live: false, t: fromParam(params.get('t')) };
}

// ============================================================================
// THEME
// ============================================================================

function setupTheme() {
    const toggle = $('darkModeToggle');
    const icon = $('darkModeIcon');
    const label = toggle.querySelector('.header-action-label');
    const apply = (theme) => {
        const dark = theme === 'dark';
        if (dark) document.documentElement.setAttribute('data-theme', 'dark');
        else document.documentElement.removeAttribute('data-theme');
        icon.className = dark ? 'fas fa-sun' : 'fas fa-moon';
        label.textContent = dark ? 'Light Mode' : 'Dark Mode';
        toggle.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
        try { localStorage.setItem('lsr-theme', theme); } catch (e) { /* storage unavailable */ }
        applyBasemapTheme(map, theme);
    };
    apply(getSavedTheme());
    toggle.addEventListener('click', () => {
        apply(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    });
}

// ============================================================================
// STARTUP
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
    buildRegionSelect();
    setupControls();
    const initial = readUrl();

    ({ map } = await createMap('map', {
        theme: getSavedTheme(),
        center: [CONFIG.MAP_INITIAL.lon, CONFIG.MAP_INITIAL.lat],
        zoom: CONFIG.MAP_INITIAL.zoom
    }));
    setupTheme();

    areaOverlay = new AreaOverlay('pb-area');
    // Time is applied through feature state (see js/map/timeStates.js), keyed by feature index
    warningsLayer = new AlertLayer(maplibregl, 'pb-warnings', {
        sourceOptions: { promoteId: 'i' },
        paint: ALERT_TIME_PAINT,
        acceptsAlert: (alert) => alert.properties.b <= state.t && state.t < alert.properties.e
    });
    radar = new RadarPlayer({ prefix: 'pb-radar', opacity: state.radarOpacity });
    reportLayer = new ReportLayer(maplibregl, {
        id: 'pb-reports',
        popupHtml: (report) => createPopupContent(report),
        featureProperties: (report) => ({ t: report.tms }),
        sourceOptions: { promoteId: 'i' },
        acceptsReport: (report) => report.tms <= state.t
    });
    reportLayer.setPaintProperty('icon-opacity', REPORT_ICON_OPACITY);

    map.on('load', () => {
        // Bottom to top: basemap, area outline, warning fill, radar, warning outlines,
        // basemap labels, recent-report halos, reports
        areaOverlay.addTo(map, LABEL_ANCHOR_LAYER);
        warningsLayer.addTo(map, LABEL_ANCHOR_LAYER);
        radar.addTo(map, 'pb-warnings-line');
        reportLayer.addTo(map);
        map.addLayer({
            id: 'pb-recent-halo',
            type: 'circle',
            source: 'pb-reports',
            paint: RECENT_HALO_PAINT
        }, 'pb-reports');
        reportStates = new ReportTimeStates(map, 'pb-reports');
        alertStates = new AlertTimeStates(map, 'pb-warnings');
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            window.lsrPlayback = { state, radar }; // debugging / browser tests
        }
        map.on('click', (e) => routeFeatureClick(map, e, [reportLayer, warningsLayer]));

        if (initial.live) {
            setMode('live');
        } else {
            setMode('playback', { load: false });
            loadData({ fit: true, playhead: Number.isFinite(initial.t) ? initial.t : undefined });
        }
    });
});
