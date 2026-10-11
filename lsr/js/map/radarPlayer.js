// ============================================================================
// RADAR PLAYER - Archived NEXRAD composite synced to a playback clock
// ============================================================================
//
// IEM keeps the national base-reflectivity composite (N0Q) for every 5-minute
// time, served as {z}/{x}/{y} tiles. A pool of raster layers is reused:
//   - the frames ahead of the playhead load invisibly (opacity 0) in the pool
//   - between two frames the older fades out as the newer fades in, so storms
//     move smoothly instead of jumping every 5 minutes
//   - the clock asks isFrameLoaded()/isReady() and holds ("buffering") while
//     the frames it is about to show are still loading
//   - setFrameStep() thins the frames while playing fast (e.g. every 20 min at
//     30 min/s) so loading keeps up; the crossfade spans the longer gap
// Only raster-opacity changes per animation frame, which is cheap.

export const FRAME_MS = 5 * 60 * 1000;
/** IEM publishes each composite a few minutes after its valid time */
const PUBLISH_DELAY_MS = 5 * 60 * 1000;
const ATTRIBUTION = 'Radar &copy; <a href="https://mesonet.agron.iastate.edu">Iowa Environmental Mesonet / NWS</a>';
/** Extent of IEM's national (lower 48) composite; no tiles are requested outside it */
const COMPOSITE_BOUNDS = [-127, 22, -65, 51];

function pad(n) {
    return String(n).padStart(2, '0');
}

export class RadarPlayer {
    /**
     * @param {object} [options]
     * @param {string} [options.prefix] source/layer id prefix
     * @param {number} [options.slots] frames kept in the pool (shown + look-ahead)
     * @param {number} [options.opacity] radar opacity
     */
    constructor({ prefix = 'pb-radar', slots = 14, opacity = 0.7 } = {}) {
        this.prefix = prefix;
        this.opacity = opacity;
        this.map = null;
        this.enabled = true;
        this.slots = Array.from({ length: slots }, (_, i) => ({ id: `${prefix}-${i}`, frame: null, assignedAt: 0, used: 0 }));
        this.clock = 0;
        this.shown = new Map(); // slot id -> opacity currently set
        this.dominantFrame = null;
        this.step = FRAME_MS; // interval between frames used (a multiple of 5 minutes)
    }

    /** Use one frame every stepMs (rounded to whole 5-minute frames) */
    setFrameStep(stepMs) {
        this.step = Math.max(1, Math.round(stepMs / FRAME_MS)) * FRAME_MS;
    }

    /** Frame on the current step grid at or before ms (never newer than published) */
    frameAt(ms) {
        return Math.min(Math.floor(ms / this.step) * this.step, RadarPlayer.newestFrame());
    }

    /** Newest frame IEM has published */
    static newestFrame() {
        return Math.floor((Date.now() - PUBLISH_DELAY_MS) / FRAME_MS) * FRAME_MS;
    }

    /** 5-minute frame time at or before ms (never newer than published) */
    static frameTime(ms) {
        return Math.min(Math.floor(ms / FRAME_MS) * FRAME_MS, RadarPlayer.newestFrame());
    }

    static tileUrl(frame) {
        const d = new Date(frame);
        const stamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
            `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
        return `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::USCOMP-N0Q-${stamp}/{z}/{x}/{y}.png`;
    }

    addTo(map, beforeId) {
        this.map = map;
        for (const slot of this.slots) {
            map.addSource(slot.id, {
                type: 'raster',
                tiles: [RadarPlayer.tileUrl(RadarPlayer.newestFrame())],
                tileSize: 256,
                maxzoom: 10,
                bounds: COMPOSITE_BOUNDS,
                attribution: ATTRIBUTION
            });
            map.addLayer({
                id: slot.id,
                type: 'raster',
                source: slot.id,
                layout: { visibility: 'none' },
                paint: { 'raster-opacity': 0, 'raster-fade-duration': 0 }
            }, beforeId);
        }
        return this;
    }

    /** New opacity takes effect on the next render() */
    setOpacity(opacity) {
        this.opacity = opacity;
    }

    setEnabled(enabled) {
        this.enabled = enabled;
        if (!this.map || enabled) return;
        for (const slot of this.slots) {
            this.map.setLayoutProperty(slot.id, 'visibility', 'none');
            this.map.setPaintProperty(slot.id, 'raster-opacity', 0);
            slot.frame = null;
        }
        this.shown.clear();
        this.dominantFrame = null;
    }

    slotFor(frame) {
        return this.slots.find(s => s.frame === frame) || null;
    }

    /**
     * Make sure these frames are in the pool (loading the missing ones into the
     * least recently used slots that are not needed).
     */
    ensure(frames) {
        if (!this.enabled || !this.map) return;
        const wanted = new Set(frames);
        for (const frame of frames) {
            let slot = this.slotFor(frame);
            if (!slot) {
                const free = this.slots.filter(s => !wanted.has(s.frame) && !this.shown.has(s.id));
                if (free.length === 0) break;
                slot = free.reduce((a, b) => (a.used <= b.used ? a : b));
                slot.frame = frame;
                slot.assignedAt = performance.now();
                this.map.getSource(slot.id).setTiles([RadarPlayer.tileUrl(frame)]);
                this.map.setPaintProperty(slot.id, 'raster-opacity', 0);
                this.map.setLayoutProperty(slot.id, 'visibility', 'visible');
            }
            slot.used = ++this.clock;
        }
    }

    /** Frames bracketing ms: [older, newer, fraction of the way to newer] */
    bracket(ms) {
        const a = this.frameAt(ms);
        const b = Math.min(a + this.step, RadarPlayer.newestFrame());
        const f = b > a ? Math.max(0, Math.min(1, (ms - a) / (b - a))) : 0;
        return [a, b, f];
    }

    /** Load the frames for ms and the next `ahead` frames */
    bufferAhead(ms, ahead = 10) {
        const [a] = this.bracket(ms);
        const frames = [];
        for (let i = 0; i <= ahead; i++) {
            const f = a + i * this.step;
            if (f > RadarPlayer.newestFrame()) break;
            frames.push(f);
        }
        this.ensure(frames);
    }

    isLoaded(frame) {
        const slot = this.slotFor(frame);
        if (!slot) return false;
        // Give a fresh source a moment to register its tile requests
        if (performance.now() - slot.assignedAt < 80) return false;
        try {
            return this.map.isSourceLoaded(slot.id);
        } catch (e) {
            return false;
        }
    }

    /** True when the frame at or before ms has loaded (radar is not stale) */
    isFrameLoaded(ms) {
        if (!this.enabled || !this.map) return true;
        return this.isLoaded(this.frameAt(ms));
    }

    /** True when the frames needed to draw ms (and the next `ahead`) have loaded */
    isReady(ms, ahead = 0) {
        if (!this.enabled || !this.map) return true;
        const [a, b] = this.bracket(ms);
        const last = Math.min(b + ahead * this.step, RadarPlayer.newestFrame());
        for (let f = a; f <= last; f += this.step) {
            if (!this.isLoaded(f)) return false;
        }
        return true;
    }

    /**
     * Draw the radar for time ms: crossfade between the bracketing frames.
     * Frames that have not loaded yet are skipped (the last drawn one stays up).
     * @returns {number|null} the frame that dominates the picture
     */
    render(ms) {
        if (!this.enabled || !this.map) return null;
        const [a, b, f] = this.bracket(ms);
        this.ensure(b === a ? [a] : [a, b]);
        const loadedA = this.isLoaded(a), loadedB = this.isLoaded(b);
        const target = new Map();
        if (loadedA && loadedB && b !== a) {
            // Ease the blend so motion reads smoothly
            const e = f * f * (3 - 2 * f);
            target.set(this.slotFor(a).id, this.opacity * (1 - e));
            target.set(this.slotFor(b).id, this.opacity * e);
            this.dominantFrame = e < 0.5 ? a : b;
        } else if (loadedA) {
            target.set(this.slotFor(a).id, this.opacity);
            this.dominantFrame = a;
        } else if (loadedB) {
            target.set(this.slotFor(b).id, this.opacity);
            this.dominantFrame = b;
        } else {
            return this.dominantFrame; // keep whatever is up until the new frames arrive
        }
        for (const [id, value] of this.shown) {
            if (!target.has(id) && value !== 0) this.map.setPaintProperty(id, 'raster-opacity', 0);
        }
        for (const [id, value] of target) {
            if (this.shown.get(id) !== value) this.map.setPaintProperty(id, 'raster-opacity', value);
        }
        this.shown = target;
        return this.dominantFrame;
    }
}
