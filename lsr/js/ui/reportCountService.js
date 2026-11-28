// ============================================================================
// REPORT COUNT SERVICE - Report count display and performance warnings
// ============================================================================

class ReportCountService {
    /**
     * Update report count display
     * @param {number} count - Current displayed count
     * @param {number|null} totalCount - Total count (optional)
     * @param {number} hiddenCount - Number of hidden markers
     * @param {Function} getZoomBasedLimit - Function to get zoom-based limit
     * @param {maplibregl.Map} map - Map instance
     * @param {Object} CONFIG - Configuration object
     */
    updateReportCount(count, totalCount = null, hiddenCount = 0, getZoomBasedLimit, map, CONFIG) {
        const countEl = document.getElementById('reportCount');
        const performanceBanner = document.getElementById('performanceBanner');
        const performanceBannerText = document.getElementById('performanceBannerText');
        const currentZoom = map ? map.getZoom() : 4;
        const zoomLimit = getZoomBasedLimit ? getZoomBasedLimit(currentZoom) : undefined;
        
        if (!countEl) return;
        
        // Hide empty state if we have reports
        const emptyState = document.getElementById('emptyState');
        if (count > 0 && emptyState) {
            emptyState.style.display = 'none';
        }
        
        if (hiddenCount > 0) {
            // Show warning when markers are limited
            countEl.textContent = `${count.toLocaleString()} displayed`;
            countEl.title = `${hiddenCount.toLocaleString()} markers hidden for performance (zoom in to see more)`;
            countEl.style.color = count >= CONFIG.MAX_MARKERS_WARNING ? '#f59e0b' : 'inherit';
            
            // Show persistent performance banner
            if (performanceBanner && performanceBannerText) {
                const reason = zoomLimit !== undefined 
                    ? `Zoom level ${Math.floor(currentZoom)} limit: ${zoomLimit.toLocaleString()} markers`
                    : `Maximum limit: ${CONFIG.MAX_MARKERS.toLocaleString()} markers`;
                
                performanceBannerText.innerHTML = `
                    <strong>Showing ${count.toLocaleString()} of ${totalCount.toLocaleString()} reports.</strong>
                    ${hiddenCount.toLocaleString()} hidden for performance (${reason}). 
                    <strong>Zoom in to see more markers.</strong>
                `;
                performanceBanner.style.display = 'block';
                performanceBanner.className = 'performance-banner performance-banner-warning';
            }
        } else {
            countEl.textContent = count.toLocaleString();
            countEl.title = '';
            countEl.style.color = 'inherit';
            
            // Hide performance banner when no markers are hidden
            if (performanceBanner) {
                performanceBanner.style.display = 'none';
            }
        }
        
        // Store total count for reference
        if (totalCount !== null) {
            countEl.dataset.totalCount = totalCount;
        }
    }
}

export default ReportCountService;
