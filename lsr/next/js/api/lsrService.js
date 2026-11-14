// ============================================================================
// LSR SERVICE - NWS Local Storm Reports API service
// ============================================================================

import { requestManager } from './requestManager.js';
import { cacheService } from '../cache/cacheService.js';
import { errorHandler, ERROR_TYPES } from '../errors/errorHandler.js';
import { formatDateForAPI } from '../utils/formatters.js';

// Console logging styles for data fetching feedback
const LOG_STYLES = {
    cache: 'background: #10b981; color: white; padding: 2px 6px; border-radius: 3px; font-weight: bold;',
    serverCache: 'background: #3b82f6; color: white; padding: 2px 6px; border-radius: 3px; font-weight: bold;',
    api: 'background: #f59e0b; color: white; padding: 2px 6px; border-radius: 3px; font-weight: bold;',
    fallback: 'background: #ef4444; color: white; padding: 2px 6px; border-radius: 3px; font-weight: bold;',
    info: 'color: #6b7280;',
    count: 'color: #8b5cf6; font-weight: bold;',
    time: 'color: #06b6d4;'
};

class LSRService {
    constructor(config) {
        this.config = config;
        this.sourceAPIBase = 'https://mesonet.agron.iastate.edu/geojson/lsr.php';
        this.cacheAPIBase = 'api/cache.php';
        this.enableLogging = true; // Set to false to disable console output
    }

    /**
     * Log data fetch information to console
     */
    logFetch(source, details = {}) {
        if (!this.enableLogging) return;

        const { features = 0, duration = 0, dateRange = '', reason = '', fallbackFrom = '' } = details;
        
        const sourceLabels = {
            'localStorage': ['📦 LOCALSTORAGE', LOG_STYLES.cache],
            'serverCache': ['🗄️ SERVER CACHE', LOG_STYLES.serverCache],
            'sourceAPI': ['🌐 SOURCE API', LOG_STYLES.api],
            'fallback': ['⚠️ FALLBACK', LOG_STYLES.fallback]
        };

        const [label, style] = sourceLabels[source] || ['❓ UNKNOWN', LOG_STYLES.info];

        console.groupCollapsed(`%c${label}%c ${features} reports ${duration ? `(${duration}ms)` : ''}`, style, LOG_STYLES.count);
        
        if (dateRange) {
            console.log(`%c📅 Date range:%c ${dateRange}`, LOG_STYLES.info, '');
        }
        if (reason) {
            console.log(`%c💡 Reason:%c ${reason}`, LOG_STYLES.info, '');
        }
        if (fallbackFrom) {
            console.log(`%c🔄 Fallback from:%c ${fallbackFrom}`, LOG_STYLES.info, '');
        }
        if (duration) {
            console.log(`%c⏱️ Duration:%c ${duration}ms`, LOG_STYLES.info, LOG_STYLES.time);
        }
        
        console.groupEnd();
    }

    /**
     * Fetch LSR data with caching and retry logic
     */
    async fetchLSRData(params) {
        const {
            startDate,
            startHour,
            endDate,
            endHour,
            useCache = true
        } = params;

        const startTime = performance.now();
        const dateRange = `${startDate} ${startHour} → ${endDate} ${endHour}`;
        const startString = formatDateForAPI(startDate, startHour);
        const endString = formatDateForAPI(endDate, endHour);

        // Insert colon into HHMM format for ISO Date parsing (e.g. "1044" -> "10:44")
        const fmtHour = (h) => h.includes(':') ? h : h.slice(0, 2) + ':' + h.slice(2);

        // Determine which API to use
        const endDateTime = new Date(endDate + 'T' + fmtHour(endHour));
        const startDateTime = new Date(startDate + 'T' + fmtHour(startHour));
        const now = new Date();
        
        // If query includes today or future dates, use source API directly for real-time data
        // Today's data won't be in the cache (it's still accumulating)
        // This matches the cache.php routing logic
        const today = now.toISOString().split('T')[0]; // 'YYYY-MM-DD'
        const includesCurrentDay = endDate >= today;


        // Use cache API only if:
        // 1. Server cache is enabled in config (USE_SERVER_CACHE)
        // 2. Cache is enabled for this request
        // 3. End date is within last CACHE_DAYS (matches api/config.php and cache.php)
        // 4. Query does NOT include today (cache.php proxies to source anyway)
        const serverCacheEnabled = typeof CONFIG !== 'undefined' && CONFIG.USE_SERVER_CACHE !== false;
        const cacheDays = (this.config && this.config.CACHE_DAYS) || 30;
        const cacheCutoff = new Date();
        cacheCutoff.setDate(cacheCutoff.getDate() - cacheDays);
        const shouldUseCache = serverCacheEnabled && useCache && endDateTime >= cacheCutoff && !includesCurrentDay;

        // Determine reason for cache decision
        let cacheDecisionReason = '';
        if (!useCache) {
            cacheDecisionReason = 'Cache disabled by caller';
        } else if (includesCurrentDay) {
            cacheDecisionReason = 'Query includes today (real-time data needed)';
        } else if (endDateTime < cacheCutoff) {
            cacheDecisionReason = 'Query older than cache window (outside cache window)';
        } else if (shouldUseCache) {
            cacheDecisionReason = 'Historical data within cache window';
        }

        // Generate cache key
        const cacheKey = cacheService.generateCacheKey({
            type: 'lsr',
            startString,
            endString,
            useCache: shouldUseCache
        });

        // Check localStorage cache first
        const cached = cacheService.get(cacheKey);
        if (cached) {
            cached._cached = true;
            const duration = Math.round(performance.now() - startTime);
            this.logFetch('localStorage', {
                features: cached.features?.length || 0,
                duration,
                dateRange,
                reason: 'Found in browser localStorage (5-min TTL)'
            });
            return cached;
        }

        // Fetch from API
        let data;
        if (shouldUseCache) {
            // Use server cache API
            const url = `${this.cacheAPIBase}?start=${startDate}&startHour=${startHour}&end=${endDate}&endHour=${endHour}`;
            
            try {
                const response = await requestManager.fetchWithRetry(url, {
                    headers: { 'Accept': 'application/json' }
                });

                const contentType = response.headers.get('content-type') || '';
                if (contentType.includes('text/html') || contentType.includes('text/plain')) {
                    throw new Error('Cache API returned non-JSON response');
                }

                const text = await response.text();
                
                // Check for PHP execution issues
                if (text.trim().startsWith('<?php')) {
                    throw new Error('PHP cache endpoint not executing');
                }

                data = JSON.parse(text);
                
                // Check if server is telling us to use source API fallback
                if (data.useJsonp) {
                    errorHandler.log('Cache API recommends source API fallback', data.error);
                    return this.fetchFromSourceAPI(startString, endString, cacheKey);
                }

                // Check if response has an error but no features
                if (data.error && (!data.features || data.features.length === 0)) {
                    errorHandler.log('Cache API error, using source API fallback', data.error);
                    return this.fetchFromSourceAPI(startString, endString, cacheKey);
                }
            } catch (error) {
                // Fallback to source API
                const isPHPError = error.message && error.message.includes('PHP');
                if (!isPHPError) {
                    errorHandler.log('Data fetch failed, using alternative source', error);
                }
                return this.fetchFromSourceAPI(startString, endString, cacheKey, {
                    dateRange,
                    fallbackFrom: 'Server cache',
                    fallbackReason: error.message
                });
            }
        } else {
            // Use source API directly
            return this.fetchFromSourceAPI(startString, endString, cacheKey, {
                dateRange,
                reason: cacheDecisionReason
            });
        }

        // Cache successful response in localStorage
        if (data && data.features) {
            cacheService.set(cacheKey, data, 5 * 60 * 1000); // 5 minute TTL
        }

        return data;
    }

    /**
     * Fetch from source API using fetch()
     */
    async fetchFromSourceAPI(startString, endString, cacheKey, logDetails = {}) {
        const url = `${this.sourceAPIBase}?sts=${startString}&ets=${endString}&wfos=`;
        const startTime = performance.now();

        try {
            const response = await requestManager.fetchWithRetry(url, {
                headers: { 'Accept': 'application/json' }
            });
            const data = await response.json();
            const duration = Math.round(performance.now() - startTime);
            
            // Log the fetch
            if (logDetails.fallbackFrom) {
                this.logFetch('fallback', {
                    features: data.features?.length || 0,
                    duration,
                    dateRange: logDetails.dateRange,
                    reason: logDetails.fallbackReason || 'Server cache unavailable',
                    fallbackFrom: logDetails.fallbackFrom
                });
            } else {
                this.logFetch('sourceAPI', {
                    features: data.features?.length || 0,
                    duration,
                    dateRange: logDetails.dateRange,
                    reason: logDetails.reason || 'Direct API fetch'
                });
            }
            
            // Cache successful response in localStorage
            if (data && data.features) {
                cacheService.set(cacheKey, data, 5 * 60 * 1000);
            }
            
            return data;
        } catch (error) {
            const handledError = errorHandler.handleError(error, 'Source API fetch');
            console.error('❌ LSR fetch failed:', handledError.message);
            throw handledError;
        }
    }

    /**
     * Enable or disable console logging
     */
    setLogging(enabled) {
        this.enableLogging = enabled;
    }
}

export default LSRService;
