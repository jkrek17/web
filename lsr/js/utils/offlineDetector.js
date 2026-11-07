// ============================================================================
// OFFLINE DETECTOR - Network status monitoring
// ============================================================================

class OfflineDetector {
    constructor() {
        this.isOnline = navigator.onLine !== false;
        this.listeners = [];
        this.setupEventListeners();
    }

    /**
     * Setup online/offline event listeners
     */
    setupEventListeners() {
        window.addEventListener('online', () => {
            this.isOnline = true;
            this.notifyListeners(true);
        });

        window.addEventListener('offline', () => {
            this.isOnline = false;
            this.notifyListeners(false);
        });

        // Also check periodically (some browsers don't fire events reliably)
        setInterval(() => {
            const wasOnline = this.isOnline;
            this.isOnline = navigator.onLine !== false;
            
            if (wasOnline !== this.isOnline) {
                this.notifyListeners(this.isOnline);
            }
        }, 5000);
    }

    /**
     * Add listener for online/offline status changes
     */
    addListener(callback) {
        this.listeners.push(callback);
        return () => {
            this.listeners = this.listeners.filter(cb => cb !== callback);
        };
    }

    /**
     * Notify all listeners
     */
    notifyListeners(isOnline) {
        this.listeners.forEach(callback => {
            try {
                callback(isOnline);
            } catch (e) {
                // Only log in development
                if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
                    console.error('Error in offline detector listener:', e);
                }
            }
        });
    }

    /**
     * Check if currently online
     */
    checkOnline() {
        return navigator.onLine !== false;
    }
}

export const offlineDetector = new OfflineDetector();
