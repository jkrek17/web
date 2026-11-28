// ============================================================================
// ICON SERVICE - Map marker icon creation
// ============================================================================
//
// Icons are plain descriptors ({ id, shape, fill, border, ... }). The map draws
// each distinct descriptor once onto a canvas and registers it as a MapLibre
// image, so thousands of reports share a handful of GPU textures.

import { isCoastalFlood } from '../utils/formatters.js';

const iconCache = new Map();

/** Every descriptor handed out, by image id, so the map can draw any it is missing */
const iconRegistry = new Map();

/** Room around the shape for the drop shadow (CSS: 0 2px 4px) */
const SHADOW_PAD = 6;
const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Segoe UI Symbol", sans-serif';

function register(icon) {
    iconRegistry.set(icon.id, icon);
    return icon;
}

/**
 * Create a generic icon based on configuration
 */
export function createIcon(config, fillColor, strokeColor, emoji = null, iconSize, borderColor = null) {
    const shape = config.type === "rect" ? "rect" : "circle";
    // Use borderColor if provided, otherwise use strokeColor
    const finalBorderColor = borderColor || strokeColor;
    // If borderColor is provided, use a thicker border (3px) to make it more visible
    const borderWidth = borderColor ? 3 : 2;
    const id = ['icon', shape, iconSize, fillColor, finalBorderColor, borderWidth, emoji || ''].join('|');

    return register({
        id,
        shape,
        fill: fillColor,
        border: finalBorderColor,
        borderWidth,
        emoji: emoji || '',
        size: iconSize,
        shadow: 'rgba(0,0,0,0.3)'
    });
}

/**
 * Generic Public Information Statement icon (office location, no report type)
 */
export function createPnsOfficeIcon() {
    return register({
        id: 'icon|pns-office',
        shape: 'circle',
        fill: ['#3b82f6', '#1d4ed8'], // 135deg gradient, as the old .pns-marker-inner
        border: '#ffffff',
        borderWidth: 2,
        emoji: '📋',
        size: 32,
        shadow: 'rgba(59,130,246,0.4)'
    });
}

/**
 * Round alert marker (warning/watch point geometry): colored disc with an emoji
 */
export function createAlertIcon(color, emoji) {
    return register({
        id: ['icon', 'alert', color, emoji || ''].join('|'),
        shape: 'circle',
        fill: color,
        border: color,
        borderWidth: 0,
        emoji: emoji || '',
        emojiSize: 14,
        size: 24,
        shadow: 'rgba(0,0,0,0.3)'
    });
}

function shapePath(ctx, shape, x, y, size) {
    ctx.beginPath();
    if (shape === 'rect') {
        ctx.rect(x, y, size, size);
    } else {
        ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    }
}

/**
 * Draw an icon descriptor (CSS border-box semantics: size includes the border).
 * @returns {ImageData}
 */
export function drawIcon(icon, pixelRatio = 2) {
    const total = icon.size + SHADOW_PAD * 2;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = Math.ceil(total * pixelRatio);
    const ctx = canvas.getContext('2d');
    ctx.scale(pixelRatio, pixelRatio);
    const o = SHADOW_PAD;

    // Border (outer shape) with drop shadow
    ctx.save();
    ctx.shadowColor = icon.shadow;
    ctx.shadowBlur = 4 * pixelRatio;
    ctx.shadowOffsetY = 2 * pixelRatio;
    shapePath(ctx, icon.shape, o, o, icon.size);
    ctx.fillStyle = icon.border;
    ctx.fill();
    ctx.restore();

    // Fill (inner shape)
    const bw = icon.borderWidth;
    const inner = icon.size - bw * 2;
    shapePath(ctx, icon.shape, o + bw, o + bw, inner);
    if (Array.isArray(icon.fill)) {
        const g = ctx.createLinearGradient(o, o, o + icon.size, o + icon.size);
        g.addColorStop(0, icon.fill[0]);
        g.addColorStop(1, icon.fill[1]);
        ctx.fillStyle = g;
    } else {
        ctx.fillStyle = icon.fill;
    }
    ctx.fill();

    if (icon.emoji) {
        ctx.font = `${icon.emojiSize || 16}px ${EMOJI_FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(icon.emoji, o + icon.size / 2, o + icon.size / 2 + 1);
    }
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function iconPixelRatio() {
    return Math.min(3, Math.max(2, Math.ceil(window.devicePixelRatio || 1)));
}

/**
 * Make sure the map has an image for this icon descriptor.
 */
export function ensureIconImage(map, icon) {
    if (!icon || map.hasImage(icon.id)) {
        return;
    }
    const pr = iconPixelRatio();
    map.addImage(icon.id, drawIcon(icon, pr), { pixelRatio: pr });
}

/**
 * Draw icons on demand when a layer references one the map does not have yet
 * (also covers the style being reloaded).
 */
export function installIconImageHandler(map) {
    map.on('styleimagemissing', (e) => {
        const icon = iconRegistry.get(e.id);
        if (icon) {
            ensureIconImage(map, icon);
        }
    });
}

/**
 * Get icon based on report type and magnitude
 */
export function getIconForReport(rtype, magnitude, remark, iconConfig, iconSize, extractWindSpeedFn, typetext = '') {
    const mag = parseFloat(magnitude) || 0;
    const config = iconConfig[rtype];
    const upperTypetext = (typetext || '').toUpperCase();
    const isCoastalFloodReport = ['F', 'E', 'v'].includes(rtype) && isCoastalFlood(typetext, remark);
    const emojiOverride = isCoastalFloodReport ? '🌊' : null;
    
    // Differentiate freezing rain from ice/sleet
    const isFreezingRain = upperTypetext.includes('FREEZING RAIN') ||
        upperTypetext.includes('FREEZING_RAIN') ||
        upperTypetext.includes('FREEZING DRIZZLE') ||
        upperTypetext.includes('FREEZING_DRIZZLE') ||
        upperTypetext.includes('FZRA');
    let borderColor = isFreezingRain ? '#2563eb' : null; // Blue border for freezing rain
    const configToUse = isFreezingRain && config
        ? { ...config, type: 'rect', emoji: '🌧️' }
        : config;
    
    if (!configToUse) {
        const fallbackKey = `unknown|${iconSize}|${borderColor || 'none'}|circle|⚠️`;
        if (iconCache.has(fallbackKey)) {
            return iconCache.get(fallbackKey);
        }
        const fallbackIcon = createIcon({ type: "circle" }, "#1f2937", "#fff", "⚠️", iconSize, borderColor);
        iconCache.set(fallbackKey, fallbackIcon);
        return fallbackIcon;
    }

    const emojiToUse = emojiOverride || configToUse.emoji;
    
    // Special cases with fixed icons
    if (configToUse.fill && !configToUse.thresholds) {
        const fixedKey = [
            rtype || 'unknown',
            iconSize,
            borderColor || 'none',
            configToUse.type,
            configToUse.fill,
            configToUse.stroke,
            emojiToUse || ''
        ].join('|');
        if (iconCache.has(fixedKey)) {
            return iconCache.get(fixedKey);
        }
        const fixedIcon = createIcon(configToUse, configToUse.fill, configToUse.stroke, emojiToUse, iconSize, borderColor);
        iconCache.set(fixedKey, fixedIcon);
        return fixedIcon;
    }
    
    // Cases with magnitude-based thresholds
    if (configToUse.thresholds) {
        let magnitudeToUse = mag;
        
        // Extract wind speed from remark for tropical storms
        if (configToUse.extractWindFromRemark) {
            magnitudeToUse = extractWindSpeedFn(remark, mag);
        }
        
        // Find the appropriate threshold
        for (let i = 0; i < configToUse.thresholds.length; i++) {
            const threshold = configToUse.thresholds[i];
            if (magnitudeToUse < threshold.max) {
                const thresholdKey = [
                    rtype || 'unknown',
                    iconSize,
                    borderColor || 'none',
                    configToUse.type,
                    emojiToUse || '',
                    i,
                    threshold.fill,
                    threshold.stroke
                ].join('|');
                if (iconCache.has(thresholdKey)) {
                    return iconCache.get(thresholdKey);
                }
                const thresholdIcon = createIcon(configToUse, threshold.fill, threshold.stroke, emojiToUse, iconSize, borderColor);
                iconCache.set(thresholdKey, thresholdIcon);
                return thresholdIcon;
            }
        }
    }
    
    // Fallback
    const fallbackKey = [
        rtype || 'unknown',
        iconSize,
        borderColor || 'none',
        configToUse.type,
        'fallback'
    ].join('|');
    if (iconCache.has(fallbackKey)) {
        return iconCache.get(fallbackKey);
    }
    const fallbackIcon = createIcon(configToUse, "#1f2937", "#fff", "⚠️", iconSize, borderColor);
    iconCache.set(fallbackKey, fallbackIcon);
    return fallbackIcon;
}
