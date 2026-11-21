// ============================================================================
// STATISTICS SERVICE - Data insights, statistics calculation and display
// ============================================================================

class StatisticsService {
    /**
     * Update statistics display
     * @param {Array} reports - Array of report objects
     * @param {Object} topReportsByType - Object with top reports by type
     */
    updateStatistics(reports, topReportsByType) {
        const statsContent = document.getElementById('statisticsContent');
        const dataInsightsPanel = document.getElementById('dataInsightsPanel');
        
        if (!reports || reports.length === 0) {
            if (dataInsightsPanel) dataInsightsPanel.style.display = 'none';
            return;
        }
        
        if (dataInsightsPanel) dataInsightsPanel.style.display = 'block';
        
        // Calculate statistics
        const stats = {
            total: reports.length,
            byType: {},
            maxMagnitude: {},
            tornadoCount: 0,
            maxWindSpeed: 0,
            maxHail: 0,
            maxRain: 0
        };
        
        reports.forEach(report => {
            const type = report.type || 'Other';
            const magnitude = parseFloat(report.magnitude) || 0;
            
            stats.byType[type] = (stats.byType[type] || 0) + 1;
            
            // Check for tornado
            if (type === 'Tornado') {
                stats.tornadoCount++;
            }
            
            // Track max values by type
            if (type === 'Wind' || type === 'Thunderstorm') {
                stats.maxWindSpeed = Math.max(stats.maxWindSpeed, magnitude);
            } else if (type === 'Hail') {
                stats.maxHail = Math.max(stats.maxHail, magnitude);
            } else if (type === 'Rain') {
                stats.maxRain = Math.max(stats.maxRain, magnitude);
            }
            
            if (!stats.maxMagnitude[type] || magnitude > stats.maxMagnitude[type]) {
                stats.maxMagnitude[type] = magnitude;
            }
        });
        
        // Build statistics HTML
        const topTypes = Object.entries(stats.byType)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);
        
        let statsHTML = `
            <div class="stat-item">
                <div class="stat-label">Total Reports</div>
                <div class="stat-value">${stats.total.toLocaleString()}</div>
            </div>
        `;
        
        if (stats.tornadoCount > 0) {
            statsHTML += `
                <div class="stat-item">
                    <div class="stat-label">Tornadoes</div>
                    <div class="stat-value">${stats.tornadoCount}</div>
                </div>
            `;
        }
        
        if (stats.maxWindSpeed > 0) {
            statsHTML += `
                <div class="stat-item">
                    <div class="stat-label">Max Wind</div>
                    <div class="stat-value">${stats.maxWindSpeed.toFixed(0)} mph</div>
                </div>
            `;
        }
        
        if (stats.maxHail > 0) {
            statsHTML += `
                <div class="stat-item">
                    <div class="stat-label">Max Hail</div>
                    <div class="stat-value">${stats.maxHail.toFixed(1)}"</div>
                </div>
            `;
        }
        
        if (topTypes.length > 0) {
            statsHTML += `
                <div class="stat-item" style="grid-column: 1 / -1;">
                    <div class="stat-label">Top Types</div>
                    <div class="stat-breakdown">
                        ${topTypes.map(([type, count]) => `<div>${type}: ${count}</div>`).join('')}
                    </div>
                </div>
            `;
        }
        
        if (statsContent) {
            statsContent.innerHTML = statsHTML;
        }
        
        // Show/hide Top Reports button based on data availability
        const showTopReportsBtn = document.getElementById('showTopReports');
        if (reports && reports.length > 0 && topReportsByType && Object.keys(topReportsByType).length > 0) {
            if (showTopReportsBtn) showTopReportsBtn.style.display = 'block';
        } else {
            if (showTopReportsBtn) showTopReportsBtn.style.display = 'none';
        }
    }
    
    /**
     * Display top 10 reports by type
     * @param {Object} topReportsByType - Object with top reports by type
     */
    displayTopReports(topReportsByType) {
        const content = document.getElementById('topReportsContent');
        
        if (!content) return;
        
        if (!topReportsByType || Object.keys(topReportsByType).length === 0) {
            content.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 2rem;">No reports with magnitude data available.</p>';
            return;
        }
        
        // Sort types by highest magnitude in their top report
        const sortedTypes = Object.keys(topReportsByType)
            .map(type => ({
                type,
                reports: topReportsByType[type],
                maxMagnitude: topReportsByType[type][0]?.magnitude || 0
            }))
            .sort((a, b) => b.maxMagnitude - a.maxMagnitude);
        
        let html = '';
        
        sortedTypes.forEach(({ type, reports }) => {
            const typeIcon = this.getTypeIcon(type);
            html += `
                <div class="top-reports-section">
                    <div class="top-reports-section-title">
                        ${typeIcon}
                        <span>${type}</span>
                    </div>
                    <div class="top-reports-list">
            `;
            
            reports.forEach((report, index) => {
                html += `
                    <div class="top-report-item">
                        <div class="top-report-rank">#${index + 1}</div>
                        <div class="top-report-magnitude">${report.magnitude}${report.unit || ''}</div>
                        <div class="top-report-details">
                            ${report.location ? `
                                <div class="top-report-location">
                                    <i class="fas fa-map-marker-alt"></i>
                                    ${this.escapeHtml(report.location)}
                                </div>
                            ` : ''}
                            ${report.time ? `
                                <div class="top-report-time">
                                    <i class="fas fa-clock"></i>
                                    ${this.escapeHtml(report.time)}
                                </div>
                            ` : ''}
                            ${report.remark ? `
                                <div class="top-report-remark">
                                    <i class="fas fa-comment-alt"></i>
                                    ${this.escapeHtml(report.remark)}
                                </div>
                            ` : ''}
                        </div>
                    </div>
                `;
            });
            
            html += `
                    </div>
                </div>
            `;
        });
        
        content.innerHTML = html;
    }
    
    /**
     * Get icon for weather type
     */
    getTypeIcon(type) {
        const iconMap = {
            'Tornado': '<i class="fas fa-tornado" style="color: #dc2626;"></i>',
            'Funnel Cloud': '<i class="fas fa-tornado" style="color: #f97316;"></i>',
            'Waterspout': '<i class="fas fa-tornado" style="color: #2563eb;"></i>',
            'Temperature': '<i class="fas fa-thermometer-half" style="color: #60a5fa;"></i>',
            'Thunderstorm': '<i class="fas fa-bolt" style="color: #f59e0b;"></i>',
            'Hail': '<i class="fas fa-circle" style="color: #3b82f6;"></i>',
            'Wind': '<i class="fas fa-wind" style="color: #8b5cf6;"></i>',
            'Snow': '<i class="fas fa-snowflake" style="color: #60a5fa;"></i>',
            'Snow Squall': '<i class="fas fa-snowflake" style="color: #93c5fd;"></i>',
            'Sleet': '<i class="fas fa-circle" style="color: #38bdf8;"></i>',
            'Freezing Rain': '<i class="fas fa-cloud-rain" style="color: #2563eb;"></i>',
            'Ice': '<i class="fas fa-icicles" style="color: #34d399;"></i>',
            'Rain': '<i class="fas fa-cloud-rain" style="color: #3b82f6;"></i>',
            'Flood': '<i class="fas fa-water" style="color: #2563eb;"></i>',
            'Coastal Flooding': '<i class="fas fa-water" style="color: #2563eb;"></i>',
            'Tropical': '<i class="fas fa-hurricane" style="color: #ef4444;"></i>',
            'Fog': '<i class="fas fa-smog" style="color: #9ca3af;"></i>',
            'Wildfire': '<i class="fas fa-fire" style="color: #ea580c;"></i>',
            'Other': '<i class="fas fa-cloud" style="color: #6b7280;"></i>'
        };
        return iconMap[type] || '<i class="fas fa-cloud" style="color: #6b7280;"></i>';
    }
    
    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

export default StatisticsService;
