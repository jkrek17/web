// ============================================================================
// TOAST SERVICE - Status notifications with retry support
// ============================================================================

let lastErrorAction = null;
let currentToastTimeout = null;

export function showStatusToast(message, type = 'info', retryAction = null) {
    const toast = document.getElementById('statusToast');
    const toastMessage = document.getElementById('statusToastMessage');
    
    if (!toast || !toastMessage) return;
    
    // Clear any existing timeout to prevent premature hide
    if (currentToastTimeout) {
        clearTimeout(currentToastTimeout);
        currentToastTimeout = null;
    }
    
    // Clear any existing retry button
    const existingRetry = toast.querySelector('.toast-retry');
    if (existingRetry) existingRetry.remove();
    
    toastMessage.textContent = message;
    toast.className = `status-toast ${type}`;
    toast.style.display = 'flex';
    
    // Add retry button for errors with retry action
    if (type === 'error' && retryAction) {
        lastErrorAction = retryAction;
        const retryBtn = document.createElement('button');
        retryBtn.className = 'toast-retry';
        retryBtn.innerHTML = '<i class="fas fa-redo"></i> Retry';
        retryBtn.addEventListener('click', () => {
            toast.style.display = 'none';
            retryAction();
        });
        toastMessage.parentNode.insertBefore(retryBtn, toastMessage.nextSibling);
    }
    
    // For loading type, don't auto-hide - let it be hidden explicitly
    // For other types, auto-hide after timeout
    if (type !== 'loading') {
        const timeout = type === 'error' ? 10000 : 5000;
        currentToastTimeout = setTimeout(() => {
            if (toast.style.display !== 'none') {
                toast.style.display = 'none';
            }
            currentToastTimeout = null;
        }, timeout);
    }
}

/**
 * Explicitly hide the status toast
 */
export function hideStatusToast() {
    const toast = document.getElementById('statusToast');
    if (toast) {
        toast.style.display = 'none';
    }
    if (currentToastTimeout) {
        clearTimeout(currentToastTimeout);
        currentToastTimeout = null;
    }
}
