// ============================================================================
// FILTER SERVICE - Marker filtering and performance optimization
// ============================================================================

class FilterService {
    /**
     * Filter and display PNS markers with performance optimizations
     * @param {ReportLayer} pnsLayer - PNS report layer (js/map/reportLayer.js)
     * @param {boolean} showPNS - Whether PNS is enabled
     * @param {Array} allPNSReports - All PNS reports
     * @param {Array} allFilteredReports - All LSR reports
     * @param {maplibregl.Map} map - Map instance
     * @param {Object} CONFIG - Configuration object
     * @param {Function} getZoomBasedLimit - Function to get zoom-based limit
     * @param {Function} updateReportCountWithPNS - Function to update count
     * @param {Function} updateStatisticsWithPNS - Function to update statistics
     */
    filterPNSMarkers(
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
    ) {
        if (!pnsLayer || !showPNS) {
            if (pnsLayer) pnsLayer.clear();
            // Update counts even when PNS is disabled
            if (updateReportCountWithPNS) updateReportCountWithPNS();
            if (updateStatisticsWithPNS) updateStatisticsWithPNS();
            return;
        }
        
        // Get current zoom and bounds for performance filtering
        const currentZoom = map ? map.getZoom() : 4;
        const zoomLimit = getZoomBasedLimit ? getZoomBasedLimit(currentZoom) : undefined;
        const viewportBounds = CONFIG.VIEWPORT_ONLY && currentZoom >= CONFIG.MIN_ZOOM_FOR_VIEWPORT 
            ? map.getBounds() 
            : null;
        
        // Get active filters
        const activeFilters = activeFiltersOverride || Array.from(document.querySelectorAll('input[id^="hidden-filter-"]:checked'))
            .map(cb => cb.value);
        const allWeatherTypes = CONFIG.WEATHER_TYPES || [];
        const allFiltersActive = activeFilters.length === allWeatherTypes.length;
        const noFiltersActive = activeFilters.length === 0;
        
        // Collect all PNS markers that pass filters
        const markersToAdd = [];
        
        // Iterate through all PNS reports
        for (const report of allPNSReports) {
            // If no filters are active, hide all markers
            if (noFiltersActive) {
                continue;
            }
            
            // If all filters are active, show all markers (skip type filtering)
            // Otherwise, filter by weather type
            if (!allFiltersActive) {
                if (!report.filterType || !activeFilters.includes(report.filterType)) {
                    continue;
                }
            }
            
            // Filter by viewport if enabled
            if (viewportBounds && !viewportBounds.contains([report.lon, report.lat])) {
                continue;
            }
            
            // Add marker to queue
            if (report.icon) {
                markersToAdd.push(report);
            }
        }
        
        // Apply zoom-based and MAX_MARKERS limits
        // Calculate remaining slots after LSR markers
        const totalLsrDisplayed = Math.min(
            allFilteredReports.length, 
            zoomLimit !== undefined ? zoomLimit : CONFIG.MAX_MARKERS, 
            CONFIG.MAX_MARKERS
        );
        const remainingMarkerSlots = Math.max(0, CONFIG.MAX_MARKERS - totalLsrDisplayed);
        
        let markersToDisplay = markersToAdd;
        if (zoomLimit !== undefined) {
            // Use zoom limit, but account for LSR markers already displayed
            const pnsZoomLimit = Math.max(0, zoomLimit - totalLsrDisplayed);
            markersToDisplay = markersToAdd.slice(0, pnsZoomLimit);
        } else {
            // Use remaining slots from MAX_MARKERS
            markersToDisplay = markersToAdd.slice(0, remainingMarkerSlots);
        }
        
        pnsLayer.setReports(markersToDisplay);
        
        // Update counts and statistics after filtering
        if (updateReportCountWithPNS) updateReportCountWithPNS();
        if (updateStatisticsWithPNS) updateStatisticsWithPNS();
    }
    
    /**
     * Get filtered PNS reports based on current filters and viewport
     * @param {boolean} showPNS - Whether PNS is enabled
     * @param {Array} allPNSReports - All PNS reports
     * @param {Array} allFilteredReports - All LSR reports
     * @param {maplibregl.Map} map - Map instance
     * @param {Object} CONFIG - Configuration object
     * @param {Function} getZoomBasedLimit - Function to get zoom-based limit
     * @returns {Array} Filtered PNS reports
     */
    getFilteredPNSReports(
        showPNS,
        allPNSReports,
        allFilteredReports,
        map,
        CONFIG,
        getZoomBasedLimit,
        activeFiltersOverride
    ) {
        if (!showPNS) {
            return [];
        }
        
        // Get current zoom and bounds for performance filtering
        const currentZoom = map ? map.getZoom() : 4;
        const zoomLimit = getZoomBasedLimit ? getZoomBasedLimit(currentZoom) : undefined;
        const viewportBounds = CONFIG.VIEWPORT_ONLY && currentZoom >= CONFIG.MIN_ZOOM_FOR_VIEWPORT 
            ? map.getBounds() 
            : null;
        
        // Get active filters
        const activeFilters = activeFiltersOverride || Array.from(document.querySelectorAll('input[id^="hidden-filter-"]:checked'))
            .map(cb => cb.value);
        const allWeatherTypes = CONFIG.WEATHER_TYPES || [];
        const allFiltersActive = activeFilters.length === allWeatherTypes.length;
        const noFiltersActive = activeFilters.length === 0;
        
        // Filter PNS reports by active filters and viewport
        let filteredPNSReports = allPNSReports.filter(report => {
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
        });
        
        // Apply zoom-based and MAX_MARKERS limits
        // Note: PNS limits are calculated after LSR limits to ensure combined total respects MAX_MARKERS
        const totalLsrDisplayed = Math.min(
            allFilteredReports.length, 
            zoomLimit !== undefined ? zoomLimit : CONFIG.MAX_MARKERS, 
            CONFIG.MAX_MARKERS
        );
        const remainingMarkerSlots = Math.max(0, CONFIG.MAX_MARKERS - totalLsrDisplayed);
        
        let pnsReportsToDisplay = filteredPNSReports;
        if (zoomLimit !== undefined) {
            // Use zoom limit, but account for LSR markers already displayed
            const pnsZoomLimit = Math.max(0, zoomLimit - totalLsrDisplayed);
            pnsReportsToDisplay = filteredPNSReports.slice(0, pnsZoomLimit);
        } else {
            // Use remaining slots from MAX_MARKERS
            pnsReportsToDisplay = filteredPNSReports.slice(0, remainingMarkerSlots);
        }
        
        return pnsReportsToDisplay;
    }
}

export default FilterService;
