// ============================================================================
// MODULE IMPORTS
// ============================================================================

import { formatDateForAPI, extractWindSpeed, getUnitForReportType, getReportTypeName } from './js/utils/formatters.js';
import { errorHandler, ERROR_TYPES } from './js/errors/errorHandler.js';
import { cacheService } from './js/cache/cacheService.js';
import { requestManager } from './js/api/requestManager.js';
import LSRService from './js/api/lsrService.js';
import { offlineDetector } from './js/utils/offlineDetector.js';
import { appState } from './js/state/appState.js';
import { maplibregl, createMap, routeFeatureClick, getSavedTheme } from './js/map/mapSetup.js';
import { createIcon, getIconForReport } from './js/map/iconService.js';
import { createPopupContent } from './js/map/popupService.js';
import { ReportLayer } from './js/map/reportLayer.js';
import { AreaOverlay, AlertLayer } from './js/map/overlayLayers.js';
import { applyBasemapTheme, LABEL_ANCHOR_LAYER } from './js/map/basemap.js';
import { showStatusToast, hideStatusToast } from './js/ui/toastService.js';
import WarningsService from './js/api/warningsService.js';
import PNSService from './js/api/pnsService.js';
import StatisticsService from './js/ui/statisticsService.js';
import ReportCountService from './js/ui/reportCountService.js';
import FilterService from './js/filter/filterService.js';
import { normalizeLSRReports as normalizeLSRReportsCore } from './js/lsr/normalizeLSR.js';
import {
    loadBoundaryGeoJson,
    boundariesReady,
    boundsOfFeatures,
    getStateBoundaryFeatures,
    getWfoBoundaryFeatures,
    getNwsAdminRegionFeatures,
    isNwsAdminRegionWithGeoJson,
    getClipFeaturesForSelection,
    pointInClipFeatures
} from './js/map/boundaryOverlays.js';

// ============================================================================
// MAP INITIALIZATION
// ============================================================================

// Map (MapLibre GL, WebGL) will be initialized in DOMContentLoaded
let map = null;
let markersLayer = null; // ReportLayer: LSR icons
let pnsLayer = null; // ReportLayer: Public Information Statements
let showPNS = false; // Toggle for PNS display
let warningsLayer = null; // AlertLayer: short-fuse warnings
let showWarnings = false; // Toggle for warnings display
let showAllWarningsLayer = false;
let showAllWatchesLayer = false;
let warningsService = null; // Warnings service instance
let allWarningsLayer = null; // AlertLayer
let allWatchesLayer = null; // AlertLayer
let warningsListenersAttached = false;
let userArea = null; // AreaOverlay: selected location outline
let lastWarningsToastTime = 0;
let selectedWFO = null;

// Initialize LSR Service
let lsrService = null;

// Initialize PNS Service
let pnsService = null;

// Initialize Statistics Service
let statisticsService = null;

// Initialize Report Count Service
let reportCountService = null;

// Initialize Filter Service
let filterService = null;

// ============================================================================
// ICON CREATION (wrapper functions for compatibility)
// ============================================================================

// Wrapper to maintain compatibility with existing code
function createIconWrapper(config, fillColor, strokeColor, emoji = null) {
    if (typeof CONFIG === 'undefined') {
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            console.error('CONFIG not available');
        }
        return null;
    }
    return createIcon(config, fillColor, strokeColor, emoji, CONFIG.ICON_SIZE);
}

// Wrapper for getIconForReport
function getIconForReportWrapper(rtype, magnitude, remark, typetext = '') {
    if (typeof CONFIG === 'undefined' || typeof ICON_CONFIG === 'undefined') {
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            console.error('CONFIG or ICON_CONFIG not available');
        }
        return null;
    }
    return getIconForReport(rtype, magnitude, remark, ICON_CONFIG, CONFIG.ICON_SIZE, extractWindSpeed, typetext);
}

// ============================================================================
// API FETCHING - Now using LSRService module
// ============================================================================

// ============================================================================
// STATUS TOAST - Now using toastService module (imported above)
// ============================================================================

// ============================================================================
// FILTER SUMMARY
// ============================================================================

function getWeatherTypeId(type) {
    return String(type).toLowerCase().replace(/\s+/g, '-');
}

function getActiveWeatherFilters() {
    return Array.from(document.querySelectorAll('input[id^="hidden-filter-"]:checked'))
        .map(cb => cb.value);
}

/** Last LSR API query range (UTC) shown in Current View; cleared when form edits or fetch fails */
let activeLsrQueryRange = null;

function clearActiveLsrQueryRange() {
    activeLsrQueryRange = null;
}

function setActiveLsrQueryRange(startDate, startHour, endDate, endHour) {
    activeLsrQueryRange = { startDate, startHour, endDate, endHour };
}

function formatSummaryDateRange(startDate, startHour, endDate, endHour) {
    const sh = startHour || '';
    const eh = endHour || '';
    const startSuffix = sh ? ` ${sh}` : '';
    const endSuffix = eh ? ` ${eh}` : '';
    return `${startDate}${startSuffix} to ${endDate}${endSuffix}`;
}

function updateFilterSummary() {
    const summary = document.getElementById('filterSummary');
    const summaryDate = document.getElementById('summaryDate');
    const summaryLocation = document.getElementById('summaryLocation');
    const summaryTypes = document.getElementById('summaryTypes');
    
    if (!summary || !summaryDate || !summaryLocation || !summaryTypes) return;
    
    // Update date summary with exact range
    const startDateEl = document.getElementById('startDate');
    const endDateEl = document.getElementById('endDate');
    const startHourEl = document.getElementById('startHour');
    const endHourEl = document.getElementById('endHour');
    const startDate = startDateEl?.value || '';
    const endDate = endDateEl?.value || '';
    const startHour = normalizeTimeInputValue(startHourEl?.value || '') || (startHourEl?.value || '').trim();
    const endHour = normalizeTimeInputValue(endHourEl?.value || '') || (endHourEl?.value || '').trim();

    if (activeLsrQueryRange) {
        const q = activeLsrQueryRange;
        summaryDate.textContent = formatSummaryDateRange(
            q.startDate,
            q.startHour,
            q.endDate,
            q.endHour
        );
    } else if (startDate && endDate) {
        summaryDate.textContent = formatSummaryDateRange(startDate, startHour, endDate, endHour);
    } else {
        const activePreset = document.querySelector('.btn-preset.active');
        summaryDate.textContent = activePreset?.textContent?.trim() || 'Custom';
    }
    
    // Update location summary
    if (selectedWFO) {
        summaryLocation.textContent = getWfoDisplayName(selectedWFO);
    } else {
        const regionSelect = document.getElementById('regionSelect');
        const selectedRegion = regionSelect.value;
        if (selectedRegion) {
            if (CONFIG.STATES[selectedRegion]) {
                summaryLocation.textContent = CONFIG.STATES[selectedRegion].name;
            } else if (CONFIG.REGIONS[selectedRegion]) {
                summaryLocation.textContent = CONFIG.REGIONS[selectedRegion].name;
            } else {
                summaryLocation.textContent = selectedRegion;
            }
        } else {
            summaryLocation.textContent = 'All US';
        }
    }
    
    // Update types summary
    const activeTypes = Array.from(document.querySelectorAll('input[id^="hidden-filter-"]:checked'));
    if (activeTypes.length === CONFIG.WEATHER_TYPES.length) {
        summaryTypes.textContent = 'All types';
    } else if (activeTypes.length === 0) {
        summaryTypes.textContent = 'No types';
    } else {
        summaryTypes.textContent = `${activeTypes.length} type${activeTypes.length > 1 ? 's' : ''}`;
    }
    
    // Show summary
    summary.style.display = 'flex';

    const tableLink = document.getElementById('linkReportsTable');
    if (tableLink) {
        tableLink.href = tableOfReportsHref();
    }
    const playbackLink = document.getElementById('openPlayback');
    if (playbackLink) {
        playbackLink.href = playbackHref(false);
    }
    const liveLink = document.getElementById('openLive');
    if (liveLink) {
        liveLink.href = playbackHref(true);
    }
}

/**
 * Link to the Playback & Live page with the current location and types
 * (and, for playback, the current date range).
 */
function playbackHref(live) {
    const params = new URLSearchParams();
    if (live) {
        params.set('mode', 'live');
    } else {
        const startDate = document.getElementById('startDate')?.value;
        const startHour = normalizeTimeInputValue(document.getElementById('startHour')?.value || '');
        const endDate = document.getElementById('endDate')?.value;
        const endHour = normalizeTimeInputValue(document.getElementById('endHour')?.value || '');
        if (startDate && endDate && startHour && endHour) {
            params.set('start', `${startDate}T${startHour}`);
            params.set('end', `${endDate}T${endHour}`);
        }
    }
    const region = document.getElementById('regionSelect')?.value;
    if (region) {
        params.set('region', region);
    }
    const activeTypes = getActiveWeatherFilters();
    if (activeTypes.length > 0 && activeTypes.length < CONFIG.WEATHER_TYPES.length) {
        params.set('types', activeTypes.join(','));
    }
    const q = params.toString();
    return q ? `playback.html?${q}` : 'playback.html';
}

function tableOfReportsHref() {
    const params = new URLSearchParams();
    const startDate = document.getElementById('startDate')?.value;
    const startHour = document.getElementById('startHour')?.value;
    const endDate = document.getElementById('endDate')?.value;
    const endHour = document.getElementById('endHour')?.value;
    if (startDate && endDate) {
        params.set('start', `${startDate}T${startHour || '0000'}`);
        params.set('end', `${endDate}T${endHour || '1200'}`);
    }
    const region = document.getElementById('regionSelect')?.value;
    if (region && CONFIG.STATES[region]) {
        params.set('region', region);
    }
    const activeTypes = Array.from(document.querySelectorAll('input[id^="hidden-filter-"]:checked'))
        .map(cb => cb.value);
    if (activeTypes.length > 0 && activeTypes.length < CONFIG.WEATHER_TYPES.length) {
        params.set('types', activeTypes.join(','));
    }
    const q = params.toString();
    return q ? `reports-table.html?${q}` : 'reports-table.html';
}

// ============================================================================
// FETCH DATA
// ============================================================================

function normalizeTimeInputValue(value) {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    // Accept both HHMM (no colon) and HH:MM (with colon)
    const match = trimmed.match(/^(\d{1,2}):?(\d{2})$/);
    if (!match) {
        return null;
    }
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
        return null;
    }
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        return null;
    }
    return `${hours.toString().padStart(2, '0')}${minutes.toString().padStart(2, '0')}`;
}

function isValid24HourTime(value) {
    return normalizeTimeInputValue(value) !== null;
}

function parseDateInputToUTC(dateStr) {
    if (typeof dateStr !== 'string') {
        return null;
    }
    const match = dateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
        return null;
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
        return null;
    }
    return new Date(Date.UTC(year, month - 1, day));
}

function formatDateInputValue(date) {
    if (!(date instanceof Date)) {
        return '';
    }
    return date.toISOString().split('T')[0];
}

function shiftCustomDateRange(days) {
    clearActiveLsrQueryRange();
    const startDateEl = document.getElementById('startDate');
    const endDateEl = document.getElementById('endDate');
    const startHourEl = document.getElementById('startHour');
    const endHourEl = document.getElementById('endHour');

    if (!startDateEl || !endDateEl || !startHourEl || !endHourEl) {
        return;
    }

    const startDate = parseDateInputToUTC(startDateEl.value);
    const endDate = parseDateInputToUTC(endDateEl.value);
    if (!startDate || !endDate) {
        showStatusToast('Please select a valid start and end date.', 'error');
        return;
    }

    const preset = document.querySelector('.btn-preset.active')?.dataset?.preset;
    const isCustomPreset = preset === 'custom';

    let normalizedStartHour;
    let normalizedEndHour;
    if (isCustomPreset) {
        normalizedStartHour = normalizeTimeInputValue(startHourEl.value);
        normalizedEndHour = normalizeTimeInputValue(endHourEl.value);
        if (!normalizedStartHour || !normalizedEndHour) {
            showStatusToast('Please enter time in 24-hour UTC format (HHMM).', 'error');
            return;
        }
    }

    startDate.setUTCDate(startDate.getUTCDate() + days);
    endDate.setUTCDate(endDate.getUTCDate() + days);

    startDateEl.value = formatDateInputValue(startDate);
    endDateEl.value = formatDateInputValue(endDate);
    if (isCustomPreset) {
        startHourEl.value = normalizedStartHour;
        endHourEl.value = normalizedEndHour;
    } else {
        startHourEl.value = '1200';
        endHourEl.value = '1200';
    }

    updateFilterSummary();
    fetchLSRData();
}

/**
 * Fit the map to {south, north, east, west}
 */
function fitMapToBounds(b, options = {}) {
    if (!map || !b) {
        return;
    }
    map.fitBounds([[b.west, b.south], [b.east, b.north]], {
        padding: 50,
        maxZoom: 10,
        duration: 600,
        ...options
    });
}

/**
 * Center the map (MapLibre zoom levels: one less than the old Leaflet levels)
 */
function setMapView(lat, lon, zoom) {
    if (!map) {
        return;
    }
    map.easeTo({ center: [lon, lat], zoom, duration: 600 });
}

function resetMapView() {
    setMapView(CONFIG.MAP_INITIAL.lat, CONFIG.MAP_INITIAL.lon, CONFIG.MAP_INITIAL.zoom);
}

function addRectOverlay(south, north, east, west, fit) {
    userArea.addRectangle(south, north, east, west);
    const bounds = { south, north, east, west };
    if (fit) {
        fitMapToBounds(bounds);
    }
    return bounds;
}

/**
 * Show boundary polygons as the selected area; returns their bounds, or null if none
 */
function addBoundaryOverlay(features, fit) {
    const bounds = boundsOfFeatures(features);
    if (!bounds) {
        return null;
    }
    userArea.addFeatures(features);
    if (fit) {
        fitMapToBounds(bounds);
    }
    return bounds;
}

/**
 * LSR lat/lon filter bounds for current location controls (uses cached GeoJSON when loaded).
 */
function getLsrFilterBoundsSync(selectedRegion, wfoCode) {
    if (boundariesReady()) {
        if (wfoCode) {
            const wfoBounds = boundsOfFeatures(getWfoBoundaryFeatures(wfoCode));
            if (wfoBounds) {
                return wfoBounds;
            }
        }
        if (selectedRegion && CONFIG.STATES[selectedRegion]) {
            const stBounds = boundsOfFeatures(getStateBoundaryFeatures(selectedRegion));
            if (stBounds) {
                return stBounds;
            }
        }
        if (selectedRegion && CONFIG.REGIONS[selectedRegion] && isNwsAdminRegionWithGeoJson(selectedRegion)) {
            const regBounds = boundsOfFeatures(getNwsAdminRegionFeatures(selectedRegion));
            if (regBounds) {
                return regBounds;
            }
        }
    }

    if (wfoCode) {
        const wfoKey = wfoCode.startsWith('K') ? wfoCode : `K${wfoCode}`;
        const coords = pnsService?.wfoCoords?.[wfoCode] || pnsService?.wfoCoords?.[wfoKey];
        if (coords) {
            const lat = coords[0];
            const lon = coords[1];
            const pad = 0.6;
            return { south: lat - pad, north: lat + pad, east: lon + pad, west: lon - pad };
        }
        const regionKey = CONFIG.WFO_REGION_MAP?.[wfoCode];
        if (regionKey && CONFIG.REGIONS[regionKey]) {
            const b = CONFIG.REGIONS[regionKey].bounds;
            return { south: b[0], north: b[1], east: b[2], west: b[3] };
        }
        return {
            south: CONFIG.DEFAULT_BOUNDS.south,
            north: CONFIG.DEFAULT_BOUNDS.north,
            east: CONFIG.DEFAULT_BOUNDS.east,
            west: CONFIG.DEFAULT_BOUNDS.west
        };
    }
    if (selectedRegion && CONFIG.STATES[selectedRegion]) {
        const b = CONFIG.STATES[selectedRegion].bounds;
        return { south: b[0], north: b[1], east: b[2], west: b[3] };
    }
    if (selectedRegion && CONFIG.REGIONS[selectedRegion]) {
        const b = CONFIG.REGIONS[selectedRegion].bounds;
        return { south: b[0], north: b[1], east: b[2], west: b[3] };
    }
    return {
        south: CONFIG.DEFAULT_BOUNDS.south,
        north: CONFIG.DEFAULT_BOUNDS.north,
        east: CONFIG.DEFAULT_BOUNDS.east,
        west: CONFIG.DEFAULT_BOUNDS.west
    };
}

/**
 * Draw GeoJSON boundary for state / NWS admin region / WFO (CWA) and return LSR filter bounds.
 * Falls back to CONFIG rectangles when GeoJSON is unavailable.
 */
async function applyLocationOverlayAndGetBounds(selectedRegion, wfoCode, options = {}) {
    const fitMap = options.fitMap !== false;
    userArea.clear();

    try {
        await loadBoundaryGeoJson();
    } catch (e) {
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            console.warn('Boundary GeoJSON load failed', e);
        }
    }

    const geoReady = boundariesReady();
    locationClipFeatures = getClipFeaturesForSelection(selectedRegion, wfoCode);

    if (wfoCode) {
        const wfoBounds = geoReady ? addBoundaryOverlay(getWfoBoundaryFeatures(wfoCode), fitMap) : null;
        if (wfoBounds) {
            return wfoBounds;
        }
        const wfoKey = wfoCode.startsWith('K') ? wfoCode : `K${wfoCode}`;
        const coords = pnsService?.wfoCoords?.[wfoCode] || pnsService?.wfoCoords?.[wfoKey];
        if (coords) {
            const lat = coords[0];
            const lon = coords[1];
            const pad = 0.6;
            return addRectOverlay(lat - pad, lat + pad, lon + pad, lon - pad, fitMap);
        }
        const regionKey = CONFIG.WFO_REGION_MAP?.[wfoCode];
        if (regionKey && CONFIG.REGIONS[regionKey]) {
            const b = CONFIG.REGIONS[regionKey].bounds;
            if (fitMap) {
                showStatusToast('CWA GeoJSON unavailable; using NWS region bounds', 'info');
            }
            return addRectOverlay(b[0], b[1], b[2], b[3], fitMap);
        }
        if (fitMap) {
            resetMapView();
        }
        return {
            south: CONFIG.DEFAULT_BOUNDS.south,
            north: CONFIG.DEFAULT_BOUNDS.north,
            east: CONFIG.DEFAULT_BOUNDS.east,
            west: CONFIG.DEFAULT_BOUNDS.west
        };
    }

    if (selectedRegion && CONFIG.STATES[selectedRegion]) {
        const stBounds = geoReady ? addBoundaryOverlay(getStateBoundaryFeatures(selectedRegion), fitMap) : null;
        if (stBounds) {
            return stBounds;
        }
        const b = CONFIG.STATES[selectedRegion].bounds;
        return addRectOverlay(b[0], b[1], b[2], b[3], fitMap);
    }

    if (selectedRegion && CONFIG.REGIONS[selectedRegion]) {
        const regBounds = geoReady && isNwsAdminRegionWithGeoJson(selectedRegion)
            ? addBoundaryOverlay(getNwsAdminRegionFeatures(selectedRegion), fitMap)
            : null;
        if (regBounds) {
            return regBounds;
        }
        const b = CONFIG.REGIONS[selectedRegion].bounds;
        return addRectOverlay(b[0], b[1], b[2], b[3], fitMap);
    }

    if (fitMap) {
        resetMapView();
    }
    return getLsrFilterBoundsSync('', '');
}

// Fetch NWS Local Storm Reports data
// options.fit: zoom the map to the loaded reports (false for automatic refreshes)
async function fetchLSRData(options = {}) {
    const fitToReports = options.fit !== false;
    // Ensure CONFIG is available
    if (typeof CONFIG === 'undefined') {
        showStatusToast('Configuration error. Please refresh the page.', 'error');
        return;
    }
    
    const fetchBtn = document.getElementById('fetchData');
    const btnText = fetchBtn?.querySelector('.btn-text');
    const btnLoading = fetchBtn?.querySelector('.btn-loading');
    
    // Check offline status
    if (!offlineDetector.checkOnline()) {
        showStatusToast('You are currently offline. Please check your internet connection.', 'error');
        return;
    }

    const startDate = document.getElementById('startDate').value;
    const startHourInput = document.getElementById('startHour');
    const startHourRaw = startHourInput ? startHourInput.value : '';
    const endDate = document.getElementById('endDate').value;
    const endHourInput = document.getElementById('endHour');
    const endHourRaw = endHourInput ? endHourInput.value : '';

    const normalizedStartHour = normalizeTimeInputValue(startHourRaw);
    const normalizedEndHour = normalizeTimeInputValue(endHourRaw);

    if (!normalizedStartHour || !normalizedEndHour) {
        clearActiveLsrQueryRange();
        updateFilterSummary();
        showStatusToast('Please enter time in 24-hour UTC format (HHMM).', 'error');
        return;
    }

    if (startHourInput) startHourInput.value = normalizedStartHour;
    if (endHourInput) endHourInput.value = normalizedEndHour;
    const startHour = normalizedStartHour;
    const endHour = normalizedEndHour;

    setActiveLsrQueryRange(startDate, startHour, endDate, endHour);
    updateFilterSummary();

    // Show loading state
    showStatusToast('Loading data...', 'loading');
    if (fetchBtn) fetchBtn.disabled = true;
    if (btnText) btnText.style.display = 'none';
    if (btnLoading) btnLoading.style.display = 'inline-flex';
    
    markersLayer.clear();

    const regionSelect = document.getElementById('regionSelect');
    const selectedRegion = regionSelect?.value || '';
    const wfoFromSelect = document.getElementById('wfoSelect')?.value || '';
    const wfoCode = wfoFromSelect || selectedWFO || '';
    const { south, north, east, west } = await applyLocationOverlayAndGetBounds(selectedRegion, wfoCode, { fitMap: fitToReports });

    // Fetch LSR data
    try {
        if (!lsrService) {
            lsrService = new LSRService(CONFIG);
        }
        
        const data = await lsrService.fetchLSRData({
            startDate,
            startHour,
            endDate,
            endHour,
            useCache: true
        });
        
        if (fetchBtn) fetchBtn.disabled = false;
        if (btnText) btnText.style.display = '';
        if (btnLoading) btnLoading.style.display = 'none';
        
        if (data && data.features) {
            displayReports(data, south, north, east, west, null, { fit: fitToReports });
            
            // Fetch PNS data if enabled, and wait for it to complete
            const lsrCount = data.features.length;
            const pnsCount = await fetchPNSDataAndGetCount();
            
            // Show combined success message after all loading is complete
            hideStatusToast();
            if (pnsCount > 0) {
                showStatusToast(`Loaded ${lsrCount} LSR reports + ${pnsCount} PNS reports`, 'success');
            } else {
                showStatusToast(`Loaded ${lsrCount} reports`, 'success');
            }
        } else {
            hideStatusToast();
            showStatusToast('No reports found for the selected criteria', 'info');
            updateReportCount(0);
            showEmptyState('No reports found for the selected criteria. Try adjusting your date range or filters.');
        }
    } catch (error) {
        if (fetchBtn) fetchBtn.disabled = false;
        if (btnText) btnText.style.display = '';
        if (btnLoading) btnLoading.style.display = 'none';
        
        hideStatusToast();
        clearActiveLsrQueryRange();
        updateFilterSummary();
        const handledError = errorHandler.handleError(error, 'Fetch LSR Data');
        const retryAction = () => fetchLSRData(options);
        showStatusToast(handledError.message, 'error', retryAction);
        updateReportCount(0);
    }
}

// ============================================================================
// REPORT DISPLAY
// ============================================================================

// State is now managed through appState module, but keeping these for backward compatibility
let allFilteredReports = [];
let lastGeoJsonData = null; // Store last fetched data for viewport refresh
let normalizedLsrReports = [];
let lastNormalizedGeoJson = null;
let lastNormalizationStats = null;
let topReportsByType = {}; // Store top 10 reports by type
let allPNSReports = []; // All PNS reports (filtered and processed for performance)
/** GeoJSON polygon features for exact location filter (state / CWA / NWS admin); null = bbox only */
let locationClipFeatures = null;

// Sync with appState
appState.set('allFilteredReports', allFilteredReports);
appState.set('lastGeoJsonData', lastGeoJsonData);
appState.set('topReportsByType', topReportsByType);

function normalizeLSRReports(geoJsonData) {
    const { normalized, stats } = normalizeLSRReportsCore(geoJsonData, REPORT_TYPE_MAP);
    lastNormalizationStats = {
        total: stats.total,
        invalidCoords: stats.invalidCoords,
        normalized: stats.normalized,
        invalidSamples: stats.invalidSamples
    };
    return normalized;
}

// options.fit: zoom the map to the displayed reports (only after a user-initiated fetch)
function displayReports(geoJsonData, south, north, east, west, activeFiltersOverride, options = {}) {
    // Ensure CONFIG is available
    if (typeof CONFIG === 'undefined' || typeof REPORT_TYPE_MAP === 'undefined') {
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            console.error('CONFIG or REPORT_TYPE_MAP not available');
        }
        return;
    }
    
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const isNewData = geoJsonData !== lastGeoJsonData;
    
    // Store for viewport refresh
    if (isNewData) {
        lastGeoJsonData = geoJsonData;
        appState.set('lastGeoJsonData', geoJsonData);
    }
    
    let normalizeDuration = 0;
    if (isNewData || lastNormalizedGeoJson !== geoJsonData || normalizedLsrReports.length === 0) {
        const normalizeStart = isLocalhost ? performance.now() : 0;
        normalizedLsrReports = normalizeLSRReports(geoJsonData);
        lastNormalizedGeoJson = geoJsonData;
        if (isLocalhost) {
            normalizeDuration = performance.now() - normalizeStart;
        }
    }
    
    const activeFilters = activeFiltersOverride || getActiveWeatherFilters();
    
    allFilteredReports = [];
    topReportsByType = {}; // Reset top reports when loading new data
    appState.set('allFilteredReports', allFilteredReports);
    appState.set('topReportsByType', topReportsByType);
    
    // Get current zoom level for performance optimization
    const currentZoom = map.getZoom();
    const zoomLimit = getZoomBasedLimit(currentZoom);
    
    // Get viewport bounds if viewport filtering is enabled
    let viewportBounds = null;
    if (CONFIG.VIEWPORT_ONLY && currentZoom >= CONFIG.MIN_ZOOM_FOR_VIEWPORT) {
        viewportBounds = map.getBounds();
    }
    
    const shouldLogMissingMarkers = isLocalhost;
    const includeAllMissing = shouldLogMissingMarkers && window.DEBUG_LSR_MISSING === true;
    const missingLogLimit = 50;
    const missingCounts = includeAllMissing ? {
        bounds: 0,
        viewport: 0,
        filter: 0
    } : null;
    const missingSamples = includeAllMissing ? {
        bounds: [],
        viewport: [],
        filter: []
    } : null;
    const formatMissingReport = (report) => ({
        type: report.filterType,
        rtype: report.rtype,
        magnitude: report.magnitude,
        location: report.location,
        time: report.time
    });
    const addMissingSample = (bucket, report) => {
        if (!shouldLogMissingMarkers || !missingSamples) {
            return;
        }
        if (missingSamples[bucket].length < missingLogLimit) {
            missingSamples[bucket].push(formatMissingReport(report));
        }
    };

    const filterStart = isLocalhost ? performance.now() : 0;
    for (const report of normalizedLsrReports) {
        // Filter by bounding box
        // Note: For US, west is more negative than east, so lon must be between west and east
        if (report.lat < south || report.lat > north || report.lon < west || report.lon > east) {
            if (missingCounts) {
                missingCounts.bounds++;
                addMissingSample('bounds', report);
            }
            continue;
        }
        if (locationClipFeatures && locationClipFeatures.length > 0) {
            if (!pointInClipFeatures(report.lat, report.lon, locationClipFeatures)) {
                if (missingCounts) {
                    missingCounts.bounds++;
                    addMissingSample('bounds', report);
                }
                continue;
            }
        }
        
        // Filter by viewport if enabled and zoomed in
        if (viewportBounds && !viewportBounds.contains([report.lon, report.lat])) {
            if (missingCounts) {
                missingCounts.viewport++;
                addMissingSample('viewport', report);
            }
            continue;
        }
        
        if (!activeFilters.includes(report.filterType)) {
            if (missingCounts) {
                missingCounts.filter++;
                addMissingSample('filter', report);
            }
            continue;
        }
        
        if (!report.icon) {
            report.icon = getIconForReportWrapper(report.iconRtype, report.iconMagnitude, report.remark, report.typetext);
        }
        
        allFilteredReports.push(report);
        
        // Track top reports by type
        if (report.magnitude > 0) {
            if (!topReportsByType[report.category]) {
                topReportsByType[report.category] = [];
            }
            topReportsByType[report.category].push(report);
            // Keep only top 10 per type
            topReportsByType[report.category].sort((a, b) => b.magnitude - a.magnitude);
            if (topReportsByType[report.category].length > 10) {
                topReportsByType[report.category] = topReportsByType[report.category].slice(0, 10);
            }
        }
    }
    const filterDuration = isLocalhost ? performance.now() - filterStart : 0;
    
    // Update appState after processing all reports
    appState.set('allFilteredReports', allFilteredReports);
    appState.set('topReportsByType', topReportsByType);
    
    // Apply zoom-based limits
    let reportsToDisplay = allFilteredReports;
    let hiddenCount = 0;
    
    if (zoomLimit !== undefined && allFilteredReports.length > zoomLimit) {
        // Sample markers if over limit (prioritize by keeping first N)
        reportsToDisplay = allFilteredReports.slice(0, zoomLimit);
        hiddenCount = allFilteredReports.length - zoomLimit;
    } else if (allFilteredReports.length > CONFIG.MAX_MARKERS) {
        // Hard limit to prevent performance issues
        reportsToDisplay = allFilteredReports.slice(0, CONFIG.MAX_MARKERS);
        hiddenCount = allFilteredReports.length - CONFIG.MAX_MARKERS;
    }
    
    if (shouldLogMissingMarkers) {
        const invalidCoords = lastNormalizationStats?.invalidCoords || 0;
        const limitedCount = allFilteredReports.length - reportsToDisplay.length;
        const missingTotal = invalidCoords + limitedCount;
        if (missingTotal > 0) {
            console.log('[LSR] Reports with marker issues:', {
                total: missingTotal,
                invalidCoords,
                limited: limitedCount
            });
            const limitedSamples = limitedCount > 0
                ? allFilteredReports.slice(reportsToDisplay.length, reportsToDisplay.length + missingLogLimit)
                    .map(formatMissingReport)
                : [];
            if (invalidCoords > 0 || limitedCount > 0) {
                console.log('[LSR] Issue samples:', {
                    invalidCoords: lastNormalizationStats?.invalidSamples || [],
                    limited: limitedSamples
                });
            }
            if (includeAllMissing && missingCounts && missingSamples) {
                const missingTotalAll = missingTotal + missingCounts.bounds + missingCounts.viewport + missingCounts.filter;
                console.log('[LSR] Full missing breakdown:', {
                    total: missingTotalAll,
                    invalidCoords,
                    outOfBounds: missingCounts.bounds,
                    outOfViewport: missingCounts.viewport,
                    filteredOut: missingCounts.filter,
                    limited: limitedCount
                });
                console.log('[LSR] Full missing samples:', {
                    outOfBounds: missingSamples.bounds,
                    outOfViewport: missingSamples.viewport,
                    filteredOut: missingSamples.filter
                });
            }
        }
    }

    updateReportCount(reportsToDisplay.length, allFilteredReports.length, hiddenCount);
    if (isLocalhost && (normalizeDuration || filterDuration)) {
        console.log(`[Perf] LSR normalize ${normalizeDuration.toFixed(1)}ms, filter ${filterDuration.toFixed(1)}ms, filtered ${allFilteredReports.length}/${normalizedLsrReports.length}`);
    }
    updateStatistics(allFilteredReports);
    updateFeatureBadges(); // Update feature discoverability badges
    updateFilterSummary();
    updateExportCount(); // Update export count in modal
    
    // Draw markers (one WebGL symbol layer; no DOM elements per report)
    markersLayer.setReports(reportsToDisplay);
    
    if (options.fit && reportsToDisplay.length > 0) {
        fitMapToBounds(markersLayer.getBounds());
    }
}

/**
 * Get marker limit based on current zoom level
 */
function getZoomBasedLimit(zoom) {
    // MapLibre zoom is fractional; limits are keyed by whole levels
    const level = Math.floor(zoom);
    if (CONFIG.ZOOM_BASED_LIMITS[level] !== undefined) {
        return CONFIG.ZOOM_BASED_LIMITS[level];
    }
    
    // Find closest lower zoom level limit
    for (let z = level - 1; z >= 0; z--) {
        if (CONFIG.ZOOM_BASED_LIMITS[z] !== undefined) {
            return CONFIG.ZOOM_BASED_LIMITS[z];
        }
    }
    
    // No limit for high zoom levels (uses MAX_MARKERS instead)
    return undefined;
}

// ============================================================================
// WARNINGS DATA FETCHING
// ============================================================================

function getAlertCodes(props) {
    const phSig = (props.ph_sig || '').split('.');
    const phenomena = (props.phenomena || phSig[0] || '').toUpperCase();
    const significance = (props.significance || phSig[1] || '').toUpperCase();
    return { phenomena, significance };
}

function updateWarningsCount(elementId, count, show) {
    const el = document.getElementById(elementId);
    if (!el) {
        return;
    }
    el.textContent = count.toString();
    el.style.display = show ? 'inline' : 'none';
}

function renderAlertsToLayer(alerts, layer) {
    if (!layer) {
        return;
    }
    const mapAlerts = [];
    alerts.forEach(alert => {
        const props = alert.properties || {};
        const significanceMap = {
            'W': 'Warning',
            'A': 'Watch',
            'Y': 'Advisory'
        };
        const severity = props.severity || (props.significance ? (significanceMap[props.significance] || props.significance) : 'Unknown');
        const category = props.category || props.phenomena || 'Other';
        const event = props.event || props.event_label || 'Alert';
        const headline = props.headline || props.event_label || '';
        const description = props.description || '';
        const instruction = props.instruction || '';
        const effectiveRaw = props.effective || props.utc_issue || props.utc_product_issue || '';
        const expiresRaw = props.expires || props.utc_expire || '';
        const effective = effectiveRaw ? new Date(effectiveRaw).toLocaleString() : '';
        const expires = expiresRaw ? new Date(expiresRaw).toLocaleString() : '';
        const areaDesc = props.areaDesc || props.ugc || '';
        const wfo = props.wfo || '';
        
        const color = props.nws_color || warningsService.getSeverityColor(severity);
        const icon = warningsService.getCategoryIcon(category);
        
        // Create popup content
        const popupContent = `
            <div class="warning-popup">
                <div class="warning-header" style="border-left: 4px solid ${color};">
                    <div class="warning-title">
                        <span class="warning-icon">${icon}</span>
                        <strong>${event}</strong>
                    </div>
                    <div class="warning-severity" style="color: ${color};">
                        ${severity} - ${category}
                    </div>
                </div>
                <div class="warning-body">
                    ${headline ? `<div class="warning-headline"><strong>${headline}</strong></div>` : ''}
                    ${areaDesc ? `<div class="warning-area"><i class="fas fa-map-marker-alt"></i> ${areaDesc}</div>` : ''}
                    ${wfo ? `<div class="warning-area"><i class="fas fa-broadcast-tower"></i> WFO: ${wfo}</div>` : ''}
                    ${effective ? `<div class="warning-time"><i class="fas fa-clock"></i> Effective: ${effective}</div>` : ''}
                    ${expires ? `<div class="warning-time"><i class="fas fa-hourglass-end"></i> Expires: ${expires}</div>` : ''}
                    ${description ? `<div class="warning-description">${description}</div>` : ''}
                    ${instruction ? `<div class="warning-instruction"><strong>Instructions:</strong> ${instruction}</div>` : ''}
                </div>
            </div>
        `;
        
        if (!alert.geometry) return;
        mapAlerts.push({ geometry: alert.geometry, color, emoji: icon, popupHtml: popupContent });
    });
    layer.setAlerts(mapAlerts);
}

function updateWarningsRefreshListeners() {
    if (!map) {
        return;
    }
    const shouldAttach = showWarnings || showAllWarningsLayer || showAllWatchesLayer;
    if (shouldAttach && !warningsListenersAttached) {
        map.on('moveend', refreshWarningsOnMove);
        map.on('zoomend', refreshWarningsOnMove);
        warningsListenersAttached = true;
    } else if (!shouldAttach && warningsListenersAttached) {
        map.off('moveend', refreshWarningsOnMove);
        map.off('zoomend', refreshWarningsOnMove);
        warningsListenersAttached = false;
    }
}

function showWarningsLoadingToast() {
    const now = Date.now();
    if (now - lastWarningsToastTime < 15000) {
        return;
    }
    const parts = [];
    if (showWarnings) parts.push('short-fuse warnings');
    if (showAllWarningsLayer) parts.push('all warnings');
    if (showAllWatchesLayer) parts.push('watches');
    if (parts.length === 0) {
        return;
    }
    lastWarningsToastTime = now;
    const label = parts.length > 1 ? parts.join(', ') : parts[0];
    showStatusToast(`Loading ${label}...`, 'loading');
}

/** Hide the "Loading ... warnings" toast once warnings have loaded (if it is still showing) */
function hideWarningsLoadingToast() {
    const message = document.getElementById('statusToastMessage')?.textContent || '';
    if (message.startsWith('Loading') && /warnings|watches/.test(message)) {
        hideStatusToast();
    }
}

function getWfoDisplayName(code) {
    if (!code) {
        return '';
    }
    const shortCode = code.startsWith('K') ? code.slice(1) : code;
    return (CONFIG.WFO_NAMES && CONFIG.WFO_NAMES[shortCode]) ? CONFIG.WFO_NAMES[shortCode] : code;
}

function getNwsRegionKeyForCoord(lat, lon) {
    const keys = CONFIG.NWS_ADMIN_REGION_KEYS || [];
    for (const key of keys) {
        const region = CONFIG.REGIONS[key];
        if (!region || !region.bounds) {
            continue;
        }
        const [south, north, east, west] = region.bounds;
        if (lat >= south && lat <= north && lon >= west && lon <= east) {
            return key;
        }
    }
    return null;
}

function buildWfoSelectOptions() {
    const wfoSelect = document.getElementById('wfoSelect');
    if (!wfoSelect || !CONFIG.WFO_NAMES) {
        return;
    }

    wfoSelect.innerHTML = '<option value="">Select WFO...</option>';
    const regionKeys = CONFIG.NWS_ADMIN_REGION_KEYS || [];
    const regionGroups = {};
    const unassigned = [];

    Object.keys(CONFIG.WFO_NAMES).forEach((code) => {
        const regionKey = CONFIG.WFO_REGION_MAP?.[code];
        if (!regionKey) {
            unassigned.push(code);
            return;
        }
        if (!regionGroups[regionKey]) {
            regionGroups[regionKey] = [];
        }
        regionGroups[regionKey].push(code);
    });

    regionKeys.forEach((regionKey) => {
        const offices = regionGroups[regionKey];
        if (!offices || offices.length === 0) {
            return;
        }
        offices.sort();
        const optgroup = document.createElement('optgroup');
        optgroup.label = CONFIG.REGIONS[regionKey]?.name || regionKey;
        offices.forEach(code => {
            const option = document.createElement('option');
            option.value = code;
            option.textContent = getWfoDisplayName(code);
            option.title = code;
            optgroup.appendChild(option);
        });
        wfoSelect.appendChild(optgroup);
    });

    if (unassigned.length > 0) {
        unassigned.sort();
        const optgroup = document.createElement('optgroup');
        optgroup.label = 'Unassigned';
        unassigned.forEach(code => {
            const option = document.createElement('option');
            option.value = code;
            option.textContent = getWfoDisplayName(code);
            option.title = code;
            optgroup.appendChild(option);
        });
        wfoSelect.appendChild(optgroup);
    }
}

/**
 * Fetch active NWS warnings/alerts and display on map
 */
async function fetchWarnings() {
    if ((!showWarnings && !showAllWarningsLayer && !showAllWatchesLayer) || !warningsService || !map || !warningsLayer) {
        return;
    }
    
    try {
        showWarningsLoadingToast();
        const bounds = map.getBounds();
        const alerts = await warningsService.fetchActiveWarnings({
            north: bounds.getNorth(),
            south: bounds.getSouth(),
            east: bounds.getEast(),
            west: bounds.getWest()
        });
        
        const shortFusePhenomena = ['TO', 'SV', 'FF', 'SQ'];
        const shortFuseAlerts = [];
        const allWarnings = [];
        const allWatches = [];

        alerts.forEach(alert => {
            const props = alert.properties || {};
            const { phenomena, significance } = getAlertCodes(props);
            if (significance === 'W') {
                allWarnings.push(alert);
                if (shortFusePhenomena.includes(phenomena)) {
                    shortFuseAlerts.push(alert);
                }
            } else if (significance === 'A') {
                allWatches.push(alert);
            }
        });

        // Clear existing warnings
        warningsLayer.clear();
        if (allWarningsLayer) allWarningsLayer.clear();
        if (allWatchesLayer) allWatchesLayer.clear();
        
        hideWarningsLoadingToast();
        if (alerts.length === 0) {
            updateWarningsCount('warningsCount', 0, showWarnings);
            updateWarningsCount('allWarningsCount', 0, showAllWarningsLayer);
            updateWarningsCount('allWatchesCount', 0, showAllWatchesLayer);
            return; // No active warnings
        }

        if (showWarnings) {
            renderAlertsToLayer(shortFuseAlerts, warningsLayer);
        }
        if (showAllWarningsLayer) {
            renderAlertsToLayer(allWarnings, allWarningsLayer);
        }
        if (showAllWatchesLayer) {
            renderAlertsToLayer(allWatches, allWatchesLayer);
        }

        updateWarningsCount('warningsCount', shortFuseAlerts.length, showWarnings);
        updateWarningsCount('allWarningsCount', allWarnings.length, showAllWarningsLayer);
        updateWarningsCount('allWatchesCount', allWatches.length, showAllWatchesLayer);
        
        // Update warnings count if element exists
        const warningsCountEl = document.getElementById('warningsCount');
        if (warningsCountEl) {
            warningsCountEl.textContent = alerts.length;
            warningsCountEl.style.display = alerts.length > 0 ? 'inline' : 'inline';
        }
        
    } catch (error) {
        hideWarningsLoadingToast();
        errorHandler.handleError(error, 'Fetch Warnings');
    }
}

// ============================================================================
// PNS DATA FETCHING
// ============================================================================

/**
 * Fetch Public Information Statements from NWS
 * Displays PNS at the issuing WFO office location with a formatted popup
 */
// Fetch PNS data using the service
// @param {boolean} silent - If true, don't show toast notifications (for coordinated loading)
// @returns {number} - Number of PNS reports loaded
async function fetchPNSData(silent = false) {
    if (!pnsService) {
        pnsService = new PNSService();
    }

    // Clear previous PNS reports
    allPNSReports = [];

    if (!showPNS) {
        // If PNS is disabled, clear layer and update counts
        if (pnsLayer) {
            pnsLayer.clear();
        }
        updateReportCountWithPNS();
        updateStatisticsWithPNS();
        return 0;
    }
    
    // Show loading indicator only if not silent
    if (!silent) {
        showStatusToast('Processing PNS reports...', 'loading');
    }
    
    try {
        // Collect PNS marker data (without adding to layer yet)
        const pnsMarkerData = [];
        
        await pnsService.fetchPNSData(
            showPNS, 
            null, // Don't pass pnsLayer - we'll handle adding markers in filterPNSMarkers
            openPnsModal,
            getIconForReportWrapper,
            getReportTypeName,
            REPORT_TYPE_MAP,
            (markerData) => {
                // Callback to collect marker data instead of adding directly
                pnsMarkerData.push(markerData);
            },
            updateMagnitudeLegendForReport
        );
        
        // Store all PNS marker data for performance optimization
        allPNSReports = pnsMarkerData;
        
        // After fetching, apply current filters and performance optimizations to PNS markers
        filterPNSMarkers();
        
        // Show success message with count only if not silent
        const pnsCount = pnsMarkerData.length;
        if (!silent) {
            if (pnsCount > 0) {
                showStatusToast(`Loaded ${pnsCount} PNS report${pnsCount !== 1 ? 's' : ''}`, 'success');
            } else {
                showStatusToast('No PNS reports found', 'info');
            }
        }
        
        return pnsCount;
    } catch (error) {
        // Error handling - show error message only if not silent
        if (!silent) {
            const handledError = errorHandler.handleError(error, 'PNS Fetch');
            showStatusToast(handledError.message, 'error');
        } else {
            errorHandler.log('PNS fetch failed during coordinated loading', error);
        }
        return 0;
    }
}

/**
 * Fetch PNS data in silent mode (for coordinated loading with LSR data)
 * @returns {number} - Number of PNS reports loaded
 */
async function fetchPNSDataAndGetCount() {
    return fetchPNSData(true);
}

/**
 * Collect PNS reports from visible markers for statistics and counting
 */
function getPNSReports(activeFiltersOverride) {
    if (!filterService) {
        return [];
    }
    return filterService.getFilteredPNSReports(
        showPNS,
        allPNSReports,
        allFilteredReports,
        map,
        CONFIG,
        getZoomBasedLimit,
        activeFiltersOverride
    );
}

/**
 * Apply performance optimizations and filter PNS markers
 */
function filterPNSMarkers(activeFiltersOverride) {
    if (!filterService) {
        return;
    }
    
    filterService.filterPNSMarkers(
        pnsLayer,
        showPNS,
        allPNSReports,
        allFilteredReports,
        map,
        CONFIG,
        getZoomBasedLimit,
        updateReportCountWithPNS,
        updateStatisticsWithPNS,
        activeFiltersOverride
    );
}

/**
 * Update report count including PNS reports
 */
function updateReportCountWithPNS() {
    // Get filtered PNS reports (before limits) for total count
    const currentZoom = map ? map.getZoom() : 4;
    const zoomLimit = getZoomBasedLimit(currentZoom);
    const viewportBounds = CONFIG.VIEWPORT_ONLY && currentZoom >= CONFIG.MIN_ZOOM_FOR_VIEWPORT 
        ? map.getBounds() 
        : null;
    
    // Get active filters
    const activeFilters = getActiveWeatherFilters();
    const allWeatherTypes = CONFIG.WEATHER_TYPES || [];
    const allFiltersActive = activeFilters.length === allWeatherTypes.length;
    const noFiltersActive = activeFilters.length === 0;
    
    // Filter PNS reports by active filters and viewport (before limits) - for total count
    let totalPNSReports = 0;
    if (showPNS && allPNSReports) {
        totalPNSReports = allPNSReports.filter(report => {
            // If no filters are active, hide all reports
            if (noFiltersActive) {
                return false;
            }
            
            // If all filters are active, show all reports (skip type filtering)
            // Otherwise, filter by weather type
            if (!allFiltersActive) {
                if (!report.filterType || !activeFilters.includes(report.filterType)) {
                    return false;
                }
            }
            
            // Filter by viewport if enabled
            if (viewportBounds && !viewportBounds.contains([report.lon, report.lat])) {
                return false;
            }
            
            return true;
        }).length;
    }
    
    // Get displayed PNS reports (after limits)
    const displayedPNSReports = getPNSReports(activeFilters);
    
    // Calculate totals
    const totalReports = allFilteredReports.length + totalPNSReports;
    
    // Calculate LSR displayed/hidden
    let displayedLSRCount = allFilteredReports.length;
    let hiddenLSRCount = 0;
    
    if (zoomLimit !== undefined && displayedLSRCount > zoomLimit) {
        hiddenLSRCount = displayedLSRCount - zoomLimit;
        displayedLSRCount = zoomLimit;
    } else if (displayedLSRCount > CONFIG.MAX_MARKERS) {
        hiddenLSRCount = displayedLSRCount - CONFIG.MAX_MARKERS;
        displayedLSRCount = CONFIG.MAX_MARKERS;
    }
    
    // Calculate total displayed and hidden (LSR + PNS)
    const displayedCount = displayedLSRCount + displayedPNSReports.length;
    const hiddenPNSCount = totalPNSReports - displayedPNSReports.length;
    const hiddenCount = hiddenLSRCount + hiddenPNSCount;
    
    updateReportCount(displayedCount, totalReports, hiddenCount);
}

/**
 * Update statistics including PNS reports
 */
function updateStatisticsWithPNS() {
    const pnsReports = getPNSReports();
    const allReports = [...allFilteredReports, ...pnsReports];
    
    updateStatistics(allReports);
}

// parsePNSMetadata is now in PNSService - removed from app.js

// Show empty state with message
function showEmptyState(message) {
    const emptyState = document.getElementById('emptyState');
    const emptyStateMessage = document.querySelector('.empty-state-message');
    if (emptyState) {
        if (emptyStateMessage && message) {
            emptyStateMessage.textContent = message;
        }
        emptyState.style.display = 'flex';
    }
}

// Helper function to escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Helper function to get relative time
function getTimeAgo(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    
    if (diffMins < 60) {
        return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
    } else if (diffHours < 24) {
        return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    } else {
        const diffDays = Math.floor(diffHours / 24);
        return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
    }
}

// Open PNS modal with statement content
function openPnsModal(pnsData) {
    const modal = document.getElementById('pnsModal');
    const officeEl = document.getElementById('pnsModalOffice');
    const timeEl = document.getElementById('pnsModalTime');
    const textEl = document.getElementById('pnsModalText');
    const linkEl = document.getElementById('pnsModalLink');
    
    if (!modal) return;
    
    // Populate modal content
    if (officeEl) officeEl.textContent = pnsData.office;
    if (timeEl) timeEl.innerHTML = `<i class="far fa-clock"></i> ${getTimeAgo(pnsData.time)} &nbsp;•&nbsp; ${pnsData.time.toLocaleString()}`;
    if (textEl) textEl.textContent = pnsData.text;
    if (linkEl) linkEl.href = `https://api.weather.gov/products/${pnsData.productId}`;
    
    // Show modal
    modal.classList.add('show');
}

// Global function to open PNS modal from popup button (called from popup HTML)
window.openPnsModalFromMarker = function(productId) {
    // Find the PNS report with this product ID
    const found = allPNSReports.find(r => r.pnsData && r.pnsData.productId === productId);
    const foundPnsData = found ? found.pnsData : null;
    
    if (foundPnsData) {
        openPnsModal(foundPnsData);
    }
};

function updateReportCount(count, totalCount = null, hiddenCount = 0) {
    if (!reportCountService) {
        return;
    }
    
    reportCountService.updateReportCount(
        count,
        totalCount,
        hiddenCount,
        getZoomBasedLimit,
        map,
        CONFIG
    );
}

// Update feature badges for discoverability
function updateFeatureBadges() {
    // Show badge on Top Reports button when data is available
    const showTopReportsBtn = document.getElementById('showTopReports');
    const topReportsBadge = showTopReportsBtn?.querySelector('.feature-badge');
    
    if (Object.keys(topReportsByType).length > 0) {
        if (showTopReportsBtn) {
            showTopReportsBtn.style.display = 'block';
            if (!topReportsBadge) {
                const badge = document.createElement('span');
                badge.className = 'feature-badge';
                badge.textContent = 'New';
                showTopReportsBtn.appendChild(badge);
                setTimeout(() => {
                    if (badge.parentNode) badge.remove();
                }, 10000); // Remove badge after 10 seconds
            }
        }
    }
    
    // Show badge on Data Insights panel when it appears
    const dataInsightsPanel = document.getElementById('dataInsightsPanel');
    if (dataInsightsPanel && allFilteredReports.length > 0) {
        dataInsightsPanel.style.display = 'block';
    }
}

// ============================================================================
// STATISTICS
// ============================================================================

function updateStatistics(reports) {
    if (!statisticsService) {
        return;
    }
    
    statisticsService.updateStatistics(reports, topReportsByType);
}

// ============================================================================
// TOP 10 REPORTS
// ============================================================================

function displayTopReports() {
    if (!statisticsService) {
        return;
    }
    
    statisticsService.displayTopReports(topReportsByType);
}

function clearMap() {
    markersLayer.clear();
    userArea.clear();
    allFilteredReports = [];
    topReportsByType = {};
    updateReportCount(0);
    updateStatistics([]);
    showStatusToast('Map cleared', 'info');
    updateFilterSummary();
}

// Reset map to default US view
function resetView() {
    if (!map) {
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            console.warn('Map not initialized');
        }
        showStatusToast('Map not ready', 'error');
        return;
    }
    
    resetMapView();
    showStatusToast('Map reset to default view', 'success');
}

// Center map on user's location
function centerOnMyLocation() {
    if (!map) {
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            console.warn('Map not initialized');
        }
        showStatusToast('Map not ready', 'error');
        return;
    }
    
    if (!navigator.geolocation) {
        showStatusToast('Geolocation is not supported by your browser', 'error');
        return;
    }
    
    showStatusToast('Locating...', 'loading');
    
    navigator.geolocation.getCurrentPosition(
        (position) => {
            const { latitude, longitude } = position.coords;
            setMapView(latitude, longitude, 9);
            showStatusToast('Map centered on your location', 'success');
        },
        (error) => {
            let message = 'Unable to get your location';
            if (error.code === error.PERMISSION_DENIED) {
                message = 'Location permission denied. Please enable location access.';
            } else if (error.code === error.POSITION_UNAVAILABLE) {
                message = 'Location information unavailable';
            } else if (error.code === error.TIMEOUT) {
                message = 'Location request timed out';
            }
            showStatusToast(message, 'error');
        },
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
        }
    );
}

// ============================================================================
// DATE HELPERS
// ============================================================================

function getUtcDateString(date) {
    return date.toISOString().split('T')[0];
}

function getUtcTimeString(date) {
    return date.toISOString().slice(11, 16).replace(':', '');
}

function refreshWarningsOnMove() {
    if (showWarnings || showAllWarningsLayer || showAllWatchesLayer) {
        fetchWarnings();
    }
}

// ============================================================================
// AUTO REFRESH
// ============================================================================

let autoRefreshInterval = null;

function toggleAutoRefresh() {
    const btn = document.getElementById('autoRefresh');
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
        btn.classList.remove('active');
        btn.innerHTML = '<i class="fas fa-sync-alt"></i> Auto Refresh';
    } else {
        autoRefreshInterval = setInterval(() => fetchLSRData({ fit: false }), CONFIG.AUTO_REFRESH_INTERVAL);
        btn.classList.add('active');
        btn.innerHTML = '<i class="fas fa-sync-alt"></i> Auto Refresh ON';
        fetchLSRData();
    }
}

// ============================================================================
// DATE PRESETS
// ============================================================================

function setDatePreset(preset) {
    clearActiveLsrQueryRange();
    const today = new Date();
    const startDateEl = document.getElementById('startDate');
    const startHourEl = document.getElementById('startHour');
    const endDateEl = document.getElementById('endDate');
    const endHourEl = document.getElementById('endHour');
    const customDateFields = document.getElementById('customDateFields');
    const actionButtons = document.getElementById('actionButtons');

    endDateEl.value = getUtcDateString(today);
    endHourEl.value = '1200';

    switch(preset) {
        case 'day12z': {
            const y = new Date(today);
            y.setUTCDate(y.getUTCDate() - 1);
            startDateEl.value = getUtcDateString(y);
            startHourEl.value = '1200';
            endDateEl.value = today.toISOString().split('T')[0];
            endHourEl.value = '1200';
            customDateFields.style.display = 'block';
            actionButtons.style.display = 'none';
            setTimeout(() => {
                fetchLSRData();
                updateFilterSummary();
            }, 100);
            break;
        }
        case 'day12zNext': {
            // Next meteorological day: today 12Z → tomorrow 12Z (same convention as −1 Day)
            startDateEl.value = today.toISOString().split('T')[0];
            startHourEl.value = '1200';
            const tomorrow = new Date(today);
            tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
            endDateEl.value = getUtcDateString(tomorrow);
            endHourEl.value = '1200';
            customDateFields.style.display = 'block';
            actionButtons.style.display = 'none';
            setTimeout(() => {
                fetchLSRData();
                updateFilterSummary();
            }, 100);
            break;
        }
        case '6h': {
            const start6h = new Date(today.getTime() - 6 * 60 * 60 * 1000);
            startDateEl.value = getUtcDateString(start6h);
            startHourEl.value = getUtcTimeString(start6h);
            endDateEl.value = getUtcDateString(today);
            endHourEl.value = getUtcTimeString(today);
            customDateFields.style.display = 'none';
            actionButtons.style.display = 'none';
            setTimeout(() => {
                fetchLSRData();
                updateFilterSummary();
            }, 100);
            break;
        }
        case '12h': {
            const start12h = new Date(today.getTime() - 12 * 60 * 60 * 1000);
            startDateEl.value = getUtcDateString(start12h);
            startHourEl.value = getUtcTimeString(start12h);
            endDateEl.value = getUtcDateString(today);
            endHourEl.value = getUtcTimeString(today);
            customDateFields.style.display = 'none';
            actionButtons.style.display = 'none';
            setTimeout(() => {
                fetchLSRData();
                updateFilterSummary();
            }, 100);
            break;
        }
        case '24h': {
            const start24h = new Date(today.getTime() - 24 * 60 * 60 * 1000);
            startDateEl.value = getUtcDateString(start24h);
            startHourEl.value = getUtcTimeString(start24h);
            endDateEl.value = getUtcDateString(today);
            endHourEl.value = getUtcTimeString(today);
            customDateFields.style.display = 'none';
            actionButtons.style.display = 'none';
            // Auto-load data
            setTimeout(() => {
                fetchLSRData();
                updateFilterSummary();
            }, 100);
            break;
        }
        case '48h': {
            const start48h = new Date(today.getTime() - 48 * 60 * 60 * 1000);
            startDateEl.value = getUtcDateString(start48h);
            startHourEl.value = getUtcTimeString(start48h);
            endDateEl.value = getUtcDateString(today);
            endHourEl.value = getUtcTimeString(today);
            customDateFields.style.display = 'none';
            actionButtons.style.display = 'none';
            // Auto-load data
            setTimeout(() => {
                fetchLSRData();
                updateFilterSummary();
            }, 100);
            break;
        }
        case 'week': {
            const lastWeek = new Date(today);
            lastWeek.setDate(lastWeek.getDate() - 7);
            startDateEl.value = lastWeek.toISOString().split('T')[0];
            startHourEl.value = '0000';
            endDateEl.value = getUtcDateString(today);
            endHourEl.value = getUtcTimeString(today);
            customDateFields.style.display = 'none';
            actionButtons.style.display = 'none';
            // Auto-load data
            setTimeout(() => {
                fetchLSRData();
                updateFilterSummary();
            }, 100);
            break;
        }
        case 'custom':
            // Show custom date fields and action buttons
            customDateFields.style.display = 'block';
            actionButtons.style.display = 'block';
            break;
    }

    // Update active preset button (duplicate controls may share the same data-preset)
    document.querySelectorAll('.btn-preset').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelectorAll(`.btn-preset[data-preset="${preset}"]`).forEach(btn => {
        btn.classList.add('active');
    });
}

// ============================================================================
// WEATHER TYPE TOGGLE
// ============================================================================

function toggleAllWeatherTypes(selectAll) {
    const chips = document.querySelectorAll('.weather-chip');
    const hiddenCheckboxes = document.querySelectorAll('input[id^="hidden-filter-"]');
    
    chips.forEach(chip => {
        if (selectAll) {
            chip.classList.add('active');
        } else {
            chip.classList.remove('active');
        }
    });
    
    hiddenCheckboxes.forEach(cb => {
        cb.checked = selectAll;
    });
    
    updateFilterSummary();
    // Note: refreshMapWithCurrentFilters() is called from the button click handler
}

// ============================================================================
// MAP CLICK TO SET BOUNDS
// ============================================================================

let boundsClickMode = false;
let boundsCorners = [];

function enableBoundsClickMode() {
    boundsClickMode = true;
    boundsCorners = [];
    map.getCanvas().style.cursor = 'crosshair';
    
    // Show instruction
    showStatusToast('Click two corners on the map to set bounds', 'info');
}

function disableBoundsClickMode() {
    boundsClickMode = false;
    map.getCanvas().style.cursor = '';
}

function handleMapClick(e) {
    if (!boundsClickMode) return;
    
    boundsCorners.push([e.lngLat.lat, e.lngLat.lng]);
    
    if (boundsCorners.length === 1) {
        // First click - show marker
        userArea.clear();
        userArea.addPoint(e.lngLat.lat, e.lngLat.lng);
    } else if (boundsCorners.length >= 2) {
        // Second click - set custom bounds
        const lat1 = boundsCorners[0][0];
        const lon1 = boundsCorners[0][1];
        const lat2 = boundsCorners[1][0];
        const lon2 = boundsCorners[1][1];
        
        const south = Math.min(lat1, lat2);
        const north = Math.max(lat1, lat2);
        const west = Math.min(lon1, lon2);
        const east = Math.max(lon1, lon2);
        
        // Draw rectangle
        userArea.clear();
        addRectOverlay(south, north, east, west, true);
        
        disableBoundsClickMode();
        
        showStatusToast('Custom area selected. Select a state/region from dropdown to filter data.', 'info');
    }
}

function clearBounds() {
    const regionSelect = document.getElementById('regionSelect');
    if (regionSelect) {
        regionSelect.value = '';
    }
    const wfoSelect = document.getElementById('wfoSelect');
    if (wfoSelect) {
        wfoSelect.value = '';
    }
    selectedWFO = null;
    locationClipFeatures = null;
    userArea.clear();
    disableBoundsClickMode();
    
    // Reset map to default view
    resetMapView();
}

// ============================================================================
// UI INITIALIZATION
// ============================================================================

// Refresh map with current filters (called when weather type filters change)
// Defined before initializeUI so it's accessible when chip listeners are set up
function refreshMapWithCurrentFilters() {
    // Use a small timeout to ensure checkbox state is updated
    setTimeout(() => {
        const activeFilters = getActiveWeatherFilters();
        if (lastGeoJsonData) {
            const regionSelect = document.getElementById('regionSelect');
            const selectedRegion = regionSelect ? regionSelect.value : '';
            const wfoSel = document.getElementById('wfoSelect')?.value || '';
            const wfoCode = wfoSel || selectedWFO || '';
            const { south: southLat, north: northLat, east: eastLon, west: westLon } =
                getLsrFilterBoundsSync(selectedRegion, wfoCode);
            displayReports(lastGeoJsonData, southLat, northLat, eastLon, westLon, activeFilters);
        }
        
        // Also filter PNS markers (this updates counts and statistics)
        filterPNSMarkers(activeFilters);
    }, 10);
}

// ============================================================================
// MAGNITUDE LEGEND
// ============================================================================

function formatMagnitudeValue(value) {
    if (!Number.isFinite(value)) {
        return '';
    }
    const rounded = Math.round(value * 100) / 100;
    return Number.isInteger(rounded) ? `${rounded}` : `${rounded}`;
}

function formatMagnitudeRangeLabel(prevMax, max, unit) {
    const unitLabel = unit || '';
    if (max === Infinity) {
        return `> ${formatMagnitudeValue(prevMax)}${unitLabel}`;
    }
    if (prevMax === null) {
        return `\u2264 ${formatMagnitudeValue(max)}${unitLabel}`;
    }
    return `${formatMagnitudeValue(prevMax)}\u2013${formatMagnitudeValue(max)}${unitLabel}`;
}

function updateMagnitudeLegendForReport(report) {
    const legendBody = document.getElementById('magnitudeLegend');
    const legendTitle = document.getElementById('magnitudeLegendTitle');
    if (!legendBody) {
        return;
    }

    const rtype = report?.iconRtype || report?.rtype || '';
    const category = report?.category || getReportTypeName(rtype, REPORT_TYPE_MAP);
    const config = ICON_CONFIG[rtype];

    if (legendTitle) {
        legendTitle.textContent = category ? `Magnitude Scale - ${category}` : 'Magnitude Scale';
    }

    if (!config || !config.thresholds) {
        legendBody.innerHTML = `<div class="legend-magnitude-note">No magnitude scale available for this report type.</div>`;
        return;
    }

    const unit = getUnitForReportType(rtype);
    const borderRadius = config.type === 'rect' ? '0%' : '50%';
    let prevMax = null;

    const itemsHtml = config.thresholds.map((threshold) => {
        const label = formatMagnitudeRangeLabel(prevMax, threshold.max, unit);
        prevMax = threshold.max;
        const swatchBorder = threshold.stroke || '#333';
        return `
            <div class="legend-magnitude-item">
                <div class="legend-magnitude-swatch" style="background-color: ${threshold.fill}; border-color: ${swatchBorder}; border-radius: ${borderRadius};"></div>
                <div class="legend-magnitude-label">${label}</div>
            </div>
        `;
    }).join('');

    legendBody.innerHTML = itemsHtml;
}

function initializeUI() {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    // Default custom range: prior UTC day 12Z → today 12Z (matches "−1 Day" preset)
    document.getElementById('startDate').value = yesterday.toISOString().split('T')[0];
    document.getElementById('startHour').value = '1200';
    document.getElementById('endDate').value = today.toISOString().split('T')[0];
    document.getElementById('endHour').value = '1200';
    
    const startHourInput = document.getElementById('startHour');
    const endHourInput = document.getElementById('endHour');
    [startHourInput, endHourInput].forEach(input => {
        if (!input) {
            return;
        }
        input.addEventListener('blur', () => {
            const normalized = normalizeTimeInputValue(input.value);
            if (normalized) {
                input.value = normalized;
            }
            clearActiveLsrQueryRange();
            updateFilterSummary();
        });
        input.addEventListener('input', () => {
            clearActiveLsrQueryRange();
            updateFilterSummary();
        });
    });

    const startDateInput = document.getElementById('startDate');
    const endDateInput = document.getElementById('endDate');
    [startDateInput, endDateInput].forEach(input => {
        if (!input) {
            return;
        }
        input.addEventListener('change', () => {
            clearActiveLsrQueryRange();
            updateFilterSummary();
        });
    });
    
    const filterContainer = document.getElementById('weatherTypeFilters');
    const typeIcons = {
        'Rain': 'fa-cloud-rain',
        'Flood': 'fa-water',
        'Coastal Flooding': 'fa-water',
        'Snow': 'fa-snowflake',
        'Snow Squall': 'fa-snowflake',
        'Sleet': 'fa-circle',
        'Freezing Rain': 'fa-cloud-rain',
        'Ice': 'fa-icicles',
        'Hail': 'fa-circle',
        'Wind': 'fa-wind',
        'Thunderstorm': 'fa-bolt',
        'Tornado': 'fa-tornado',
        'Funnel Cloud': 'fa-tornado',
        'Waterspout': 'fa-tornado',
        'Tropical': 'fa-hurricane',
        'Temperature': 'fa-thermometer-half',
        'Fog': 'fa-smog',
        'Wildfire': 'fa-fire',
        'Other': 'fa-cloud'
    };
    
    CONFIG.WEATHER_TYPES.forEach(type => {
        const typeId = getWeatherTypeId(type);
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'weather-chip active';
        chip.id = `filter-${typeId}`;
        chip.dataset.type = type;
        chip.innerHTML = `
            <i class="fas ${typeIcons[type] || 'fa-cloud'}"></i>
            <span>${type}</span>
        `;
        chip.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent event bubbling
            chip.classList.toggle('active');
            // Update hidden checkbox for compatibility
            const hiddenCheckbox = document.getElementById(`hidden-filter-${typeId}`);
            if (hiddenCheckbox) {
                hiddenCheckbox.checked = chip.classList.contains('active');
            }
            // Update filter summary
            updateFilterSummary();
            // Always refresh map if data is loaded (will filter based on current checkbox states)
            refreshMapWithCurrentFilters();
        });
        filterContainer.appendChild(chip);
        
        // Create hidden checkbox for compatibility with existing code
        const hiddenCheckbox = document.createElement('input');
        hiddenCheckbox.type = 'checkbox';
        hiddenCheckbox.id = `hidden-filter-${typeId}`;
        hiddenCheckbox.value = type;
        hiddenCheckbox.checked = true;
        hiddenCheckbox.style.display = 'none';
        document.body.appendChild(hiddenCheckbox);
    });
    
    
    // Check for URL parameters on load (before setting default preset)
    const hasURLParams = window.location.search.length > 0;
    if (hasURLParams) {
        loadStateFromURL();
    } else {
        // Default: meteorological day 12Z–12Z UTC (NWS-style; aligns with Eastern “calendar” storm day)
        setDatePreset('day12z');
    }
    
    const legendContainer = document.getElementById('legend');
    const legendTooltips = {
        'Rain': 'Rainfall reports measured in inches. Color intensity indicates amount.',
        'Flood': 'Flooding reports (non-coastal). Green indicates flood conditions.',
        'Coastal Flooding': 'Coastal flooding reports. Green indicates coastal flood conditions.',
        'Snow': 'Snowfall reports measured in inches. Color changes with accumulation.',
        'Sleet': 'Sleet depth in inches. Same marker style as hail (circle) with sleet color scale.',
        'Freezing Rain': 'Freezing rain reports measured in inches. Blue outline distinguishes freezing rain.',
        'Ice': 'Ice accumulation reports. Gray to purple indicates severity.',
        'Hail': 'Hail size reports in inches. Pink to purple indicates larger hail.',
        'Wind': 'Wind speed reports in mph. Yellow to brown indicates stronger winds.',
        'Thunderstorm': 'Thunderstorm wind reports. Yellow to red indicates severity.',
        'Tornado': 'Confirmed tornado reports. Red square with red border.',
        'Funnel Cloud': 'Funnel cloud reports. Red square with white border.',
        'Waterspout': 'Waterspout reports. Same tornado icon on a blue square with blue border.',
        'Tropical': 'Tropical storm/hurricane reports. White to black indicates intensity.',
        'Temperature': 'Temperature reports in °F. Blue to red indicates cold to hot.',
        'Fog': 'Fog reports. Visibility in miles when reported.',
        'Wildfire': 'Wildfire and similar fire-weather reports.',
        'Other': 'Other weather phenomena not categorized above.'
    };
    
    LEGEND_ITEMS.forEach(item => {
        const div = document.createElement('div');
        div.className = 'legend-item';
        div.title = legendTooltips[item.name] || `${item.name} weather reports`;
        const borderRadius = item.shape === 'square' ? '0%' : '50%';
        div.innerHTML = `
            <div class="legend-icon" style="background-color: ${item.color}; border-radius: ${borderRadius};" title="${legendTooltips[item.name] || ''}">
                ${item.emoji ? `<span class="legend-emoji">${item.emoji}</span>` : ''}
            </div>
            <div class="legend-text">${item.name}</div>
        `;
        legendContainer.appendChild(div);
    });
    
}

// ============================================================================
// SHAREABLE URL
// ============================================================================

function generateShareableURL() {
    const params = new URLSearchParams();
    
    // Date range
    const startDate = document.getElementById('startDate').value;
    const startHour = document.getElementById('startHour').value;
    const endDate = document.getElementById('endDate').value;
    const endHour = document.getElementById('endHour').value;
    
    if (startDate && endDate) {
        params.set('start', `${startDate}T${startHour}`);
        params.set('end', `${endDate}T${endHour}`);
    }
    
    // Region/State
    const region = document.getElementById('regionSelect').value;
    if (region) {
        params.set('region', region);
    }
    
    // Weather types
    const activeTypes = getActiveWeatherFilters();
    if (activeTypes.length > 0 && activeTypes.length < CONFIG.WEATHER_TYPES.length) {
        params.set('types', activeTypes.join(','));
    }
    
    return window.location.origin + window.location.pathname + '?' + params.toString();
}

function loadStateFromURL() {
    const params = new URLSearchParams(window.location.search);
    let shouldFetch = false;
    
    // Load date range
    if (params.has('start') && params.has('end')) {
        const start = params.get('start').split('T');
        const end = params.get('end').split('T');
        if (start[0] && end[0]) {
            document.getElementById('startDate').value = start[0];
            document.getElementById('startHour').value = start[1] || '0000';
            document.getElementById('endDate').value = end[0];
            document.getElementById('endHour').value = end[1] || '1200';
            setDatePreset('custom');
            shouldFetch = true;
        }
    } else {
        // No date params, use default meteorological day
        setDatePreset('day12z');
    }
    
    // Load region
    if (params.has('region')) {
        document.getElementById('regionSelect').value = params.get('region');
        // Trigger change event to zoom and fetch
        const event = new Event('change', { bubbles: true });
        document.getElementById('regionSelect').dispatchEvent(event);
        shouldFetch = true;
    }
    
    // Load weather types
    if (params.has('types')) {
        const types = params.get('types').split(',');
        document.querySelectorAll('input[id^="hidden-filter-"]').forEach(cb => {
            const isActive = types.includes(cb.value);
            cb.checked = isActive;
            const chip = document.getElementById(`filter-${getWeatherTypeId(cb.value)}`);
            if (chip) {
                if (isActive) {
                    chip.classList.add('active');
                } else {
                    chip.classList.remove('active');
                }
            }
        });
    }
    
    // If we loaded from URL and it's custom, fetch data
    if (shouldFetch && document.querySelector('.btn-preset.active')?.dataset.preset === 'custom') {
        setTimeout(() => fetchLSRData(), 500);
    }
}

// ============================================================================
// EXPORT DATA
// ============================================================================

function convertToCSV(reports) {
    // Extract data from reports
    const rows = [];
    rows.push('Type,Magnitude,Latitude,Longitude,Location,Time,Remarks');
    
    reports.forEach(report => {
        const type = report.type || 'Other';
        const magnitude = report.magnitude ? `${report.magnitude}${report.unit || ''}` : '';
        const location = report.location || '';
        const time = report.time || '';
        const remarks = (report.remark || '').replace(/"/g, '""');
        
        const row = [
            `"${type}"`,
            `"${magnitude}"`,
            report.lat,
            report.lon,
            `"${location.replace(/"/g, '""')}"`,
            `"${time.replace(/"/g, '""')}"`,
            `"${remarks}"`
        ].join(',');
        
        rows.push(row);
    });
    
    return rows.join('\n');
}

function convertToJSON(reports) {
    return JSON.stringify(reports.map(report => ({
        type: report.type || 'Other',
        magnitude: report.magnitude || null,
        unit: report.unit || '',
        latitude: report.lat,
        longitude: report.lon,
        location: report.location || '',
        time: report.time || '',
        remark: report.remark || ''
    })), null, 2);
}

function convertToGeoJSON(reports) {
    return JSON.stringify({
        type: 'FeatureCollection',
        features: reports.map(report => ({
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: [report.lon, report.lat]
            },
            properties: {
                type: report.type || 'Other',
                magnitude: report.magnitude || null,
                unit: report.unit || '',
                location: report.location || '',
                time: report.time || '',
                remark: report.remark || ''
            }
        }))
    }, null, 2);
}

function showExportOptions() {
    if (allFilteredReports.length === 0) {
        showStatusToast('No data to export. Please load data first.', 'info');
        return;
    }
    
    // Show export modal with format options
    const exportModal = document.getElementById('exportModal');
    if (exportModal) {
        exportModal.classList.add('show');
    }
}

function downloadFile(data, filename, mimeType) {
    const blob = new Blob([data], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    showStatusToast(`Exported ${allFilteredReports.length} reports as ${filename.split('.').pop().toUpperCase()}`, 'success');
}

// Update export count in modal
function updateExportCount() {
    const exportCountEl = document.getElementById('exportCount');
    if (exportCountEl) {
        exportCountEl.textContent = allFilteredReports.length.toLocaleString();
    }
}

function handleExport(format) {
    if (allFilteredReports.length === 0) {
        showStatusToast('No data to export. Please load data first.', 'info');
        return;
    }
    
    let data, filename, mimeType;
    const dateStr = new Date().toISOString().split('T')[0];
    
    switch(format) {
        case 'csv':
            data = convertToCSV(allFilteredReports);
            filename = `storm-reports-${dateStr}.csv`;
            mimeType = 'text/csv';
            break;
        case 'json':
            data = convertToJSON(allFilteredReports);
            filename = `storm-reports-${dateStr}.json`;
            mimeType = 'application/json';
            break;
        case 'geojson':
            data = convertToGeoJSON(allFilteredReports);
            filename = `storm-reports-${dateStr}.geojson`;
            mimeType = 'application/geo+json';
            break;
        default:
            return;
    }
    
    downloadFile(data, filename, mimeType);
    
    // Close export modal
    const exportModal = document.getElementById('exportModal');
    if (exportModal) {
        exportModal.classList.remove('show');
    }
}

// ============================================================================
// KEYBOARD SHORTCUTS
// ============================================================================

function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Don't trigger shortcuts when typing in inputs
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT' || e.target.isContentEditable) {
            return;
        }
        
        // Don't trigger if modifier keys are pressed (except for help)
        if (e.ctrlKey || e.metaKey || e.altKey) {
            // Allow Ctrl/Cmd + ? for help
            if ((e.ctrlKey || e.metaKey) && e.key === '?') {
                e.preventDefault();
                showHelpModal();
            }
            return;
        }
        
        switch(e.key.toLowerCase()) {
            case 'g':
                e.preventDefault();
                document.getElementById('fetchData')?.click();
                break;
            case 'c':
                e.preventDefault();
                document.getElementById('clearMapBtn')?.click();
                break;
            case 's':
                e.preventDefault();
                document.getElementById('shareLink')?.click();
                break;
            case 'e':
                e.preventDefault();
                document.getElementById('exportData')?.click();
                break;
            case '?':
                e.preventDefault();
                showHelpModal();
                break;
        }
    });
}

function showHelpModal() {
    const helpModal = document.getElementById('helpModal');
    if (helpModal) {
        helpModal.classList.add('show');
    }
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================

// Initialize offline detection
offlineDetector.addListener((isOnline) => {
    if (!isOnline) {
        showStatusToast('You are now offline. Some features may be limited.', 'warning');
    } else {
        showStatusToast('Connection restored.', 'success');
    }
});

// ============================================================================
// MAP SETUP
// ============================================================================

/**
 * Create the map (self-hosted basemap) and the report/alert/area layers.
 */
async function initializeMap() {
    ({ map } = await createMap('map', {
        theme: getSavedTheme(),
        center: [CONFIG.MAP_INITIAL.lon, CONFIG.MAP_INITIAL.lat],
        zoom: CONFIG.MAP_INITIAL.zoom
    }));

    const isClickBlocked = () => boundsClickMode;
    markersLayer = new ReportLayer(maplibregl, {
        id: 'lsr-reports',
        popupHtml: (report) => createPopupContent(report),
        onOpen: (report) => updateMagnitudeLegendForReport(report),
        isClickBlocked
    });
    pnsLayer = new ReportLayer(maplibregl, {
        id: 'pns-reports',
        popupHtml: (report) => report.popupHtml,
        onOpen: (report, popupElement) => {
            if (report.reportData) {
                updateMagnitudeLegendForReport(report.reportData);
            }
            const button = popupElement?.querySelector('.pns-view-full-btn');
            if (button) {
                button.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openPnsModal(report.pnsData);
                });
            }
        },
        // Office markers (no metadata) open the full statement directly
        onClick: (report) => openPnsModal(report.pnsData),
        isClickBlocked
    });
    warningsLayer = new AlertLayer(maplibregl, 'warnings');
    allWarningsLayer = new AlertLayer(maplibregl, 'all-warnings');
    allWarningsLayer.hide();
    allWatchesLayer = new AlertLayer(maplibregl, 'all-watches');
    allWatchesLayer.hide();
    userArea = new AreaOverlay('user-area');

    map.on('load', () => {
        // Draw order (bottom to top): basemap, area outline, watches, warnings,
        // basemap labels, LSR, PNS
        userArea.addTo(map, LABEL_ANCHOR_LAYER);
        allWatchesLayer.addTo(map, LABEL_ANCHOR_LAYER);
        allWarningsLayer.addTo(map, LABEL_ANCHOR_LAYER);
        warningsLayer.addTo(map, LABEL_ANCHOR_LAYER);
        markersLayer.addTo(map);
        pnsLayer.addTo(map);
    });
}

/**
 * Click routing: bounds-drawing mode first, otherwise open the popup of the
 * topmost report or alert under the cursor (one popup per click).
 */
function handleMapFeatureClick(e) {
    if (boundsClickMode) {
        handleMapClick(e);
        return;
    }
    routeFeatureClick(map, e, [markersLayer, pnsLayer, warningsLayer, allWarningsLayer, allWatchesLayer]);
}

document.addEventListener('DOMContentLoaded', async () => {
    // Ensure CONFIG is loaded (it should be from script tag, but check anyway)
    if (typeof CONFIG === 'undefined') {
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            console.error('CONFIG is not defined. Make sure config.js is loaded before app.js');
        }
        showStatusToast('Configuration error. Please refresh the page.', 'error');
        return;
    }
    
    // Initialize map first (MapLibre GL / WebGL, self-hosted vector basemap)
    await initializeMap();
    
    // Initialize dark mode (after map is created so it can restyle the basemap)
    initializeDarkMode();

    loadBoundaryGeoJson().catch(() => {});
    
    // Initialize warnings service
    warningsService = new WarningsService();
    
    // Initialize services
    if (!pnsService) {
        pnsService = new PNSService();
    }
    statisticsService = new StatisticsService();
    reportCountService = new ReportCountService();
    filterService = new FilterService();

    buildWfoSelectOptions();

    initializeUI();
    
    // Collapsible sections
    document.querySelectorAll('.control-group-header, .section-header').forEach(header => {
        header.addEventListener('click', () => {
            const section = header.closest('.control-group, .collapsible-section');
            if (section) {
                section.classList.toggle('collapsed');
            }
        });
    });
    
    // Clear all filters
    const clearAllFiltersBtn = document.getElementById('clearAllFilters');
    if (clearAllFiltersBtn) {
        clearAllFiltersBtn.addEventListener('click', () => {
            // Reset date to default 12Z meteorological day
            setDatePreset('day12z');
            // Reset location
            const regionSelect = document.getElementById('regionSelect');
            if (regionSelect) {
                regionSelect.value = '';
                regionSelect.dispatchEvent(new Event('change'));
            }
            // Reset weather types to all
            toggleAllWeatherTypes(true);
            // Clear PNS toggle
            const pnsCheckbox = document.getElementById('showPNS');
            if (pnsCheckbox) {
                pnsCheckbox.checked = false;
                showPNS = false;
            }
            // Clear map
            clearMap();
        });
    }
    
    // PNS Toggle Logic
    const pnsCheckbox = document.getElementById('showPNS');
    if (pnsCheckbox) {
        pnsCheckbox.addEventListener('change', (e) => {
            showPNS = e.target.checked;
            if (showPNS) {
                fetchPNSData();
            } else {
                if (pnsLayer) {
                    pnsLayer.clear();
                }
            }
        });
    }
    

    const toggleShortFuseWarnings = document.getElementById('toggleShortFuseWarnings');
    if (toggleShortFuseWarnings) {
        toggleShortFuseWarnings.addEventListener('change', (e) => {
            showWarnings = e.target.checked;
            if (showWarnings && showAllWarningsLayer) {
                showAllWarningsLayer = false;
                const allWarningsToggle = document.getElementById('toggleAllWarnings');
                if (allWarningsToggle) allWarningsToggle.checked = false;
                if (allWarningsLayer.isVisible()) {
                    allWarningsLayer.hide();
                    allWarningsLayer.clear();
                    updateWarningsCount('allWarningsCount', 0, false);
                }
            }
            if (!showWarnings && warningsLayer) {
                warningsLayer.clear();
                updateWarningsCount('warningsCount', 0, false);
            }
            fetchWarnings();
            updateWarningsRefreshListeners();
        });
    }

    const toggleAllWarnings = document.getElementById('toggleAllWarnings');
    if (toggleAllWarnings) {
        toggleAllWarnings.addEventListener('change', (e) => {
            showAllWarningsLayer = e.target.checked;
            if (showAllWarningsLayer) {
                allWarningsLayer.show();
                showWarnings = false;
                const shortFuseToggle = document.getElementById('toggleShortFuseWarnings');
                if (shortFuseToggle) shortFuseToggle.checked = false;
                if (warningsLayer) {
                    warningsLayer.clear();
                    updateWarningsCount('warningsCount', 0, false);
                }
            } else if (allWarningsLayer.isVisible()) {
                allWarningsLayer.hide();
                allWarningsLayer.clear();
                updateWarningsCount('allWarningsCount', 0, false);
            }
            fetchWarnings();
            updateWarningsRefreshListeners();
        });
    }

    const toggleAllWatches = document.getElementById('toggleAllWatches');
    if (toggleAllWatches) {
        toggleAllWatches.addEventListener('change', (e) => {
            showAllWatchesLayer = e.target.checked;
            if (showAllWatchesLayer) {
                allWatchesLayer.show();
            } else if (allWatchesLayer.isVisible()) {
                allWatchesLayer.hide();
                allWatchesLayer.clear();
                updateWarningsCount('allWatchesCount', 0, false);
            }
            fetchWarnings();
            updateWarningsRefreshListeners();
        });
    }

    // Status toast close
    const closeStatusToastBtn = document.getElementById('closeStatusToast');
    if (closeStatusToastBtn) {
        closeStatusToastBtn.addEventListener('click', () => {
            const toast = document.getElementById('statusToast');
            if (toast) {
                toast.style.display = 'none';
            }
        });
    }
    
    // Date presets
    document.querySelectorAll('.btn-preset').forEach(btn => {
        btn.addEventListener('click', () => {
            const preset = btn.getAttribute('data-preset');
            setDatePreset(preset);
            updateFilterSummary();
        });
    });

    const shiftDateBackwardBtn = document.getElementById('shiftDateBackward');
    if (shiftDateBackwardBtn) {
        shiftDateBackwardBtn.addEventListener('click', () => {
            shiftCustomDateRange(-1);
        });
    }

    const shiftDateForwardBtn = document.getElementById('shiftDateForward');
    if (shiftDateForwardBtn) {
        shiftDateForwardBtn.addEventListener('click', () => {
            shiftCustomDateRange(1);
        });
    }
    
    // Weather type toggles
    const selectAllTypesBtn = document.getElementById('selectAllTypes');
    if (selectAllTypesBtn) {
        selectAllTypesBtn.addEventListener('click', () => {
            toggleAllWeatherTypes(true);
            updateFilterSummary();
            if (lastGeoJsonData) {
                refreshMapWithCurrentFilters();
            }
        });
    }
    const selectNoneTypesBtn = document.getElementById('selectNoneTypes');
    if (selectNoneTypesBtn) {
        selectNoneTypesBtn.addEventListener('click', () => {
            toggleAllWeatherTypes(false);
            updateFilterSummary();
            if (lastGeoJsonData) {
                refreshMapWithCurrentFilters();
            }
        });
    }
    
    
    
    // Map click for bounds (double-click on map to enable bounds mode)
    map.on('dblclick', (e) => {
        enableBoundsClickMode();
    });
    
    // Map clicks: bounds mode, otherwise the topmost report/alert under the cursor
    map.on('click', handleMapFeatureClick);
    
    // Refresh markers when zoom/pan changes (for zoom-based limits and viewport filtering)
    let zoomMoveTimeout;
    const refreshMarkersOnZoomMove = () => {
        clearTimeout(zoomMoveTimeout);
        zoomMoveTimeout = setTimeout(() => {
            const currentZoom = map.getZoom();
            // Always refresh on zoom changes to apply zoom-based limits
            // Only apply viewport filtering when zoomed in enough
            if (lastGeoJsonData && allFilteredReports.length > 0) {
                const regionSelect = document.getElementById('regionSelect');
                const selectedRegion = regionSelect.value;
                const wfoSel = document.getElementById('wfoSelect')?.value || '';
                const wfoCode = wfoSel || selectedWFO || '';
                const { south: southLat, north: northLat, east: eastLon, west: westLon } =
                    getLsrFilterBoundsSync(selectedRegion, wfoCode);
                displayReports(lastGeoJsonData, southLat, northLat, eastLon, westLon);
            }
            
            // Also refresh PNS markers to apply zoom-based limits and viewport filtering
            filterPNSMarkers();
        }, 300); // Debounce for 300ms
    };
    
    // Marker limits / viewport filtering are optional with WebGL rendering; only
    // re-filter on zoom or pan when one of them is configured
    const zoomLimitsConfigured = Object.keys(CONFIG.ZOOM_BASED_LIMITS || {}).length > 0;
    if (zoomLimitsConfigured || CONFIG.VIEWPORT_ONLY) {
        map.on('zoomend', refreshMarkersOnZoomMove);
    }
    
    // Only listen to move events when viewport filtering is enabled
    if (CONFIG.VIEWPORT_ONLY) {
        map.on('moveend', refreshMarkersOnZoomMove);
    }
    
    // Region/State selector
    const regionSelect = document.getElementById('regionSelect');
    if (regionSelect) {
        regionSelect.addEventListener('change', (e) => {
        const selectedRegion = e.target.value;
        const wfoSelect = document.getElementById('wfoSelect');
        if (wfoSelect) {
            wfoSelect.value = '';
        }
        selectedWFO = null;

        setTimeout(() => {
            fetchLSRData();
            updateFilterSummary();
        }, 50);
        });
    }

    const wfoSelect = document.getElementById('wfoSelect');
    if (wfoSelect) {
        wfoSelect.addEventListener('change', (e) => {
            const code = e.target.value;
            selectedWFO = code || null;
            const regionSelectEl = document.getElementById('regionSelect');
            if (regionSelectEl) {
                regionSelectEl.value = '';
            }
            if (!code) {
                setTimeout(() => {
                    fetchLSRData();
                    updateFilterSummary();
                }, 50);
                return;
            }
            setTimeout(() => {
                fetchLSRData();
                updateFilterSummary();
            }, 50);
        });
    }
    
    // Update filter summary when weather types change
    const weatherTypeFilters = document.getElementById('weatherTypeFilters');
    if (weatherTypeFilters) {
        weatherTypeFilters.addEventListener('click', () => {
            setTimeout(updateFilterSummary, 100);
        });
    }
    
    // Clear bounds button
    const clearBoundsBtn = document.getElementById('clearBounds');
    if (clearBoundsBtn) {
        clearBoundsBtn.addEventListener('click', clearBounds);
    }
    
    // Action buttons
    const fetchDataBtn = document.getElementById('fetchData');
    if (fetchDataBtn) {
        fetchDataBtn.addEventListener('click', () => {
            fetchLSRData();
            updateFilterSummary();
        });
    }
    const autoRefreshBtn = document.getElementById('autoRefresh');
    if (autoRefreshBtn) {
        autoRefreshBtn.addEventListener('click', toggleAutoRefresh);
    }

    // Mobile menu toggle
    const mobileMenuToggle = document.getElementById('mobileMenuToggle');
    const mobileMenuClose = document.getElementById('mobileMenuClose');
    const controlsPanel = document.querySelector('.controls-panel');
    
    function toggleMobileMenu() {
        controlsPanel.classList.toggle('open');
        if (mobileMenuToggle) {
            mobileMenuToggle.classList.toggle('active');
        }
    }
    
    function closeMobileMenu() {
        controlsPanel.classList.remove('open');
        if (mobileMenuToggle) {
            mobileMenuToggle.classList.remove('active');
        }
    }
    
    if (mobileMenuToggle) {
        mobileMenuToggle.addEventListener('click', toggleMobileMenu);
    }
    
    if (mobileMenuClose) {
        mobileMenuClose.addEventListener('click', closeMobileMenu);
    }
    
    // Close menu when clicking outside on mobile
    if (window.innerWidth <= 768) {
        document.addEventListener('click', (e) => {
            if (controlsPanel.classList.contains('open')) {
                // Check if click is outside the panel
                if (!controlsPanel.contains(e.target) && 
                    !mobileMenuToggle.contains(e.target) &&
                    !mobileMenuClose.contains(e.target)) {
                    closeMobileMenu();
                }
            }
        });
    }
    
    // Quick filter presets
    document.getElementById('quickFilterSevere').addEventListener('click', () => {
        toggleAllWeatherTypes(false);
        WEATHER_CATEGORIES.SEVERE.forEach(type => {
            const typeId = getWeatherTypeId(type);
            const chip = document.getElementById(`filter-${typeId}`);
            const hiddenCheckbox = document.getElementById(`hidden-filter-${typeId}`);
            if (chip) chip.classList.add('active');
            if (hiddenCheckbox) hiddenCheckbox.checked = true;
        });
        updateFilterSummary();
        if (document.querySelector('.btn-preset.active')?.dataset.preset !== 'custom') {
            fetchLSRData();
        } else {
            refreshMapWithCurrentFilters();
        }
    });
    
    document.getElementById('quickFilterWinter').addEventListener('click', () => {
        toggleAllWeatherTypes(false);
        WEATHER_CATEGORIES.WINTER.forEach(type => {
            const typeId = getWeatherTypeId(type);
            const chip = document.getElementById(`filter-${typeId}`);
            const hiddenCheckbox = document.getElementById(`hidden-filter-${typeId}`);
            if (chip) chip.classList.add('active');
            if (hiddenCheckbox) hiddenCheckbox.checked = true;
        });
        updateFilterSummary();
        if (document.querySelector('.btn-preset.active')?.dataset.preset !== 'custom') {
            fetchLSRData();
        } else {
            refreshMapWithCurrentFilters();
        }
    });
    
    document.getElementById('quickFilterPrecip').addEventListener('click', () => {
        toggleAllWeatherTypes(false);
        WEATHER_CATEGORIES.PRECIP.forEach(type => {
            const typeId = getWeatherTypeId(type);
            const chip = document.getElementById(`filter-${typeId}`);
            const hiddenCheckbox = document.getElementById(`hidden-filter-${typeId}`);
            if (chip) chip.classList.add('active');
            if (hiddenCheckbox) hiddenCheckbox.checked = true;
        });
        updateFilterSummary();
        if (document.querySelector('.btn-preset.active')?.dataset.preset !== 'custom') {
            fetchLSRData();
        } else {
            refreshMapWithCurrentFilters();
        }
    });
    
    document.getElementById('quickFilterTropical').addEventListener('click', () => {
        toggleAllWeatherTypes(false);
        WEATHER_CATEGORIES.TROPICAL.forEach(type => {
            const typeId = getWeatherTypeId(type);
            const chip = document.getElementById(`filter-${typeId}`);
            const hiddenCheckbox = document.getElementById(`hidden-filter-${typeId}`);
            if (chip) chip.classList.add('active');
            if (hiddenCheckbox) hiddenCheckbox.checked = true;
        });
        updateFilterSummary();
        if (document.querySelector('.btn-preset.active')?.dataset.preset !== 'custom') {
            fetchLSRData();
        } else {
            refreshMapWithCurrentFilters();
        }
    });
    
    // Share link functionality
    document.getElementById('shareLink').addEventListener('click', () => {
        const url = generateShareableURL();
        navigator.clipboard.writeText(url).then(() => {
            const btn = document.getElementById('shareLink');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
            btn.classList.add('active');
            setTimeout(() => {
                btn.innerHTML = originalText;
                btn.classList.remove('active');
            }, 2000);
        }).catch(() => {
            // Fallback for browsers without clipboard API
            const url = generateShareableURL();
            prompt('Copy this link:', url);
        });
    });
    
    // Export data functionality
    document.getElementById('exportData').addEventListener('click', () => {
        if (allFilteredReports.length === 0) {
            showStatusToast('No data to export. Please load data first.', 'info');
            return;
        }
        
        // Show export options
        showExportOptions();
    });
    
    // Top 10 Reports modal
    const topReportsModal = document.getElementById('topReportsModal');
    const showTopReportsBtn = document.getElementById('showTopReports');
    const closeTopReportsBtn = document.getElementById('closeTopReports');
    
    showTopReportsBtn.addEventListener('click', () => {
        displayTopReports();
        topReportsModal.classList.add('show');
    });
    
    closeTopReportsBtn.addEventListener('click', () => {
        topReportsModal.classList.remove('show');
    });
    
    // Close modal when clicking outside
    topReportsModal.addEventListener('click', (e) => {
        if (e.target === topReportsModal) {
            topReportsModal.classList.remove('show');
        }
    });
    
    // Close modal with Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (topReportsModal.classList.contains('show')) {
                topReportsModal.classList.remove('show');
            }
            const pnsModal = document.getElementById('pnsModal');
            if (pnsModal && pnsModal.classList.contains('show')) {
                pnsModal.classList.remove('show');
            }
        }
    });
    
    // PNS Modal handlers
    const pnsModal = document.getElementById('pnsModal');
    const closePnsModalBtn = document.getElementById('closePnsModal');
    
    if (closePnsModalBtn) {
        closePnsModalBtn.addEventListener('click', () => {
            pnsModal.classList.remove('show');
        });
    }
    
    if (pnsModal) {
        pnsModal.addEventListener('click', (e) => {
            if (e.target === pnsModal) {
                pnsModal.classList.remove('show');
            }
        });
    }
    
    // Performance banner close button
    const closePerformanceBanner = document.getElementById('closePerformanceBanner');
    if (closePerformanceBanner) {
        closePerformanceBanner.addEventListener('click', () => {
            const banner = document.getElementById('performanceBanner');
            if (banner) banner.style.display = 'none';
        });
    }
    
    // Empty state action button
    const emptyStateGetData = document.getElementById('emptyStateGetData');
    if (emptyStateGetData) {
        emptyStateGetData.addEventListener('click', () => {
            document.getElementById('fetchData')?.click();
        });
    }
    
    // Performance banner updates are now handled in refreshMarkersOnZoomMove
    // which calls displayReports -> updateReportCount
    
    // Keyboard shortcuts
    setupKeyboardShortcuts();
    
    // Clickable summary items - scroll to relevant filter section
    document.querySelectorAll('.cv-clickable').forEach(btn => {
        btn.addEventListener('click', () => {
            const section = btn.dataset.section;
            const targetSection = document.querySelector(`.control-group[data-section="${section}"]`);
            if (targetSection) {
                // Expand if collapsed
                if (targetSection.classList.contains('collapsed')) {
                    targetSection.classList.remove('collapsed');
                }
                // Scroll to section
                targetSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                // Highlight briefly
                targetSection.style.transition = 'background-color 0.3s';
                targetSection.style.backgroundColor = 'rgba(37, 99, 235, 0.1)';
                setTimeout(() => {
                    targetSection.style.backgroundColor = '';
                }, 1000);
            }
        });
    });
    
    // Map controls - use setTimeout to ensure DOM is ready
    setTimeout(() => {
        const resetViewBtn = document.getElementById('resetView');
        if (resetViewBtn) {
            resetViewBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                resetView();
            };
        }
        
        const myLocationBtn = document.getElementById('myLocation');
        if (myLocationBtn) {
            myLocationBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                centerOnMyLocation();
            };
        }
        
        const clearMapBtn = document.getElementById('clearMapBtn');
        if (clearMapBtn) {
            clearMapBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                clearMap();
            };
        }
    }, 100);
    
    
    // Help modal handlers
    const helpModal = document.getElementById('helpModal');
    const closeHelpModal = document.getElementById('closeHelpModal');
    const headerHelpBtn = document.getElementById('headerHelpBtn');
    
    // Show help from header button
    if (headerHelpBtn) {
        headerHelpBtn.addEventListener('click', () => {
            showHelpModal();
        });
    }
    
    if (closeHelpModal) {
        closeHelpModal.addEventListener('click', () => {
            if (helpModal) helpModal.classList.remove('show');
        });
    }
    
    if (helpModal) {
        helpModal.addEventListener('click', (e) => {
            if (e.target === helpModal) {
                helpModal.classList.remove('show');
            }
        });
    }
    
    // Export modal handlers
    const exportModal = document.getElementById('exportModal');
    const closeExportModal = document.getElementById('closeExportModal');
    
    // Export option buttons
    document.querySelectorAll('.export-option-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const format = btn.dataset.format;
            handleExport(format);
        });
    });
    
    if (closeExportModal) {
        closeExportModal.addEventListener('click', () => {
            if (exportModal) exportModal.classList.remove('show');
        });
    }
    
    if (exportModal) {
        exportModal.addEventListener('click', (e) => {
            if (e.target === exportModal) {
                exportModal.classList.remove('show');
            }
        });
    }
    
    // Update Escape key handler to include all modals
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (helpModal && helpModal.classList.contains('show')) {
                helpModal.classList.remove('show');
            }
            if (exportModal && exportModal.classList.contains('show')) {
                exportModal.classList.remove('show');
            }
            const topReportsModal = document.getElementById('topReportsModal');
            if (topReportsModal && topReportsModal.classList.contains('show')) {
                topReportsModal.classList.remove('show');
            }
            const pnsModal = document.getElementById('pnsModal');
            if (pnsModal && pnsModal.classList.contains('show')) {
                pnsModal.classList.remove('show');
            }
            const tutorialModal = document.getElementById('tutorialModal');
            if (tutorialModal && tutorialModal.classList.contains('show')) {
                tutorialModal.classList.remove('show');
                localStorage.setItem('lsr-tutorial-seen', 'true');
            }
        }
    });
    
    // Export count is updated in displayReports function
    
    // First Visit Tutorial
    setupTutorial();
    
    // Auto-load data for last 24 hours on page load (handled by setDatePreset)
});

// ============================================================================
// DARK MODE
// ============================================================================

function initializeDarkMode() {
    const darkModeToggle = document.getElementById('darkModeToggle');
    const darkModeIcon = document.getElementById('darkModeIcon');
    const html = document.documentElement;
    
    const currentTheme = getSavedTheme();
    
    function setTheme(theme) {
        const darkModeLabel = darkModeToggle?.querySelector('.header-action-label');
        
        if (theme === 'dark') {
            html.setAttribute('data-theme', 'dark');
            if (darkModeIcon) {
                darkModeIcon.className = 'fas fa-sun';
            }
            if (darkModeLabel) {
                darkModeLabel.textContent = 'Light Mode';
            }
            if (darkModeToggle) {
                darkModeToggle.title = 'Switch to light mode';
            }
            localStorage.setItem('lsr-theme', 'dark');
        } else {
            html.removeAttribute('data-theme');
            if (darkModeIcon) {
                darkModeIcon.className = 'fas fa-moon';
            }
            if (darkModeLabel) {
                darkModeLabel.textContent = 'Dark Mode';
            }
            if (darkModeToggle) {
                darkModeToggle.title = 'Switch to dark mode';
            }
            localStorage.setItem('lsr-theme', 'light');
        }
        applyBasemapTheme(map, theme === 'dark' ? 'dark' : 'light');
    }
    
    // Set initial theme (this also styles the basemap)
    setTheme(currentTheme);
    
    // Toggle theme on button click
    if (darkModeToggle) {
        darkModeToggle.addEventListener('click', () => {
            const isDark = html.getAttribute('data-theme') === 'dark';
            setTheme(isDark ? 'light' : 'dark');
            showStatusToast(isDark ? 'Switched to light mode' : 'Switched to dark mode', 'success');
        });
    }
    
    // Listen for system theme changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        const savedTheme = localStorage.getItem('lsr-theme');
        if (savedTheme === 'auto' || !savedTheme) {
            setTheme(e.matches ? 'dark' : 'light');
        }
    });
}

// ============================================================================
// TUTORIAL MODAL
// ============================================================================

function setupTutorial() {
    const tutorialModal = document.getElementById('tutorialModal');
    const closeTutorialBtn = document.getElementById('closeTutorialModal');
    const tutorialSkipBtn = document.getElementById('tutorialSkip');
    const tutorialNextBtn = document.getElementById('tutorialNext');
    const tutorialPrevBtn = document.getElementById('tutorialPrev');
    const tutorialFinishBtn = document.getElementById('tutorialFinish');
    const tutorialSteps = document.querySelectorAll('.tutorial-step');
    const tutorialStepCount = document.getElementById('tutorialStepCount');
    const tutorialTotalSteps = document.getElementById('tutorialTotalSteps');
    
    if (!tutorialModal) return;
    
    let currentStep = 1;
    const totalSteps = tutorialSteps.length;
    tutorialTotalSteps.textContent = totalSteps;
    
    // Check if user has seen tutorial
    const hasSeenTutorial = localStorage.getItem('lsr-tutorial-seen') === 'true';
    
    if (!hasSeenTutorial) {
        // Show tutorial after a short delay
        setTimeout(() => {
            tutorialModal.classList.add('show');
        }, 500);
    }
    
    function updateTutorialStep() {
        // Hide all steps
        tutorialSteps.forEach(step => {
            step.classList.remove('active');
        });
        
        // Show current step
        const currentStepEl = document.querySelector(`.tutorial-step[data-step="${currentStep}"]`);
        if (currentStepEl) {
            currentStepEl.classList.add('active');
        }
        
        // Update step counter
        tutorialStepCount.textContent = currentStep;
        
        // Update button visibility
        tutorialPrevBtn.style.display = currentStep === 1 ? 'none' : 'inline-flex';
        tutorialNextBtn.style.display = currentStep === totalSteps ? 'none' : 'inline-flex';
        tutorialFinishBtn.style.display = currentStep === totalSteps ? 'inline-flex' : 'none';
        tutorialSkipBtn.style.display = currentStep === totalSteps ? 'none' : 'inline-flex';
    }
    
    function nextStep() {
        if (currentStep < totalSteps) {
            currentStep++;
            updateTutorialStep();
        }
    }
    
    function prevStep() {
        if (currentStep > 1) {
            currentStep--;
            updateTutorialStep();
        }
    }
    
    function closeTutorial() {
        tutorialModal.classList.remove('show');
        localStorage.setItem('lsr-tutorial-seen', 'true');
    }
    
    // Event listeners
    if (closeTutorialBtn) {
        closeTutorialBtn.addEventListener('click', closeTutorial);
    }
    
    if (tutorialSkipBtn) {
        tutorialSkipBtn.addEventListener('click', closeTutorial);
    }
    
    if (tutorialNextBtn) {
        tutorialNextBtn.addEventListener('click', nextStep);
    }
    
    if (tutorialPrevBtn) {
        tutorialPrevBtn.addEventListener('click', prevStep);
    }
    
    if (tutorialFinishBtn) {
        tutorialFinishBtn.addEventListener('click', closeTutorial);
    }
    
    // Close on backdrop click
    tutorialModal.addEventListener('click', (e) => {
        if (e.target === tutorialModal) {
            closeTutorial();
        }
    });
    
    // Close on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && tutorialModal.classList.contains('show')) {
            closeTutorial();
        }
    });
    
    // Initialize first step
    updateTutorialStep();
}
