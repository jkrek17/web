// ============================================================================
// TIME STATES - Per-feature playback styling with MapLibre feature state
// ============================================================================
//
// Changing a filter or a data-driven paint expression makes MapLibre rebuild
// every tile of the source in its worker (seconds for thousands of reports),
// which is far too slow to do every animation frame. Feature state is applied
// per feature on the main thread instead, so the playback clock only touches
// the reports whose status actually changed since the last frame:
//
//   shown   report time <= playhead
//   recent  within the highlight window (full opacity + halo)
//   a       appearance progress 0..1 while fading in (unset = 1)
//
// Both sources use promoteId 'i' (the feature's index), and reports must be
// sorted by time so each status is a contiguous index range.

/** Report icon opacity: hidden until reached, faded in, dimmed once older than the highlight window */
export const REPORT_ICON_OPACITY = [
    'case',
    ['boolean', ['feature-state', 'shown'], false],
    ['*',
        ['number', ['coalesce', ['feature-state', 'a'], 1]],
        ['case', ['boolean', ['feature-state', 'recent'], false], 1, 0.45]],
    0
];

/** Halo under recent reports; it starts larger and settles as the report fades in */
export const RECENT_HALO_PAINT = {
    'circle-radius': ['+', 18, ['*', 12, ['-', 1, ['number', ['coalesce', ['feature-state', 'a'], 1]]]]],
    'circle-color': 'rgba(245, 158, 11, 0.22)',
    'circle-stroke-color': '#f59e0b',
    'circle-stroke-width': 2,
    'circle-opacity': ['case', ['boolean', ['feature-state', 'recent'], false], 1, 0],
    'circle-stroke-opacity': ['case', ['boolean', ['feature-state', 'recent'], false], 1, 0]
};

/** Paint overrides for an AlertLayer whose alerts carry { b, e } validity times */
export const ALERT_TIME_PAINT = {
    fill: { 'fill-opacity': ['case', ['boolean', ['feature-state', 'on'], false], 0.12, 0] },
    line: { 'line-opacity': ['case', ['boolean', ['feature-state', 'on'], false], 0.9, 0] },
    point: { 'icon-opacity': ['case', ['boolean', ['feature-state', 'on'], false], 0.85, 0] }
};

export class ReportTimeStates {
    /**
     * @param {object} map
     * @param {string} sourceId GeoJSON source with promoteId 'i'
     */
    constructor(map, sourceId) {
        this.map = map;
        this.sourceId = sourceId;
        this.times = [];
        this.shown = 0;
        this.recentStart = 0;
        this.freshStart = 0;
    }

    /** New data: times[i] is the report time of feature i (ascending) */
    reset(times) {
        this.times = times;
        this.shown = 0;
        this.recentStart = 0;
        this.freshStart = 0;
        this.map.removeFeatureState({ source: this.sourceId });
    }

    /** Number of reports with time <= ms */
    countUpTo(ms) {
        const times = this.times;
        let lo = 0, hi = times.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (times[mid] <= ms) lo = mid + 1; else hi = mid;
        }
        return lo;
    }

    set(i, state) {
        this.map.setFeatureState({ source: this.sourceId, id: i }, state);
    }

    /**
     * @param {number} t playhead (epoch ms)
     * @param {number} trailMs highlight window
     * @param {number} fadeMs fade-in length in weather time (0: appear at once)
     */
    update(t, trailMs, fadeMs) {
        const s0 = this.shown, r0 = this.recentStart, f0 = this.freshStart;
        const s1 = this.countUpTo(t);
        const r1 = Math.min(s1, this.countUpTo(t - trailMs));
        const f1 = fadeMs > 0 ? Math.min(s1, this.countUpTo(t - fadeMs)) : s1;

        // shown: [0, s)
        if (s1 > s0) {
            for (let i = s0; i < s1; i++) this.set(i, { shown: true });
        } else {
            for (let i = s1; i < s0; i++) this.set(i, { shown: false });
        }

        // recent: [r, s)
        for (let i = Math.min(r0, r1), hi = Math.max(s0, s1); i < hi; i++) {
            const was = i >= r0 && i < s0;
            const now = i >= r1 && i < s1;
            if (was !== now) this.set(i, { recent: now });
        }

        // fading in: [f, s) gets its progress; anything that left the range is done
        for (let i = f1; i < s1; i++) {
            this.set(i, { a: Math.max(0, Math.min(1, (t - this.times[i]) / fadeMs)) });
        }
        for (let i = Math.min(f0, f1), hi = Math.max(s0, s1); i < hi; i++) {
            const was = i >= f0 && i < s0;
            const now = i >= f1 && i < s1;
            if (was && !now) this.set(i, { a: 1 });
        }

        this.shown = s1;
        this.recentStart = r1;
        this.freshStart = f1;
        return s1;
    }
}

export class AlertTimeStates {
    /**
     * @param {object} map
     * @param {string} sourceId AlertLayer source with promoteId 'i'
     */
    constructor(map, sourceId) {
        this.map = map;
        this.sourceId = sourceId;
        this.alerts = [];
        this.on = new Uint8Array(0);
    }

    /** New alert list (same order as given to the AlertLayer); each has properties { b, e } */
    reset(alerts) {
        this.alerts = alerts;
        this.on = new Uint8Array(alerts.length);
        this.map.removeFeatureState({ source: this.sourceId });
    }

    /** Turn on the alerts valid at t; returns how many are on */
    update(t) {
        let count = 0;
        for (let i = 0; i < this.alerts.length; i++) {
            const p = this.alerts[i].properties;
            const now = p.b <= t && t < p.e ? 1 : 0;
            count += now;
            if (now !== this.on[i]) {
                this.on[i] = now;
                this.map.setFeatureState({ source: this.sourceId, id: i }, { on: now === 1 });
            }
        }
        return count;
    }
}
