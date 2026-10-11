// ============================================================================
// FORMATTERS - Date, time, and data formatting utilities
// ============================================================================

/**
 * Format date for API (YYYYMMDDHH)
 */
export function formatDateForAPI(dateStr, hourStr) {
    const date = dateStr.replace(/-/g, '');
    const hour = hourStr.replace(':', '');
    return date + hour;
}

/**
 * Extract wind speed from remark text for tropical storms
 */
export function extractWindSpeed(remark, defaultMag) {
    if (!remark) return defaultMag;
    const parts = remark.split(" ");
    for (let i = 0; i < parts.length; i++) {
        if (parts[i] === "MPH") {
            return parseFloat(parts[i-1]) || defaultMag;
        } else if (parts[i].indexOf("MPH") !== -1) {
            return parseFloat(parts[i].replace(/\D/g, '')) || defaultMag;
        }
    }
    return defaultMag;
}

/**
 * Detect coastal flooding based on type text or remark content
 */
export function isCoastalFlood(typetext = '', remark = '') {
    const combined = `${typetext || ''} ${remark || ''}`.toUpperCase();
    return combined.includes('COASTAL FLOOD');
}

/**
 * Get unit for report type
 */
export function getUnitForReportType(rtype) {
    const inchTypes = ["R", "S", "s", "H", "5"];
    const mphTypes = ["O", "N", "A", "D", "G", "M", "0", "Q"];
    const tempTypes = ["X"];
    const visibilityTypes = ["J"];
    if (inchTypes.includes(rtype)) return '"';
    if (mphTypes.includes(rtype)) return ' mph';
    if (tempTypes.includes(rtype)) return '°F';
    if (visibilityTypes.includes(rtype)) return ' mi';
    return '';
}

/**
 * Get report type name from rtype code
 */
export function getReportTypeName(rtype, reportTypeMap) {
    return reportTypeMap[rtype] || "Other";
}
