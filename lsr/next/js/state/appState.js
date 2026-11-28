// ============================================================================
// APP STATE - Centralized state management
// ============================================================================

class AppState {
    constructor() {
        this.state = {
            // Map state
            map: null,
            markersLayer: null,
            pnsLayer: null,
            userArea: null,
            radarLayer: null,
            radarLayers: [],
            radarLayerGroup: null,
            
            // Data state
            allFilteredReports: [],
            lastGeoJsonData: null,
            topReportsByType: {},
            
            // UI state
            showPNS: false,
            liveModeActive: false,
            liveModeInterval: null,
            lastUpdateTime: null,
            radarTimestamps: [],
            radarAnimationIndex: 0,
            radarAnimationPlaying: false,
            radarRefreshInterval: null,
            
            // Filter state
            activeFilters: [],
            selectedRegion: null,
            dateRange: {
                startDate: null,
                startHour: null,
                endDate: null,
                endHour: null
            }
        };
        
        this.listeners = [];
    }

    /**
     * Get state value
     */
    get(path) {
        const keys = path.split('.');
        let value = this.state;
        
        for (const key of keys) {
            if (value === null || value === undefined) {
                return undefined;
            }
            value = value[key];
        }
        
        return value;
    }

    /**
     * Set state value
     */
    set(path, value) {
        const keys = path.split('.');
        const lastKey = keys.pop();
        let target = this.state;
        
        for (const key of keys) {
            if (!target[key] || typeof target[key] !== 'object') {
                target[key] = {};
            }
            target = target[key];
        }
        
        const oldValue = target[lastKey];
        target[lastKey] = value;
        
        // Notify listeners
        this.notifyListeners(path, value, oldValue);
    }

    /**
     * Update multiple state values at once
     */
    update(updates) {
        const changes = {};
        
        for (const [path, value] of Object.entries(updates)) {
            const oldValue = this.get(path);
            this.set(path, value);
            changes[path] = { oldValue, newValue: value };
        }
        
        return changes;
    }

    /**
     * Add state change listener
     */
    subscribe(callback) {
        this.listeners.push(callback);
        return () => {
            this.listeners = this.listeners.filter(cb => cb !== callback);
        };
    }

    /**
     * Notify all listeners of state change
     */
    notifyListeners(path, newValue, oldValue) {
        this.listeners.forEach(callback => {
            try {
                callback(path, newValue, oldValue);
            } catch (e) {
                // Only log in development
                if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
                    console.error('Error in state listener:', e);
                }
            }
        });
    }

    /**
     * Get entire state (for debugging)
     */
    getState() {
        return JSON.parse(JSON.stringify(this.state));
    }
}

export const appState = new AppState();
