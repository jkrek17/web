// ============================================================================
// PNS SERVICE - NWS Public Information Statements API service
// ============================================================================

import { errorHandler, ERROR_TYPES } from '../errors/errorHandler.js';
import { showStatusToast } from '../ui/toastService.js';
import { createPopupContent } from '../map/popupService.js';
import { getUnitForReportType } from '../utils/formatters.js';
import { createPnsOfficeIcon } from '../map/iconService.js';

const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const logPNS = (...args) => {
    if (isLocalhost && window.DEBUG_PNS === true) {
        console.log(...args);
    }
};

/**
 * Map PNS metadata type codes to weather type filter names and rtype codes
 * PNS types like "SNOW", "SNOW_24", "RAIN" map to filter types like "Snow", "Rain"
 */
const PNS_TYPE_MAP = {
    // Snow types
    'SNOW': { filterType: 'Snow', rtype: 'S' },
    'SNOW_24': { filterType: 'Snow', rtype: 'S' },
    'SN': { filterType: 'Snow', rtype: 'S' },
    'SNOW_SQUALL': { filterType: 'Snow Squall', rtype: 'S' },
    'SNOWSQUALL': { filterType: 'Snow Squall', rtype: 'S' },

    // Rain types
    'RAIN': { filterType: 'Rain', rtype: 'R' },
    'RAIN_24': { filterType: 'Rain', rtype: 'R' },
    'PRECIP': { filterType: 'Rain', rtype: 'R' },
    'PRECIPITATION': { filterType: 'Rain', rtype: 'R' },
    
    // Ice types
    'ICE': { filterType: 'Ice', rtype: '5' },
    'ICING': { filterType: 'Ice', rtype: '5' },
    'FREEZING_RAIN': { filterType: 'Freezing Rain', rtype: '5' },
    'FREEZING': { filterType: 'Freezing Rain', rtype: '5' },
    'FREEZING_DRIZZLE': { filterType: 'Freezing Rain', rtype: '5' },
    'FZRA': { filterType: 'Freezing Rain', rtype: '5' },
    'SLEET': { filterType: 'Sleet', rtype: 's' },
    
    // Flood types
    'FLOOD': { filterType: 'Flood', rtype: 'F' },
    'FLOODING': { filterType: 'Flood', rtype: 'F' },
    'COASTAL FLOOD': { filterType: 'Coastal Flooding', rtype: 'F' },
    'COASTAL_FLOOD': { filterType: 'Coastal Flooding', rtype: 'F' },
    'COASTAL FLOODING': { filterType: 'Coastal Flooding', rtype: 'F' },
    'COASTAL_FLOODING': { filterType: 'Coastal Flooding', rtype: 'F' },
    
    // Temperature types
    'TEMPERATURE': { filterType: 'Temperature', rtype: 'X' },
    'TEMP': { filterType: 'Temperature', rtype: 'X' },
    'COLD': { filterType: 'Temperature', rtype: 'X' },
    'HEAT': { filterType: 'Temperature', rtype: 'X' },
    'WIND_CHILL': { filterType: 'Temperature', rtype: 'X' },
    'HEAT_INDEX': { filterType: 'Temperature', rtype: 'X' },
    'EXTREME_COLD': { filterType: 'Temperature', rtype: 'X' },
    'EXTREME_HEAT': { filterType: 'Temperature', rtype: 'X' },
    'EXTREME_TEMP': { filterType: 'Temperature', rtype: 'X' },
    
    // Wind types - multiple variations
    'WIND': { filterType: 'Wind', rtype: 'O' },
    'WIND_GUST': { filterType: 'Wind', rtype: 'O' },
    'WIND_24': { filterType: 'Wind', rtype: 'O' },
    'GUST': { filterType: 'Wind', rtype: 'O' },
    'GUSTS': { filterType: 'Wind', rtype: 'O' },
    'HIGH_WIND': { filterType: 'Wind', rtype: 'O' },
    'STRONG_WIND': { filterType: 'Wind', rtype: 'O' },
    'SUSTAINED_WIND': { filterType: 'Wind', rtype: 'O' },
    'PEAK_WIND': { filterType: 'Wind', rtype: 'O' },
    'P_WIND': { filterType: 'Wind', rtype: 'O' }, // Peak wind abbreviation
    
    // Hail types
    'HAIL': { filterType: 'Hail', rtype: 'H' },

    'FOG': { filterType: 'Fog', rtype: 'J' },
    'DENSE_FOG': { filterType: 'Fog', rtype: 'J' },
    'WILDFIRE': { filterType: 'Wildfire', rtype: 'U' },
    'WILD_FIRE': { filterType: 'Wildfire', rtype: 'U' },
    
    // Thunderstorm types
    'THUNDERSTORM': { filterType: 'Thunderstorm', rtype: 'D' },
    'TS': { filterType: 'Thunderstorm', rtype: 'D' },
    'TSTM': { filterType: 'Thunderstorm', rtype: 'D' },
    'THUNDER': { filterType: 'Thunderstorm', rtype: 'D' },
    
    // Tornado types
    'TORNADO': { filterType: 'Tornado', rtype: 'T' },
    
    // Default
    'OTHER': { filterType: 'Other', rtype: '' }
};

/**
 * Map PNS metadata type to filter type and rtype
 */
function mapPNSType(type) {
    if (!type) {
        return { filterType: 'Other', rtype: '' };
    }
    
    const upperType = type.toUpperCase().trim();
    
    // Remove common suffixes/prefixes for better matching
    // Handle patterns like "SNOW_24", "WIND_GUST", etc.
    const normalizedType = upperType.replace(/[_\-]/g, ''); // Remove underscores and dashes
    
    // Check for exact match first
    if (PNS_TYPE_MAP[upperType]) {
        return PNS_TYPE_MAP[upperType];
    }
    
    // Check normalized version
    for (const [key, value] of Object.entries(PNS_TYPE_MAP)) {
        const normalizedKey = key.replace(/[_\-]/g, '');
        if (normalizedType === normalizedKey) {
            return value;
        }
    }
    
    // Check for partial matches with priority to longer matches first
    // Sort keys by length (longest first) to match more specific types first
    const sortedKeys = Object.keys(PNS_TYPE_MAP).sort((a, b) => b.length - a.length);
    for (const key of sortedKeys) {
        // Check if the type contains the key or key contains the type
        if (upperType.includes(key) || key.includes(normalizedType)) {
            return PNS_TYPE_MAP[key];
        }
    }
    
    // Special cases: Check for common abbreviations or patterns
    if (upperType.startsWith('T') && (upperType.includes('EMP') || upperType.includes('COLD') || upperType.includes('HEAT'))) {
        return { filterType: 'Temperature', rtype: 'X' };
    }
    
    if (upperType.includes('GUST') || upperType.includes('WIND')) {
        return { filterType: 'Wind', rtype: 'O' };
    }
    
    // Default to Other
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        console.log('[PNS] Unknown type mapping for:', type, '-> defaulting to Other');
    }
    return { filterType: 'Other', rtype: '' };
}

class PNSService {
    constructor() {
        this.apiBase = 'https://api.weather.gov/products/types/PNS';
        this.wfoCoords = {
            'KABQ': [35.04, -106.62], 'KABR': [45.45, -98.41], 'KAMA': [35.23, -101.71],
            'KAPX': [44.90, -84.72], 'KARX': [43.82, -91.19], 'KBGM': [42.20, -75.98],
            'KBIS': [46.77, -100.75], 'KBMX': [33.17, -86.77], 'KBOI': [43.56, -116.21],
            'KBOU': [39.75, -105.00], 'KBOX': [41.95, -71.14], 'KBRO': [25.91, -97.42],
            'KBTV': [44.47, -73.15], 'KBUF': [42.94, -78.72], 'KBYZ': [45.75, -108.57],
            'KCAE': [33.95, -81.12], 'KCAR': [46.87, -68.02], 'KCHS': [32.90, -80.04],
            'KCLE': [41.41, -81.85], 'KCRP': [27.78, -97.51], 'KCTP': [40.79, -77.86],
            'KCYS': [41.15, -104.81], 'KDDC': [37.76, -99.97], 'KDLH': [46.84, -92.21],
            'KDMX': [41.73, -93.72], 'KDTX': [42.70, -83.47], 'KDVN': [41.61, -90.58],
            'KEAX': [38.81, -94.26], 'KEKA': [40.80, -124.16], 'KEPZ': [31.87, -106.70],
            'KEWX': [29.70, -98.03], 'KFFC': [33.36, -84.57], 'KFGF': [47.92, -97.09],
            'KFGZ': [35.23, -111.82], 'KFSD': [43.59, -96.73], 'KFWD': [32.83, -97.30],
            'KGGW': [48.21, -106.62], 'KGID': [40.97, -98.38], 'KGJT': [39.12, -108.53],
            'KGLD': [39.37, -101.70], 'KGRB': [44.48, -88.13], 'KGRR': [42.89, -85.54],
            'KGSP': [34.88, -82.22], 'KGYX': [43.89, -70.26], 'KHGX': [29.47, -95.08],
            'KHNX': [36.31, -119.63], 'KHUN': [34.72, -86.66], 'KICT': [37.65, -97.43],
            'KILM': [34.27, -77.91], 'KILN': [39.42, -83.82], 'KIND': [39.71, -86.28],
            'KIWX': [41.36, -85.70], 'KJAN': [32.32, -90.08], 'KJAX': [30.48, -81.70],
            'KJKL': [37.59, -83.31], 'KKEY': [24.56, -81.78], 'KLBF': [41.13, -100.68],
            'KLCH': [30.13, -93.22], 'KLIX': [30.34, -89.83], 'KLKN': [40.87, -117.80],
            'KLMK': [38.23, -85.66], 'KLOT': [41.60, -88.08], 'KLOX': [34.20, -119.18],
            'KLUB': [33.65, -101.82], 'KLWX': [38.97, -77.48], 'KLZK': [34.84, -92.26],
            'KMAF': [31.94, -102.19], 'KMEG': [35.05, -89.99], 'KMFL': [25.75, -80.38],
            'KMFR': [42.37, -122.87], 'KMHX': [34.78, -76.88], 'KMKX': [42.97, -88.55],
            'KMLB': [28.11, -80.65], 'KMOB': [30.68, -88.24], 'KMPX': [44.85, -93.57],
            'KMQT': [46.53, -87.55], 'KMRX': [36.17, -83.40], 'KMSO': [46.92, -114.09],
            'KMTR': [36.60, -121.90], 'KOAX': [41.32, -96.37], 'KOHX': [36.25, -86.56],
            'KOKX': [40.87, -72.86], 'KOTX': [47.68, -117.63], 'KOUN': [35.24, -97.46],
            'KPAH': [37.07, -88.77], 'KPBZ': [40.53, -80.22], 'KPDT': [45.69, -118.85],
            'KPHI': [39.87, -75.01], 'KPIH': [42.91, -112.60], 'KPQR': [45.56, -122.54],
            'KPSR': [33.43, -112.02], 'KPUB': [38.28, -104.52], 'KRAH': [35.87, -78.79],
            'KREV': [39.57, -119.80], 'KRIW': [43.06, -108.48], 'KRLX': [38.31, -81.72],
            'KRNK': [37.21, -80.41], 'KSEW': [47.69, -122.26], 'KSGF': [37.24, -93.40],
            'KSGX': [32.73, -117.18], 'KSHV': [32.45, -93.84], 'KSJT': [31.37, -100.49],
            'KSLC': [40.77, -111.95], 'KSTO': [38.60, -121.38], 'KTAE': [30.45, -84.30],
            'KTBW': [27.70, -82.40], 'KTFX': [47.46, -111.38], 'KTOP': [39.07, -95.63],
            'KTSA': [36.15, -95.86], 'KTWC': [32.23, -110.95], 'KUNR': [41.14, -104.24],
            'KVEF': [36.05, -115.18]
        };
    }

    /**
     * Fetch and display PNS data
     * @param {boolean} showPNS - Whether to fetch and show PNS
     * @param {*} pnsLayer - Unused (markers are returned through onMarkerCreated); kept for call compatibility
     * @param {Function} onMarkerClick - Unused; the map's PNS layer handles clicks
     * @param {Function} getIconFn - Function to get icon for report (rtype, magnitude, remark, typetext) -> icon
     * @param {Function} getReportTypeNameFn - Function to get report type name (rtype, map) -> name
     * @param {Object} reportTypeMap - Report type mapping object
     * @param {Function} onMarkerCreated - Callback for each marker data object ({ icon, popupHtml, lat, lon, ... })
     * @param {Function} onPopupOpen - Unused; the map's PNS layer handles popups
     */
    async fetchPNSData(showPNS, pnsLayer, onMarkerClick, getIconFn, getReportTypeNameFn, reportTypeMap, onMarkerCreated, onPopupOpen) {
        if (!showPNS) {
            return;
        }
        
        try {
            const response = await fetch(this.apiBase, {
                headers: {
                    'User-Agent': '(LSR Map App, contact@example.com)'
                }
            });
            
            if (!response.ok) {
                errorHandler.log('Failed to fetch PNS data', new Error(response.statusText), ERROR_TYPES.API);
                return;
            }
            
            const data = await response.json();
            
            if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
                console.log('[PNS] API response:', data ? 'received' : 'null', data?.['@graph']?.length || 0, 'products');
            }
            
            if (!data || !data['@graph'] || data['@graph'].length === 0) {
                if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
                    console.log('[PNS] No PNS products found in API response');
                }
                // No PNS found - not an error, just informational
                return;
            }
            
            // Get recent PNS (last 24 hours only)
            const now = new Date();
            const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            const recentPNS = data['@graph'].filter(product => {
                const issueTime = new Date(product.issuanceTime);
                return issueTime >= oneDayAgo;
            }).slice(0, 50);
            
            if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
                console.log('[PNS] Recent PNS (last 24h):', recentPNS.length, 'products');
            }
            
            if (recentPNS.length === 0) {
                if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
                    console.log('[PNS] No recent PNS found (last 24 hours)');
                }
                // No recent PNS found - not an error
                return;
            }
            
            let displayedCount = 0;
            let processedCount = 0;
            let skippedNoMetadata = 0;
            let metadataMarkers = 0;
            let officeMarkers = 0;
            const processedProductIds = new Set();
            
            for (const product of recentPNS) {
                try {
                    // Skip if we've already processed this product
                    if (processedProductIds.has(product.id)) {
                        continue;
                    }
                    
                    // Fetch full product text
                    const productUrl = `https://api.weather.gov/products/${product.id}`;
                    const productResponse = await fetch(productUrl, {
                        headers: { 'User-Agent': '(LSR Map App, contact@example.com)' }
                    });
                    
                    if (!productResponse.ok) continue;
                    
                    const productData = await productResponse.json();
                    const productText = productData.productText || '';
                    
                    if (!productText.trim()) continue;
                    
                    processedProductIds.add(product.id);
                    processedCount++;
                    
                    // Parse METADATA section from PNS text
                    const metadataEntries = this.parsePNSMetadata(productText);
                    
                    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
                        console.log(`[PNS] Product ${product.id} (${product.issuingOffice}):`, metadataEntries.length, 'metadata entries found');
                    }
                    
                    // Store PNS data for modal
                    const pnsData = {
                        office: product.issuingOffice || 'NWS',
                        time: new Date(product.issuanceTime),
                        text: productText,
                        productId: product.id
                    };
                    
                    // If we have metadata entries, use those coordinates
                    if (metadataEntries.length > 0) {
                        // Create markers for each metadata entry
                        let validEntries = 0;
                        for (const entry of metadataEntries) {
                            if (entry.lat && entry.lon) {
                                // Map PNS type to filter type and rtype
                                const typeMapping = mapPNSType(entry.type);
                                const filterType = typeMapping.filterType;
                                const rtype = typeMapping.rtype;
                                
                                // Get category name for display
                                const category = filterType || (getReportTypeNameFn ? getReportTypeNameFn(rtype, reportTypeMap) : 'Other');
                                
                                // Parse magnitude and get unit
                                const magnitude = parseFloat(entry.magnitude) || 0;
                                const unit = rtype ? getUnitForReportType(rtype) : (entry.unit || '');
                                
                                // Format location string
                                const locationParts = [entry.location, entry.county, entry.state].filter(p => p && p.trim());
                                const locationStr = locationParts.join(', ');
                                
                                // Format time string
                                let timeStr = '';
                                if (entry.date && entry.time) {
                                    // Combine date and time for display
                                    const dateStr = entry.date.trim();
                                    const timeValue = entry.time.trim();
                                    timeStr = `${dateStr} ${timeValue}`;
                                } else if (entry.time) {
                                    timeStr = entry.time.trim();
                                }
                                
                                // Get appropriate icon for this weather type
                                let icon;
                                if (getIconFn && rtype) {
                                    const description = entry.description || '';
                                    icon = getIconFn(rtype, magnitude, description, entry.type);
                                } else {
                                    // Fallback to generic PNS icon
                                    icon = createPnsOfficeIcon();
                                }
                                
                                // Create report data for popup (similar to LSR reports)
                                const reportData = {
                                    category: category,
                                    magnitude: magnitude || null,
                                    unit: unit,
                                    remark: entry.description || '',
                                    location: locationStr || entry.location || '',
                                    time: timeStr,
                                    rtype: rtype || ''
                                };
                                
                                // Popup uses the same service as LSR markers, plus a link to the full PNS text
                                const popupHtml = `${createPopupContent(reportData)}
                                    <div class="popup-footer" style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #ddd;">
                                        <button type="button" class="pns-view-full-btn" 
                                                style="background: #4a90e2; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; width: 100%;">
                                            <i class="fas fa-file-alt"></i> View Full PNS Text
                                        </button>
                                    </div>
                                `;
                                
                                // Marker data: drawn by the map's PNS report layer
                                const markerData = {
                                    icon: icon,
                                    popupHtml: popupHtml,
                                    reportData: reportData,
                                    lat: entry.lat,
                                    lon: entry.lon,
                                    filterType: filterType,
                                    pnsEntry: entry,
                                    pnsData: pnsData,
                                    category: category,
                                    magnitude: magnitude,
                                    unit: unit,
                                    location: locationStr,
                                    time: timeStr,
                                    rtype: rtype
                                };
                                
                                // Call callback to collect marker data
                                if (onMarkerCreated) {
                                    onMarkerCreated(markerData);
                                }
                                
                                displayedCount++;
                                validEntries++;
                                metadataMarkers++;
                            }
                        }
                        
                        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
                            console.log(`[PNS] Created ${validEntries} metadata markers for product ${product.id}`);
                        }
                    } else {
                        // Fallback: use WFO office coordinates (no specific type, use generic icon)
                        const wfoCode = product.issuingOffice?.match(/K[A-Z]{2,3}/)?.[0];
                        
                        if (wfoCode && this.wfoCoords[wfoCode]) {
                            const [lat, lon] = this.wfoCoords[wfoCode];
                            // Office marker: clicking it opens the full PNS text (no popup)
                            const markerData = {
                                icon: createPnsOfficeIcon(),
                                popupHtml: null,
                                reportData: null,
                                lat: lat,
                                lon: lon,
                                filterType: 'Other',
                                pnsEntry: null,
                                pnsData: pnsData,
                                category: 'Other',
                                magnitude: 0,
                                unit: '',
                                location: '',
                                time: '',
                                rtype: ''
                            };
                            
                            // Call callback to collect marker data
                            if (onMarkerCreated) {
                                onMarkerCreated(markerData);
                            }
                            
                            displayedCount++;
                            officeMarkers++;
                            
                            if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
                                console.log(`[PNS] Created office marker for ${product.id} at WFO ${wfoCode} (no metadata)`);
                            }
                        } else {
                            skippedNoMetadata++;
                            if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
                                console.log(`[PNS] Skipping ${product.id} - no metadata and no WFO coordinates (${wfoCode || 'no WFO code'})`);
                            }
                        }
                    }
                    
                } catch (error) {
                    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
                        console.error('[PNS] Error processing product', product.id, ':', error);
                    }
                    errorHandler.log(`Error processing PNS product ${product.id}`, error, ERROR_TYPES.API);
                }
            }
            
            if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
                console.log('[PNS] Summary:', {
                    processed: processedCount,
                    metadataMarkers: metadataMarkers,
                    officeMarkers: officeMarkers,
                    skippedNoMetadata: skippedNoMetadata,
                    displayed: displayedCount
                });
            }
            
            if (displayedCount > 0) {
                // Successfully loaded PNS data
                showStatusToast(`Loaded ${displayedCount} PNS entr${displayedCount !== 1 ? 'ies' : 'y'}`, 'info');
            } else {
                if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
                    console.log('[PNS] No markers displayed - check if recent PNS have METADATA sections');
                }
            }
        } catch (error) {
            errorHandler.handleError(error, 'Fetch PNS Data');
        }
    }

    /**
     * Parse METADATA section from PNS text and extract entries with coordinates
     * Format: :date,time,state,county,location,,,,lat,lon,type,magnitude,unit,provider,description,
     * @param {string} pnsText - Full PNS product text
     * @returns {Array} Array of metadata entries with coordinates
     */
    parsePNSMetadata(pnsText) {
        const entries = [];
        
        // Find METADATA section - match METADATA with any asterisks before/after it
        // Pattern: METADATA (with optional asterisks) followed by content until $$
        // Examples: **METADATA**, *****METADATA*****, METADATA
        // Capture everything between METADATA and $$ (or end of string)
        const metadataMatch = pnsText.match(/\*+METADATA\*+[\s\S]*?([\s\S]*?)\$\$/i);
        
        if (!metadataMatch) {
            // Try pattern without asterisks
            const simpleMatch = pnsText.match(/METADATA[\s\S]*?([\s\S]*?)\$\$/i);
            if (simpleMatch) {
                if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
                    console.log('[PNS] METADATA section found (simple pattern, no asterisks)');
                }
                return this.parseMetadataLines(simpleMatch[1]);
            }
            
            // Try pattern that ends with && or end of string
            const altMatch = pnsText.match(/\*+METADATA\*+[\s\S]*?([\s\S]*?)(?:\$\$|&&|$)/i);
            if (altMatch) {
                if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
                    console.log('[PNS] METADATA section found (alternative delimiter)');
                }
                return this.parseMetadataLines(altMatch[1]);
            }
            
            if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
                console.log('[PNS] No METADATA section found in text');
                // Check if text contains "METADATA" at all (for debugging)
                if (pnsText.toUpperCase().includes('METADATA')) {
                    console.log('[PNS] Text contains "METADATA" but regex did not match. Sample:', pnsText.substring(0, 500));
                    // Try to find where METADATA appears
                    const metadataIndex = pnsText.toUpperCase().indexOf('METADATA');
                    if (metadataIndex >= 0) {
                        const start = Math.max(0, metadataIndex - 50);
                        const end = Math.min(pnsText.length, metadataIndex + 300);
                        console.log('[PNS] METADATA found at position', metadataIndex, 'Context:', pnsText.substring(start, end));
                        
                        // Try manual extraction - find text between METADATA and $$
                        const afterMetadata = pnsText.substring(metadataIndex);
                        const dollarIndex = afterMetadata.indexOf('$$');
                        if (dollarIndex >= 0) {
                            const manualSection = afterMetadata.substring(afterMetadata.indexOf('\n', 10), dollarIndex);
                            if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
                                console.log('[PNS] Attempting manual extraction, section length:', manualSection.length);
                            }
                            return this.parseMetadataLines(manualSection);
                        }
                    }
                }
            }
            return entries; // No METADATA section found
        }
        
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            console.log('[PNS] METADATA section found, extracted', metadataMatch[1]?.length || 0, 'characters');
        }
        
        return this.parseMetadataLines(metadataMatch[1]);
    }
    
    /**
     * Parse metadata lines from the METADATA section
     * @param {string} metadataSection - The text content after "METADATA" header
     * @returns {Array} Array of parsed entries
     */
    parseMetadataLines(metadataSection) {
        const entries = [];
        const lines = metadataSection.split('\n');
        
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            console.log('[PNS] METADATA section found, parsing', lines.length, 'lines');
        }
        
        for (const line of lines) {
            const trimmedLine = line.trim();
            
            // Skip empty lines or lines that don't start with colon
            if (!trimmedLine || !trimmedLine.startsWith(':')) {
                continue;
            }
            
            // Parse the line - location field may contain commas, so we can't rely on fixed positions
            // Instead, look for two consecutive numeric fields (lat, lon) near the end
            // Format: :date,time,state,county,location(may have commas),...,lat,lon,type,...
            const parts = trimmedLine.split(',').map(p => p.trim());
            
            // Find lat/lon by looking for two consecutive numeric fields
            // Lat should be positive (30-50 for US), lon should be negative for US (-70 to -130)
            // Scan backwards from the end to find the coordinate pair
            let lat = null;
            let lon = null;
            let latIndex = -1;
            let lonIndex = -1;
            
            // Look for coordinate pair - typically lat is positive, lon is negative (for US)
            for (let i = parts.length - 1; i >= 2; i--) {
                const val = parseFloat(parts[i]);
                
                // If we found a negative number (likely longitude)
                if (!isNaN(val) && val < 0 && val >= -180 && val <= 180) {
                    lon = val;
                    lonIndex = i;
                    
                    // Check if previous field is positive latitude
                    if (i > 0) {
                        const prevVal = parseFloat(parts[i - 1]);
                        if (!isNaN(prevVal) && prevVal > 0 && prevVal >= 20 && prevVal <= 60) {
                            lat = prevVal;
                            latIndex = i - 1;
                            break;
                        }
                    }
                }
            }
            
            // If we didn't find coordinates, try alternative: look for any two consecutive numbers
            if (lat === null || lon === null) {
                for (let i = parts.length - 1; i >= 1; i--) {
                    const val1 = parseFloat(parts[i]);
                    const val2 = parseFloat(parts[i - 1]);
                    
                    if (!isNaN(val1) && !isNaN(val2)) {
                        // Assume first is lat (typically positive), second is lon (may be negative)
                        if (Math.abs(val2) >= 20 && Math.abs(val2) <= 60 && Math.abs(val1) >= 60 && Math.abs(val1) <= 180) {
                            lat = Math.abs(val2); // Latitude should be positive
                            lon = val1; // Longitude can be negative
                            latIndex = i - 1;
                            lonIndex = i;
                            break;
                        }
                    }
                }
            }
            
            // Validate we found valid coordinates
            if (lat !== null && lon !== null && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
                // Extract other fields (date, time, state, county, location, type, etc.)
                // Since location may have commas, reconstruct it from parts between county and coordinates
                const date = parts[0]?.replace(':', '').trim() || '';
                const time = parts[1] || '';
                const state = parts[2] || '';
                const county = parts[3] || '';
                
                // Location is everything between county (index 3) and lat (latIndex)
                const locationParts = parts.slice(4, latIndex);
                const location = locationParts.filter(p => p).join(', ').trim();
                
                // Type and other fields are after lon
                const type = parts[lonIndex + 1] || '';
                const magnitude = parts[lonIndex + 2] || '';
                const unit = parts[lonIndex + 3] || '';
                const provider = parts[lonIndex + 4] || '';
                const description = parts.slice(lonIndex + 5).filter(p => p).join(', ').replace(/,$/, '').trim();
                
                entries.push({
                    date: date,
                    time: time,
                    state: state,
                    county: county,
                    location: location,
                    lat: lat,
                    lon: lon,
                    type: type,
                    magnitude: magnitude,
                    unit: unit,
                    provider: provider,
                    description: description
                });
            } else {
                if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
                    console.log('[PNS] Could not find valid coordinates in line:', trimmedLine.substring(0, 120));
                    console.log('[PNS] Parts:', parts.length, 'Found lat:', lat, 'lon:', lon);
                }
            }
        }
        
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            console.log('[PNS] Parsed', entries.length, 'valid entries from METADATA');
        }
        
        return entries;
    }
}

export default PNSService;
