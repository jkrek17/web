// ============================================================================
// REQUEST MANAGER - Request deduplication, cancellation, and retry logic
// ============================================================================

import { errorHandler, ERROR_TYPES } from '../errors/errorHandler.js';

class RequestManager {
    constructor() {
        this.pendingRequests = new Map(); // url -> { abortController, promise }
        this.retryConfig = {
            maxRetries: 3,
            baseDelay: 1000, // 1 second
            maxDelay: 10000 // 10 seconds
        };
        
        // SSRF Protection: Allowlist of permitted URL patterns
        // Only these patterns are allowed for fetch requests
        this.allowedUrlPatterns = [
            // Local API endpoints (relative URLs)
            /^api\/cache\.php(\?.*)?$/,
            /^api\/cleanup-cache\.php(\?.*)?$/,
            /^api\/update-cache\.php(\?.*)?$/,
            // Local data files
            /^data\/[a-zA-Z0-9_-]+\.geojson$/,
            // Trusted external APIs
            /^https:\/\/mesonet\.agron\.iastate\.edu\/geojson\/lsr\.php(\?.*)?$/, // Iowa State Mesonet
            /^https:\/\/mesonet\.agron\.iastate\.edu\/api\/1\/vtec\/county_zone\.geojson(\?.*)?$/, // IEM active warnings/watches
            /^https:\/\/mesonet\.agron\.iastate\.edu\/api\/1\/vtec\/sbw_interval\.geojson(\?.*)?$/, // IEM storm-based warning archive
            /^https:\/\/api\.weather\.gov\/products(\/types\/PNS|\/[A-Za-z0-9-]+)?$/ // NWS Weather API
        ];
    }

    /**
     * Validate URL against allowlist to prevent SSRF attacks
     * @param {string} url - The URL to validate
     * @returns {boolean} - True if URL is allowed, false otherwise
     */
    isUrlAllowed(url) {
        // Normalize URL - remove leading slash if present for relative URLs
        const normalizedUrl = url.startsWith('/') ? url.slice(1) : url;
        
        // Check against allowlist patterns
        return this.allowedUrlPatterns.some(pattern => pattern.test(normalizedUrl));
    }

    /**
     * Add a URL pattern to the allowlist
     * @param {RegExp} pattern - The regex pattern to allow
     */
    addAllowedPattern(pattern) {
        if (pattern instanceof RegExp) {
            this.allowedUrlPatterns.push(pattern);
        }
    }

    /**
     * Generate request key from parameters
     */
    generateRequestKey(url, options = {}) {
        return `${url}_${JSON.stringify(options)}`;
    }

    /**
     * Exponential backoff delay
     */
    getRetryDelay(attempt) {
        const delay = Math.min(
            this.retryConfig.baseDelay * Math.pow(2, attempt),
            this.retryConfig.maxDelay
        );
        // Add jitter using crypto.getRandomValues() for secure randomness
        const randomArray = new Uint32Array(1);
        crypto.getRandomValues(randomArray);
        const jitter = (randomArray[0] / 0xFFFFFFFF) * 1000; // Normalize to 0-1000ms
        return delay + jitter;
    }

    /**
     * Check if request should be retried
     */
    shouldRetry(error, attempt) {
        if (attempt >= this.retryConfig.maxRetries) return false;
        
        // Retry on network errors and timeouts
        if (error.type === ERROR_TYPES.NETWORK || error.type === ERROR_TYPES.TIMEOUT) {
            return true;
        }
        
        // Retry on 5xx server errors, but NOT 502 Bad Gateway
        // 502 means upstream is unavailable - retrying won't help, fallback instead
        if (error.originalError && error.originalError.status >= 500) {
            // Don't retry 502 (Bad Gateway) or 503 (Service Unavailable) - fail fast to trigger fallback
            if (error.originalError.status === 502 || error.originalError.status === 503) {
                return false;
            }
            return true;
        }
        
        return false;
    }

    /**
     * Fetch with retry logic
     */
    async fetchWithRetry(url, options = {}, attempt = 0) {
        // SSRF Protection: Validate URL against allowlist before making request
        if (!this.isUrlAllowed(url)) {
            const error = new Error(`Request blocked: URL not in allowlist - ${url}`);
            error.type = 'SSRF_BLOCKED';
            throw errorHandler.handleError(error, 'SSRF Protection');
        }
        
        const abortController = new AbortController();
        const requestKey = this.generateRequestKey(url, options);
        
        // Check for duplicate request
        if (this.pendingRequests.has(requestKey)) {
            const pending = this.pendingRequests.get(requestKey);
            return pending.promise.then(response => response.clone());
        }

        const fetchPromise = (async () => {
            try {
                const response = await fetch(url, {
                    ...options,
                    signal: abortController.signal
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                // Remove from pending on success
                this.pendingRequests.delete(requestKey);
                return response;
            } catch (error) {
                // Handle abort
                if (error.name === 'AbortError') {
                    this.pendingRequests.delete(requestKey);
                    throw error;
                }

                const handledError = errorHandler.handleError(error, `Request attempt ${attempt + 1}`);
                
                // Retry logic
                if (this.shouldRetry(handledError, attempt)) {
                    const delay = this.getRetryDelay(attempt);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    return this.fetchWithRetry(url, options, attempt + 1);
                }

                // Remove from pending on final failure
                this.pendingRequests.delete(requestKey);
                throw handledError;
            }
        })();

        // Store request for deduplication
        this.pendingRequests.set(requestKey, {
            abortController,
            promise: fetchPromise
        });

        return fetchPromise.then(response => response.clone());
    }

    /**
     * Cancel pending request
     */
    cancelRequest(url, options = {}) {
        const requestKey = this.generateRequestKey(url, options);
        const pending = this.pendingRequests.get(requestKey);
        
        if (pending) {
            pending.abortController.abort();
            this.pendingRequests.delete(requestKey);
            return true;
        }
        
        return false;
    }

    /**
     * Cancel all pending requests
     */
    cancelAll() {
        this.pendingRequests.forEach(({ abortController }) => {
            abortController.abort();
        });
        this.pendingRequests.clear();
    }

    /**
     * Get pending request count
     */
    getPendingCount() {
        return this.pendingRequests.size;
    }
}

export const requestManager = new RequestManager();
