// Dashboard API Client
// Handles fetching dashboard data from backend and auto-refresh polling

let dashboardPollingInterval = null;
let currentDashboardData = null;

/**
 * Fetch dashboard data from backend
 * @returns {Promise<Object>} Dashboard data
 */
async function fetchDashboard() {
    try {
        const response = await fetch('/api/dashboard/');
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('Dashboard data fetched:', data);
        return data;
        
    } catch (error) {
        console.error('Error fetching dashboard:', error);
        throw error;
    }
}

/**
 * Update dashboard with fresh data from Redis (not AI agent)
 */
async function updateDashboard() {
    try {
        const data = await fetchDashboard();
        currentDashboardData = data;
        
        // Update global dashboardData for sidebar
        if (typeof window !== 'undefined') {
            window.dashboardData = data;
        }
        
        // Trigger dashboard re-render
        if (typeof renderDashboardGrid === 'function') {
            renderDashboardGrid(data);
            // Re-initialize Lucide icons after render
            if (typeof lucide !== 'undefined' && lucide.createIcons) {
                lucide.createIcons();
            }
        }
        
        // Update sidebar if needed
        if (typeof renderRightSidebar === 'function') {
            renderRightSidebar();
            if (typeof lucide !== 'undefined' && lucide.createIcons) {
                lucide.createIcons();
            }
        }
        
    } catch (error) {
        console.error('Failed to update dashboard:', error);
    }
}

/**
 * Start automatic dashboard polling
 * @param {number} interval - Polling interval in milliseconds (default: 30000ms = 30sec)
 */
function startDashboardPolling(interval = 30000) {
    console.log(`Starting dashboard polling every ${interval / 1000} seconds`);
    
    // Clear existing interval if any
    stopDashboardPolling();
    
    // Initial fetch
    updateDashboard();
    
    // Set up polling
    dashboardPollingInterval = setInterval(() => {
        updateDashboard();
    }, interval);
}

/**
 * Stop automatic dashboard polling
 */
function stopDashboardPolling() {
    if (dashboardPollingInterval) {
        console.log('Stopping dashboard polling');
        clearInterval(dashboardPollingInterval);
        dashboardPollingInterval = null;
    }
}

/**
 * Get current cached dashboard data
 * @returns {Object|null} Current dashboard data or null
 */
function getCurrentDashboardData() {
    return currentDashboardData;
}
