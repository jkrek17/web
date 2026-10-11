// ============================================================================
// POPUP SERVICE - Map popup content generation
// ============================================================================

/**
 * Create popup HTML content for a report
 */
export function createPopupContent(report) {
    const { category, magnitude, unit, remark, location, time, rtype } = report;
    
    return `
        <div class="popup-header" data-type="${rtype}">
            <div class="popup-title">
                <div class="popup-category">${category}</div>
                ${magnitude ? `<div class="popup-magnitude">${magnitude}${unit}</div>` : ''}
            </div>
        </div>
        <div class="popup-body">
            ${remark ? `
                <div class="popup-field">
                    <i class="fas fa-comment-alt"></i>
                    <div class="popup-field-content">
                        <span class="popup-label">Remarks:</span>
                        <span class="popup-value">${escapeHtml(remark)}</span>
                    </div>
                </div>
            ` : ''}
            ${location ? `
                <div class="popup-field">
                    <i class="fas fa-map-marker-alt"></i>
                    <div class="popup-field-content">
                        <span class="popup-label">Location:</span>
                        <span class="popup-value">${escapeHtml(location)}</span>
                    </div>
                </div>
            ` : ''}
            ${time ? `
                <div class="popup-field">
                    <i class="fas fa-clock"></i>
                    <div class="popup-field-content">
                        <span class="popup-label">Time:</span>
                        <span class="popup-value">${escapeHtml(time)}</span>
                    </div>
                </div>
            ` : ''}
        </div>
    `;
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
