// ============================================================================
// WARNINGS SERVICE - NWS Active Alerts/Warnings API
// ============================================================================

import { requestManager } from './requestManager.js';
import { errorHandler, ERROR_TYPES } from '../errors/errorHandler.js';

class WarningsService {
    constructor() {
        this.apiBase = 'https://mesonet.agron.iastate.edu/api/1/vtec/county_zone.geojson';
        this.cache = new Map(); // Simple in-memory cache
        this.cacheTTL = 30000; // 30 seconds
        this.pending = new Map(); // Deduplicate in-flight requests
    }

    /**
     * Fetch active warnings for a geographic area
     * @param {Object} bounds - Map bounds {north, south, east, west}
     * @returns {Promise<Array>} Array of alert features
     */
    async fetchActiveWarnings(bounds) {
        // Use the center point of the viewport for API query
        const centerLat = (bounds.north + bounds.south) / 2;
        const centerLon = (bounds.east + bounds.west) / 2;
        
        const cacheKey = `${centerLat.toFixed(2)},${centerLon.toFixed(2)}`;
        const cached = this.cache.get(cacheKey);
        
        if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
            return cached.data;
        }

        if (this.pending.has(cacheKey)) {
            return this.pending.get(cacheKey);
        }

        const fetchPromise = (async () => {
            try {
            // Fetch current county/zone warnings (IEM VTEC service)
            const url = this.apiBase;
                
                const response = await requestManager.fetchWithRetry(url, {
                headers: {
                    'Accept': 'application/geo+json'
                }
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

            const data = await response.json();
                
            // Filter alerts to only those within viewport bounds
            const filteredAlerts = this.filterAlertsByBounds(data.features || [], bounds);
                
                // Cache the result
                this.cache.set(cacheKey, {
                    data: filteredAlerts,
                    timestamp: Date.now()
                });
                
                return filteredAlerts;
            } catch (error) {
            const handledError = errorHandler.handleError(error, 'Fetch IEM Warnings');
            errorHandler.log('Failed to fetch IEM warnings', handledError.originalError);
                return [];
            } finally {
                this.pending.delete(cacheKey);
            }
        })();

        this.pending.set(cacheKey, fetchPromise);
        return fetchPromise;
    }

    /**
     * Filter alerts to only those that intersect with viewport bounds
     */
    filterAlertsByBounds(features, bounds) {
        return features.filter(feature => {
            if (!feature.geometry) return false;
            
            const geom = feature.geometry;
            
            // Handle Point geometry
            if (geom.type === 'Point') {
                const [lon, lat] = geom.coordinates;
                return lat >= bounds.south && lat <= bounds.north &&
                       lon >= bounds.west && lon <= bounds.east;
            }
            
            // Handle Polygon geometry
            if (geom.type === 'Polygon') {
                return this.polygonIntersectsBounds(geom.coordinates[0], bounds);
            }
            
            // Handle MultiPolygon geometry
            if (geom.type === 'MultiPolygon') {
                return geom.coordinates.some(polygon => 
                    this.polygonIntersectsBounds(polygon[0], bounds)
                );
            }
            
            return true; // Include other geometry types
        });
    }

    /**
     * Check if polygon intersects with bounds
     */
    polygonIntersectsBounds(polygonCoords, bounds) {
        // Simple check: if any vertex is within bounds, include it
        return polygonCoords.some(([lon, lat]) => {
            return lat >= bounds.south && lat <= bounds.north &&
                   lon >= bounds.west && lon <= bounds.east;
        });
    }

    /**
     * Get alert severity color
     */
    getSeverityColor(severity) {
        const colors = {
            'Extreme': '#8B0000',      // Dark red
            'Severe': '#FF0000',       // Red
            'Moderate': '#FF8C00',     // Dark orange
            'Minor': '#FFD700',        // Gold
            'Unknown': '#808080'       // Gray
        };
        return colors[severity] || colors['Unknown'];
    }

    /**
     * Get alert category icon/emoji
     */
    getCategoryIcon(category) {
        const icons = {
            'Met': '🌩️',
            'Marine': '🌊',
            'Fire': '🔥',
            'Public': '⚠️',
            'Other': '📢'
        };
        return icons[category] || '⚠️';
    }

    /**
     * Clear cache
     */
    clearCache() {
        this.cache.clear();
    }
}

export default WarningsService;
