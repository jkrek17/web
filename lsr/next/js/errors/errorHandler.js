// ============================================================================
// ERROR HANDLER - Centralized error handling and logging
// ============================================================================

const ERROR_TYPES = {
    NETWORK: 'NETWORK',
    TIMEOUT: 'TIMEOUT',
    API: 'API',
    PARSE: 'PARSE',
    UNKNOWN: 'UNKNOWN'
};

class ErrorHandler {
    constructor() {
        this.isProduction = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
        this.errorLog = [];
    }

    /**
     * Log error (only in development)
     */
    log(message, error = null, type = ERROR_TYPES.UNKNOWN) {
        const errorEntry = {
            timestamp: new Date().toISOString(),
            message,
            type,
            error: error ? {
                name: error.name,
                message: error.message,
                stack: error.stack
            } : null
        };

        this.errorLog.push(errorEntry);
        
        // Keep only last 50 errors
        if (this.errorLog.length > 50) {
            this.errorLog.shift();
        }

        // Only log to console in development
        if (!this.isProduction) {
            console.error(`[${type}] ${message}`, error || '');
        }
    }

    /**
     * Handle error and return user-friendly message
     */
    handleError(error, context = '') {
        let type = ERROR_TYPES.UNKNOWN;
        let userMessage = 'An unexpected error occurred.';

        if (error instanceof TypeError && error.message.includes('fetch')) {
            type = ERROR_TYPES.NETWORK;
            userMessage = 'Network error. Please check your internet connection.';
        } else if (error.name === 'TimeoutError' || error.message.includes('timeout')) {
            type = ERROR_TYPES.TIMEOUT;
            userMessage = 'Request timed out. Please try again.';
        } else if (error.message.includes('JSONP')) {
            type = ERROR_TYPES.NETWORK;
            userMessage = 'Failed to load data from external service.';
        } else if (error.message.includes('JSON') || error.message.includes('parse')) {
            type = ERROR_TYPES.PARSE;
            userMessage = 'Failed to parse server response.';
        } else if (error.message) {
            userMessage = error.message;
        }

        this.log(`${context}: ${userMessage}`, error, type);
        
        return {
            type,
            message: userMessage,
            originalError: error
        };
    }

    /**
     * Get error log for debugging
     */
    getErrorLog() {
        return [...this.errorLog];
    }

    /**
     * Clear error log
     */
    clearErrorLog() {
        this.errorLog = [];
    }
}

export const errorHandler = new ErrorHandler();
export { ERROR_TYPES };
