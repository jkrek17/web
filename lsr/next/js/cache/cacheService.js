// ============================================================================
// CACHE SERVICE - Client-side caching with localStorage
// ============================================================================

const CACHE_PREFIX = 'lsr_cache_';
const CACHE_VERSION = '1.0';
const DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes

class CacheService {
    constructor() {
        this.maxCacheSize = 10 * 1024 * 1024; // 10MB limit
        this.checkStorageAvailable();
    }

    /**
     * Check if localStorage is available
     */
    checkStorageAvailable() {
        try {
            const test = '__storage_test__';
            localStorage.setItem(test, test);
            localStorage.removeItem(test);
            this.storageAvailable = true;
        } catch (e) {
            this.storageAvailable = false;
        }
    }

    /**
     * Generate cache key from parameters
     */
    generateCacheKey(params) {
        const keyString = JSON.stringify(params);
        // Simple hash function
        let hash = 0;
        for (let i = 0; i < keyString.length; i++) {
            const char = keyString.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return `${CACHE_PREFIX}${Math.abs(hash)}`;
    }

    /**
     * Get cached data
     */
    get(key) {
        if (!this.storageAvailable) return null;

        try {
            const cached = localStorage.getItem(key);
            if (!cached) return null;

            const { data, timestamp, ttl } = JSON.parse(cached);
            const now = Date.now();

            // Check if expired
            if (now - timestamp > ttl) {
                this.remove(key);
                return null;
            }

            return data;
        } catch (e) {
            // Invalid cache entry, remove it
            this.remove(key);
            return null;
        }
    }

    /**
     * Set cached data
     */
    set(key, data, ttl = DEFAULT_TTL) {
        if (!this.storageAvailable) return false;

        try {
            const cacheEntry = {
                data,
                timestamp: Date.now(),
                ttl,
                version: CACHE_VERSION
            };

            const serialized = JSON.stringify(cacheEntry);
            const size = new Blob([serialized]).size;

            // Check if adding this would exceed limit
            if (this.getCacheSize() + size > this.maxCacheSize) {
                this.cleanup();
            }

            localStorage.setItem(key, serialized);
            return true;
        } catch (e) {
            // Quota exceeded or other error
            if (e.name === 'QuotaExceededError') {
                this.cleanup();
                try {
                    localStorage.setItem(key, JSON.stringify({
                        data,
                        timestamp: Date.now(),
                        ttl,
                        version: CACHE_VERSION
                    }));
                    return true;
                } catch (e2) {
                    return false;
                }
            }
            return false;
        }
    }

    /**
     * Remove cached data
     */
    remove(key) {
        if (!this.storageAvailable) return;
        try {
            localStorage.removeItem(key);
        } catch (e) {
            // Ignore errors
        }
    }

    /**
     * Clear all cache entries
     */
    clear() {
        if (!this.storageAvailable) return;
        
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(CACHE_PREFIX)) {
                keysToRemove.push(key);
            }
        }
        
        keysToRemove.forEach(key => localStorage.removeItem(key));
    }

    /**
     * Get total cache size
     */
    getCacheSize() {
        if (!this.storageAvailable) return 0;
        
        let size = 0;
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(CACHE_PREFIX)) {
                try {
                    const value = localStorage.getItem(key);
                    size += new Blob([value]).size;
                } catch (e) {
                    // Ignore
                }
            }
        }
        return size;
    }

    /**
     * Cleanup expired and old entries
     */
    cleanup() {
        if (!this.storageAvailable) return;

        const now = Date.now();
        const entries = [];
        const keysToRemove = [];

        // Collect all cache entries
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(CACHE_PREFIX)) {
                try {
                    const cached = localStorage.getItem(key);
                    const { timestamp, ttl } = JSON.parse(cached);
                    
                    if (now - timestamp > ttl) {
                        keysToRemove.push(key);
                    } else {
                        entries.push({ key, timestamp });
                    }
                } catch (e) {
                    keysToRemove.push(key);
                }
            }
        }

        // Remove expired entries
        keysToRemove.forEach(key => localStorage.removeItem(key));

        // If still over limit, remove oldest entries
        if (this.getCacheSize() > this.maxCacheSize) {
            entries.sort((a, b) => a.timestamp - b.timestamp);
            const toRemove = Math.ceil(entries.length * 0.3); // Remove 30% oldest
            for (let i = 0; i < toRemove; i++) {
                localStorage.removeItem(entries[i].key);
            }
        }
    }
}

export const cacheService = new CacheService();
