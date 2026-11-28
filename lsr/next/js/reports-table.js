// ============================================================================
// LSR reports table page
// ============================================================================

import LSRService from './api/lsrService.js';
import { offlineDetector } from './utils/offlineDetector.js';
import { normalizeLSRReports } from './lsr/normalizeLSR.js';

function normalizeTimeInputValue(value) {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
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

function getUtcDateString(date) {
    return date.toISOString().split('T')[0];
}

function applyDefaultDay12z() {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    document.getElementById('startDate').value = getUtcDateString(yesterday);
    document.getElementById('startHour').value = '1200';
    document.getElementById('endDate').value = getUtcDateString(today);
    document.getElementById('endHour').value = '1200';
}

function parseUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const start = params.get('start');
    const end = params.get('end');
    const region = params.get('region');
    const types = params.get('types');

    if (start && end) {
        const [sd, shRaw] = start.split('T');
        const [ed, ehRaw] = end.split('T');
        if (sd && ed) {
            document.getElementById('startDate').value = sd;
            document.getElementById('endDate').value = ed;
            const sh = normalizeTimeInputValue(shRaw || '') || (shRaw || '0000').replace(/\D/g, '').padStart(4, '0').slice(0, 4);
            const eh = normalizeTimeInputValue(ehRaw || '') || (ehRaw || '1200').replace(/\D/g, '').padStart(4, '0').slice(0, 4);
            document.getElementById('startHour').value = sh.length === 4 ? sh : '0000';
            document.getElementById('endHour').value = eh.length === 4 ? eh : '1200';
        }
    } else {
        applyDefaultDay12z();
    }

    if (region) {
        const stateSel = document.getElementById('stateFilter');
        if (stateSel && CONFIG.STATES[region]) {
            stateSel.value = region;
        }
    }

    if (types) {
        const selected = types.split(',').map((t) => t.trim()).filter(Boolean);
        const typeSel = document.getElementById('typeFilter');
        if (typeSel && selected.length) {
            Array.from(typeSel.options).forEach((opt) => {
                opt.selected = selected.includes(opt.value);
            });
        }
    }
}

function getSelectedReportTypes() {
    const typeSel = document.getElementById('typeFilter');
    return Array.from(typeSel.selectedOptions).map((o) => o.value);
}

function reportMatchesStateFilter(report, stateCode) {
    if (!stateCode) {
        return true;
    }
    const want = String(stateCode).trim().toUpperCase();
    const got = String(report.state || '').trim().toUpperCase();
    return got === want;
}

function updateTableUrl() {
    const params = new URLSearchParams();
    const startDate = document.getElementById('startDate').value;
    const startHour = document.getElementById('startHour').value;
    const endDate = document.getElementById('endDate').value;
    const endHour = document.getElementById('endHour').value;
    if (startDate && endDate) {
        params.set('start', `${startDate}T${startHour}`);
        params.set('end', `${endDate}T${endHour}`);
    }
    const state = document.getElementById('stateFilter').value;
    if (state) {
        params.set('region', state);
    }
    const allTypes = CONFIG.WEATHER_TYPES;
    const selected = Array.from(document.getElementById('typeFilter').selectedOptions).map((o) => o.value);
    if (selected.length > 0 && selected.length < allTypes.length) {
        params.set('types', selected.join(','));
    }
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState({}, '', newUrl);
}

function escapeCsvField(s) {
    const str = s == null ? '' : String(s);
    if (/[",\n\r]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

function buildTableRowsHtml(reports) {
    if (!reports.length) {
        return '<tr><td colspan="8" class="reports-loading">No reports match the current filters.</td></tr>';
    }
    return reports.map((r) => {
        const magStr = r.magnitude !== 0 || r.unit
            ? `${r.magnitude}${r.unit || ''}`.trim()
            : '—';
        return `<tr>
            <td>${escapeHtml(r.time)}</td>
            <td>${escapeHtml(r.filterType)}</td>
            <td>${escapeHtml(r.category)}</td>
            <td class="reports-magnitude-cell">${escapeHtml(magStr)}</td>
            <td>${escapeHtml(r.state || '—')}</td>
            <td>${escapeHtml(r.wfo || '—')}</td>
            <td>${escapeHtml(r.location)}</td>
            <td class="reports-remark-cell">${escapeHtml(r.remark || '')}</td>
        </tr>`;
    }).join('');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
}

let allRawNormalized = [];
let allRows = [];
let sortState = { column: 'time', direction: 'desc' };

function sortReports(list, column, direction) {
    const mult = direction === 'asc' ? 1 : -1;
    const copy = list.slice();
    copy.sort((a, b) => {
        if (column === 'magnitude') {
            const na = Number(a.magnitude) || 0;
            const nb = Number(b.magnitude) || 0;
            if (na !== nb) {
                return mult * (na - nb);
            }
        } else if (column === 'time') {
            const ta = new Date((a.time || '').replace(' ', 'T') + 'Z').getTime();
            const tb = new Date((b.time || '').replace(' ', 'T') + 'Z').getTime();
            if (ta !== tb) {
                return mult * (ta - tb);
            }
        } else if (column === 'type') {
            const ca = (a.filterType || '').localeCompare(b.filterType || '');
            if (ca !== 0) {
                return mult * ca;
            }
        } else if (column === 'state') {
            const sa = (a.state || '').localeCompare(b.state || '');
            if (sa !== 0) {
                return mult * sa;
            }
        }
        return mult * ((a.location || '').localeCompare(b.location || ''));
    });
    return copy;
}

function updateSortHeaders() {
    document.querySelectorAll('.reports-data-table thead th[data-sort]').forEach((th) => {
        th.classList.remove('sorted-asc', 'sorted-desc');
        if (th.dataset.sort === sortState.column) {
            th.classList.add(sortState.direction === 'asc' ? 'sorted-asc' : 'sorted-desc');
        }
    });
}

function applyClientFilters() {
    if (!allRawNormalized.length) {
        allRows = [];
        document.getElementById('reportsTableBody').innerHTML = '';
        document.getElementById('reportsTableMeta').textContent = '';
        updateTableUrl();
        document.getElementById('linkToMap').href = mapPageHref();
        return;
    }

    const state = document.getElementById('stateFilter').value;
    const selectedTypes = getSelectedReportTypes();
    const allTypesCount = CONFIG.WEATHER_TYPES.length;
    let typeSet = null;
    // Empty multi-select = show all types (browser quirk / user cleared selection)
    if (selectedTypes.length > 0 && selectedTypes.length < allTypesCount) {
        typeSet = new Set(selectedTypes);
    }

    allRows = allRawNormalized.filter((r) => {
        if (!reportMatchesStateFilter(r, state)) {
            return false;
        }
        if (typeSet === null) {
            return true;
        }
        return typeSet.has(r.filterType);
    });
    renderTable();
    updateTableUrl();
    document.getElementById('linkToMap').href = mapPageHref();
}

function renderTable() {
    const sorted = sortReports(allRows, sortState.column, sortState.direction);
    document.getElementById('reportsTableBody').innerHTML = buildTableRowsHtml(sorted);
    updateSortHeaders();
    const meta = document.getElementById('reportsTableMeta');
    const rawCount = allRawNormalized.length;
    const state = document.getElementById('stateFilter').value;
    const stateNote = state
        ? `state column = ${state}`
        : 'all states';
    meta.textContent = `Showing ${sorted.length} of ${rawCount} loaded report${rawCount !== 1 ? 's' : ''} (${stateNote}; report type filters).`;
}

function attachSortHandlers() {
    document.querySelectorAll('.reports-data-table thead th[data-sort]').forEach((th) => {
        th.addEventListener('click', () => {
            const col = th.dataset.sort;
            if (sortState.column === col) {
                sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc';
            } else {
                sortState.column = col;
                sortState.direction = col === 'time' ? 'desc' : 'asc';
            }
            renderTable();
        });
    });
}

function exportCsv() {
    const sorted = sortReports(allRows, sortState.column, sortState.direction);
    const headers = ['Time (UTC)', 'Report type', 'Category', 'Magnitude', 'Unit', 'State', 'WFO', 'Location', 'Lat', 'Lon', 'Remarks', 'typetext', 'rtype'];
    const lines = [headers.map(escapeCsvField).join(',')];
    sorted.forEach((r) => {
        lines.push([
            r.time,
            r.filterType,
            r.category,
            r.magnitude,
            (r.unit || '').trim(),
            r.state,
            r.wfo,
            r.location,
            r.lat,
            r.lon,
            r.remark,
            r.typetext,
            r.rtype
        ].map(escapeCsvField).join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `lsr-reports-${document.getElementById('startDate').value}-${document.getElementById('endDate').value}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
}

let lsrService = null;

async function loadReports() {
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;
    const startHourEl = document.getElementById('startHour');
    const endHourEl = document.getElementById('endHour');
    const startHour = normalizeTimeInputValue(startHourEl.value);
    const endHour = normalizeTimeInputValue(endHourEl.value);

    if (!startHour || !endHour) {
        document.getElementById('reportsError').textContent = 'Enter valid start and end times (UTC, HHMM).';
        document.getElementById('reportsError').style.display = 'block';
        return;
    }
    startHourEl.value = startHour;
    endHourEl.value = endHour;

    if (!offlineDetector.checkOnline()) {
        document.getElementById('reportsError').textContent = 'You appear to be offline.';
        document.getElementById('reportsError').style.display = 'block';
        return;
    }

    document.getElementById('reportsError').style.display = 'none';
    document.getElementById('reportsLoading').style.display = 'block';
    document.getElementById('reportsTableBody').innerHTML = '';

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

        allRawNormalized = normalizeLSRReports(data, REPORT_TYPE_MAP).normalized;

        document.getElementById('reportsLoading').style.display = 'none';
        applyClientFilters();
    } catch (e) {
        document.getElementById('reportsLoading').style.display = 'none';
        document.getElementById('reportsError').textContent = e.message || 'Failed to load reports.';
        document.getElementById('reportsError').style.display = 'block';
    }
}

function populateStateSelect() {
    const sel = document.getElementById('stateFilter');
    sel.innerHTML = '<option value="">All states / territories</option>';
    Object.keys(CONFIG.STATES)
        .sort()
        .forEach((code) => {
            const opt = document.createElement('option');
            opt.value = code;
            opt.textContent = `${code} — ${CONFIG.STATES[code].name}`;
            sel.appendChild(opt);
        });
}

function populateTypeFilter() {
    const sel = document.getElementById('typeFilter');
    sel.innerHTML = '';
    CONFIG.WEATHER_TYPES.forEach((t) => {
        const opt = document.createElement('option');
        opt.value = t;
        opt.textContent = t;
        opt.selected = true;
        sel.appendChild(opt);
    });
}

function mapPageHref() {
    const params = new URLSearchParams(window.location.search);
    return `index.html${params.toString() ? `?${params.toString()}` : ''}`;
}

function initTheme() {
    const saved = localStorage.getItem('lsr-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = saved === 'light' || saved === 'dark' ? saved : (prefersDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
}

function setupThemeToggle() {
    const btn = document.getElementById('tableDarkModeToggle');
    const icon = document.getElementById('tableDarkModeIcon');
    if (!btn) return;
    const applyIcon = () => {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        icon.className = isDark ? 'fas fa-sun' : 'fas fa-moon';
    };
    applyIcon();
    btn.addEventListener('click', () => {
        const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('lsr-theme', next);
        applyIcon();
    });
}

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    setupThemeToggle();
    document.getElementById('linkToMap').href = mapPageHref();

    populateStateSelect();
    populateTypeFilter();
    parseUrlParams();

    ['startHour', 'endHour'].forEach((id) => {
        const el = document.getElementById(id);
        el.addEventListener('blur', () => {
            const n = normalizeTimeInputValue(el.value);
            if (n) {
                el.value = n;
            }
        });
    });

    document.getElementById('typeFilter').addEventListener('change', () => {
        applyClientFilters();
    });
    document.getElementById('stateFilter').addEventListener('change', () => {
        applyClientFilters();
    });

    document.getElementById('loadReportsBtn').addEventListener('click', loadReports);
    document.getElementById('exportCsvBtn').addEventListener('click', exportCsv);
    attachSortHandlers();

    loadReports();
});
