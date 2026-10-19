// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
    // Set to false to bypass cache.php and always use JSONP directly from Iowa State
    // Useful when server PHP cannot make outbound HTTP requests (firewall/policy)
    USE_SERVER_CACHE: false,
    
    CACHE_DAYS: 30, // Must match api/config.php CACHE_DAYS; used for cache API window
    ICON_SIZE: 28,
    AUTO_REFRESH_INTERVAL: 300000, // 5 minutes
    LIVE_MODE_REFRESH_INTERVAL: 60000, // 1 minute for live mode
    DEFAULT_BOUNDS: {
        south: 17.9,   // Puerto Rico southernmost point (includes Hawaii at 18.91)
        north: 71.60,  // Alaska northernmost point
        east: -65,     // Puerto Rico easternmost point (includes East coast)
        west: -179.15  // Alaska westernmost point (Aleutian Islands)
    },
    // MapLibre zoom levels (512px tiles): one less than the old Leaflet levels
    MAP_INITIAL: {
        lat: 39.8283,
        lon: -98.5795,
        zoom: 3
    },
    // Self-hosted basemap (see DEPLOYMENT.md, "Basemap")
    BASEMAP: {
        // OpenStreetMap vector tiles for the US, in the repo (max zoom 7, overzoomed beyond)
        CORE_URL: 'basemap/us-core.pmtiles',
        // Optional full street-detail PMTiles on this web server, e.g. 'basemap/us-streets.pmtiles'
        // (too large for git; build with tools/basemap/build-streets.sh). Used when it answers,
        // otherwise the map falls back to CORE_URL. Relative URLs resolve against the page.
        STREETS_URL: ''
    },
    WEATHER_TYPES: ['Rain', 'Flood', 'Coastal Flooding', 'Snow', 'Snow Squall', 'Sleet', 'Freezing Rain', 'Ice', 'Hail', 'Wind', 'Thunderstorm', 'Tornado', 'Funnel Cloud', 'Waterspout', 'Tropical', 'Temperature', 'Fog', 'Wildfire', 'Other'],
    // State and Region bounding boxes [south, north, east, west]
    STATES: {
        'AL': { name: 'Alabama', bounds: [30.14, 35.01, -84.89, -88.47] },
        'AK': { name: 'Alaska', bounds: [51.21, 71.60, -130.05, -179.15] },
        'AZ': { name: 'Arizona', bounds: [31.33, 37.00, -109.04, -114.82] },
        'AR': { name: 'Arkansas', bounds: [33.00, 36.50, -89.64, -94.62] },
        'CA': { name: 'California', bounds: [32.53, 42.01, -114.13, -124.41] },
        'CO': { name: 'Colorado', bounds: [36.99, 41.00, -102.04, -109.06] },
        'CT': { name: 'Connecticut', bounds: [40.98, 42.05, -71.79, -73.73] },
        'DE': { name: 'Delaware', bounds: [38.45, 39.72, -75.05, -75.79] },
        'FL': { name: 'Florida', bounds: [24.52, 31.00, -80.03, -87.63] },
        'GA': { name: 'Georgia', bounds: [30.36, 35.00, -80.84, -85.61] },
        'HI': { name: 'Hawaii', bounds: [18.91, 22.24, -154.81, -160.25] },
        'ID': { name: 'Idaho', bounds: [41.99, 49.00, -111.04, -117.24] },
        'IL': { name: 'Illinois', bounds: [36.97, 42.51, -87.49, -91.51] },
        'IN': { name: 'Indiana', bounds: [37.77, 41.76, -84.78, -88.10] },
        'IA': { name: 'Iowa', bounds: [40.38, 43.50, -90.14, -96.64] },
        'KS': { name: 'Kansas', bounds: [36.99, 40.00, -94.62, -102.05] },
        'KY': { name: 'Kentucky', bounds: [36.50, 39.15, -81.97, -89.57] },
        'LA': { name: 'Louisiana', bounds: [28.93, 33.02, -88.82, -94.04] },
        'ME': { name: 'Maine', bounds: [43.06, 47.46, -66.95, -71.08] },
        'MD': { name: 'Maryland', bounds: [37.91, 39.72, -75.05, -79.49] },
        'MA': { name: 'Massachusetts', bounds: [41.24, 42.89, -69.93, -73.51] },
        'MI': { name: 'Michigan', bounds: [41.70, 48.31, -82.13, -90.42] },
        'MN': { name: 'Minnesota', bounds: [43.50, 49.38, -89.53, -97.24] },
        'MS': { name: 'Mississippi', bounds: [30.14, 35.00, -88.10, -91.65] },
        'MO': { name: 'Missouri', bounds: [35.99, 40.61, -89.10, -95.77] },
        'MT': { name: 'Montana', bounds: [44.36, 49.00, -104.04, -116.05] },
        'NE': { name: 'Nebraska', bounds: [39.99, 43.00, -95.31, -104.05] },
        'NV': { name: 'Nevada', bounds: [35.00, 42.00, -114.04, -120.00] },
        'NH': { name: 'New Hampshire', bounds: [42.70, 45.31, -70.61, -72.56] },
        'NJ': { name: 'New Jersey', bounds: [38.93, 41.36, -73.90, -75.56] },
        'NM': { name: 'New Mexico', bounds: [31.33, 37.00, -103.00, -109.05] },
        'NY': { name: 'New York', bounds: [40.48, 45.02, -71.86, -79.76] },
        'NC': { name: 'North Carolina', bounds: [33.84, 36.59, -75.46, -84.32] },
        'ND': { name: 'North Dakota', bounds: [45.93, 49.00, -96.55, -104.05] },
        'OH': { name: 'Ohio', bounds: [38.40, 41.98, -80.52, -84.82] },
        'OK': { name: 'Oklahoma', bounds: [33.62, 37.00, -94.43, -103.00] },
        'OR': { name: 'Oregon', bounds: [41.99, 46.29, -116.47, -124.57] },
        'PA': { name: 'Pennsylvania', bounds: [39.72, 42.27, -74.69, -80.52] },
        'RI': { name: 'Rhode Island', bounds: [41.15, 42.02, -71.12, -71.89] },
        'SC': { name: 'South Carolina', bounds: [32.03, 35.21, -78.54, -83.35] },
        'SD': { name: 'South Dakota', bounds: [42.48, 45.94, -96.45, -104.06] },
        'TN': { name: 'Tennessee', bounds: [34.98, 36.68, -81.65, -90.31] },
        'TX': { name: 'Texas', bounds: [25.84, 36.50, -93.51, -106.65] },
        'UT': { name: 'Utah', bounds: [36.99, 42.00, -109.04, -114.05] },
        'VT': { name: 'Vermont', bounds: [42.73, 45.02, -71.46, -73.44] },
        'VA': { name: 'Virginia', bounds: [36.54, 39.47, -75.24, -83.68] },
        'WA': { name: 'Washington', bounds: [45.54, 49.00, -116.92, -124.79] },
        'WV': { name: 'West Virginia', bounds: [37.20, 40.64, -77.72, -82.65] },
        'WI': { name: 'Wisconsin', bounds: [42.49, 47.31, -86.25, -92.89] },
        'WY': { name: 'Wyoming', bounds: [40.99, 45.01, -104.05, -111.05] },
        'PR': { name: 'Puerto Rico', bounds: [17.9, 18.5, -65.2, -67.9] }
    },
    REGIONS: {
        'northeast': { name: 'Northeast', bounds: [38.79, 47.46, -66.95, -80.52] },
        'southeast': { name: 'Southeast', bounds: [24.52, 39.72, -75.05, -91.65] },
        'midwest': { name: 'Midwest', bounds: [36.97, 49.38, -80.52, -104.06] },
        'southwest': { name: 'Southwest', bounds: [31.33, 37.00, -103.00, -124.41] },
        'west': { name: 'West', bounds: [32.53, 49.00, -102.04, -124.79] },
        'pacific': { name: 'Pacific', bounds: [32.53, 49.00, -116.47, -124.79] },
        'pacific_northwest': { name: 'Pacific Northwest', bounds: [42.00, 49.00, -111.00, -124.79] },
        'southwest_desert': { name: 'Southwest Desert', bounds: [31.00, 38.00, -103.00, -117.50] },
        'rockies_intermountain': { name: 'Rockies / Intermountain', bounds: [36.50, 49.00, -104.00, -116.50] },
        'southern_plains': { name: 'Southern Plains', bounds: [25.00, 40.00, -94.00, -106.50] },
        'northern_plains': { name: 'Northern Plains', bounds: [40.00, 49.00, -94.00, -106.50] },
        'great_lakes': { name: 'Great Lakes', bounds: [40.00, 49.00, -76.00, -93.00] },
        'gulf_coast': { name: 'Gulf Coast', bounds: [25.00, 32.50, -80.00, -98.00] },
        'nws_eastern': { name: 'NWS Eastern', bounds: [17.90, 49.50, -66.50, -85.00] },
        'nws_southern': { name: 'NWS Southern', bounds: [24.00, 39.00, -75.00, -106.50] },
        'nws_central': { name: 'NWS Central', bounds: [36.00, 49.50, -84.00, -104.50] },
        'nws_western': { name: 'NWS Western', bounds: [31.00, 49.50, -102.00, -125.00] },
        'nws_alaska': { name: 'NWS Alaska', bounds: [51.21, 71.60, -130.05, -179.15] },
        'nws_pacific': { name: 'NWS Pacific', bounds: [13.00, 25.50, -154.80, -170.00] },
        'central': { name: 'Central', bounds: [25.84, 49.0, -90.0, -106.65] }, // All of Texas + Mississippi Valley to Canada
        'east': { name: 'East', bounds: [25.0, 47.0, -67.0, -90.0] } // Atlantic coast to Mississippi River
    },
    NWS_ADMIN_REGION_KEYS: ['nws_alaska', 'nws_pacific', 'nws_western', 'nws_southern', 'nws_central', 'nws_eastern'],
    WFO_NAMES: {
        'ABQ': 'Albuquerque, NM',
        'ABR': 'Aberdeen, SD',
        'AFC': 'Anchorage, AK',
        'AFG': 'Fairbanks, AK',
        'AJK': 'Juneau, AK',
        'AKQ': 'Wakefield, VA',
        'ALY': 'Albany, NY',
        'AMA': 'Amarillo, TX',
        'ANC': 'Anchorage, AK',
        'APX': 'Gaylord, MI',
        'ARX': 'La Crosse, WI',
        'BGM': 'Binghamton, NY',
        'BIS': 'Bismarck, ND',
        'BMX': 'Birmingham, AL',
        'BOI': 'Boise, ID',
        'BOU': 'Denver/Boulder, CO',
        'BOX': 'Boston, MA',
        'BRO': 'Brownsville, TX',
        'BTV': 'Burlington, VT',
        'BUF': 'Buffalo, NY',
        'BYZ': 'Billings, MT',
        'CAE': 'Columbia, SC',
        'CAR': 'Caribou, ME',
        'CHS': 'Charleston, SC',
        'CLE': 'Cleveland, OH',
        'CRP': 'Corpus Christi, TX',
        'CTP': 'State College, PA',
        'CYS': 'Cheyenne, WY',
        'DDC': 'Dodge City, KS',
        'DLH': 'Duluth, MN',
        'DMX': 'Des Moines, IA',
        'DTX': 'Detroit, MI',
        'DVN': 'Quad Cities, IA',
        'EAX': 'Kansas City, MO',
        'EKA': 'Eureka, CA',
        'EPZ': 'El Paso, TX',
        'EWX': 'Austin/San Antonio, TX',
        'EYW': 'Key West, FL',
        'FFC': 'Atlanta, GA',
        'FGF': 'Grand Forks, ND',
        'FGZ': 'Flagstaff, AZ',
        'FSD': 'Sioux Falls, SD',
        'FWD': 'Dallas/Fort Worth, TX',
        'GGW': 'Glasgow, MT',
        'GID': 'Hastings, NE',
        'GJT': 'Grand Junction, CO',
        'GLD': 'Goodland, KS',
        'GRB': 'Green Bay, WI',
        'GRR': 'Grand Rapids, MI',
        'GSP': 'Greer, SC',
        'GUM': 'Guam, GU',
        'GYX': 'Gray, ME',
        'HFO': 'Honolulu, HI',
        'HGX': 'Houston, TX',
        'HNX': 'Hanford, CA',
        'HUN': 'Huntsville, AL',
        'ICT': 'Wichita, KS',
        'ILM': 'Wilmington, NC',
        'ILN': 'Wilmington, OH',
        'ILX': 'Lincoln, IL',
        'IND': 'Indianapolis, IN',
        'IWX': 'Nrn. Indiana, IN',
        'JAN': 'Jackson, MS',
        'JAX': 'Jacksonville, FL',
        'JKL': 'Jackson, KY',
        'LBF': 'North Platte, NE',
        'LCH': 'Lake Charles, LA',
        'LIX': 'New Orleans, LA',
        'LKN': 'Elko, NV',
        'LMK': 'Louisville, KY',
        'LOT': 'Chicago, IL',
        'LOX': 'Los Angeles, CA',
        'LSX': 'St. Louis, MO',
        'LUB': 'Lubbock, TX',
        'LWX': 'Sterling, VA',
        'LZK': 'Little Rock, AR',
        'MAF': 'Midland/Odessa, TX',
        'MEG': 'Memphis, TN',
        'MFL': 'Miami, FL',
        'MFR': 'Medford, OR',
        'MHX': 'Morehead City, NC',
        'MKX': 'Milwaukee, WI',
        'MLB': 'Melbourne, FL',
        'MOB': 'Mobile, AL',
        'MPX': 'Twin Cities, MN',
        'MQT': 'Marquette, MI',
        'MRX': 'Morristown, TN',
        'MSO': 'Missoula, MT',
        'MTR': 'San Francisco, CA',
        'OAX': 'Omaha, NE',
        'OHX': 'Nashville, TN',
        'OKX': 'New York City, NY',
        'OTX': 'Spokane, WA',
        'OUN': 'Norman, OK',
        'PAH': 'Paducah, KY',
        'PBZ': 'Pittsburgh, PA',
        'PDT': 'Pendleton, OR',
        'PHI': 'Mount Holly, NJ',
        'PIH': 'Pocatello, ID',
        'PQR': 'Portland, OR',
        'PSR': 'Phoenix, AZ',
        'PUB': 'Pueblo, CO',
        'RAH': 'Raleigh, NC',
        'REV': 'Reno, NV',
        'RIW': 'Riverton, WY',
        'RLX': 'Charleston, WV',
        'RNK': 'Blacksburg, VA',
        'SEW': 'Seattle, WA',
        'SGF': 'Springfield, MO',
        'SGX': 'San Diego, CA',
        'SHV': 'Shreveport, LA',
        'SJT': 'San Angelo, TX',
        'SJU': 'San Juan, PR',
        'SLC': 'Salt Lake City, UT',
        'STO': 'Sacramento, CA',
        'TAE': 'Tallahassee, FL',
        'TBW': 'Tampa Bay Area, FL',
        'TFX': 'Great Falls, MT',
        'TOP': 'Topeka, KS',
        'TSA': 'Tulsa, OK',
        'TWC': 'Tucson, AZ',
        'UNR': 'Rapid City, SD',
        'VEF': 'Las Vegas, NV',
        'KEY': 'Key West, FL'
    },
    WFO_REGION_MAP: {
        'ABQ': 'nws_southern',
        'ABR': 'nws_central',
        'AFC': 'nws_alaska',
        'AFG': 'nws_alaska',
        'AJK': 'nws_alaska',
        'AKQ': 'nws_eastern',
        'ALY': 'nws_eastern',
        'AMA': 'nws_southern',
        'ANC': 'nws_alaska',
        'APX': 'nws_central',
        'ARX': 'nws_central',
        'BGM': 'nws_eastern',
        'BIS': 'nws_central',
        'BMX': 'nws_southern',
        'BOI': 'nws_western',
        'BOU': 'nws_central',
        'BOX': 'nws_eastern',
        'BRO': 'nws_southern',
        'BTV': 'nws_eastern',
        'BUF': 'nws_eastern',
        'BYZ': 'nws_western',
        'CAE': 'nws_eastern',
        'CAR': 'nws_eastern',
        'CHS': 'nws_eastern',
        'CLE': 'nws_eastern',
        'CRP': 'nws_southern',
        'CTP': 'nws_eastern',
        'CYS': 'nws_central',
        'DDC': 'nws_central',
        'DLH': 'nws_central',
        'DMX': 'nws_central',
        'DTX': 'nws_central',
        'DVN': 'nws_central',
        'EAX': 'nws_central',
        'EKA': 'nws_western',
        'EPZ': 'nws_southern',
        'EWX': 'nws_southern',
        'EYW': 'nws_southern',
        'FFC': 'nws_southern',
        'FGF': 'nws_central',
        'FGZ': 'nws_western',
        'FSD': 'nws_central',
        'FWD': 'nws_southern',
        'GGW': 'nws_western',
        'GID': 'nws_central',
        'GJT': 'nws_central',
        'GLD': 'nws_central',
        'GRB': 'nws_central',
        'GRR': 'nws_central',
        'GSP': 'nws_eastern',
        'GUM': 'nws_pacific',
        'GYX': 'nws_eastern',
        'HFO': 'nws_pacific',
        'HGX': 'nws_southern',
        'HNX': 'nws_western',
        'HUN': 'nws_southern',
        'KEY': 'nws_southern',
        'ICT': 'nws_central',
        'ILM': 'nws_eastern',
        'ILN': 'nws_eastern',
        'ILX': 'nws_central',
        'IND': 'nws_central',
        'IWX': 'nws_central',
        'JAN': 'nws_southern',
        'JAX': 'nws_southern',
        'JKL': 'nws_central',
        'LBF': 'nws_central',
        'LCH': 'nws_southern',
        'LIX': 'nws_southern',
        'LKN': 'nws_western',
        'LMK': 'nws_central',
        'LOT': 'nws_central',
        'LOX': 'nws_western',
        'LSX': 'nws_central',
        'LUB': 'nws_southern',
        'LWX': 'nws_eastern',
        'LZK': 'nws_southern',
        'MAF': 'nws_southern',
        'MEG': 'nws_southern',
        'MFL': 'nws_southern',
        'MFR': 'nws_western',
        'MHX': 'nws_eastern',
        'MKX': 'nws_central',
        'MLB': 'nws_southern',
        'MOB': 'nws_southern',
        'MPX': 'nws_central',
        'MQT': 'nws_central',
        'MRX': 'nws_southern',
        'MSO': 'nws_western',
        'MTR': 'nws_western',
        'OAX': 'nws_central',
        'OHX': 'nws_southern',
        'OKX': 'nws_eastern',
        'OTX': 'nws_western',
        'OUN': 'nws_southern',
        'PAH': 'nws_central',
        'PBZ': 'nws_eastern',
        'PDT': 'nws_western',
        'PHI': 'nws_eastern',
        'PIH': 'nws_western',
        'PQR': 'nws_western',
        'PSR': 'nws_western',
        'PUB': 'nws_central',
        'RAH': 'nws_eastern',
        'REV': 'nws_western',
        'RIW': 'nws_central',
        'RLX': 'nws_eastern',
        'RNK': 'nws_eastern',
        'SEW': 'nws_western',
        'SGF': 'nws_central',
        'SGX': 'nws_western',
        'SHV': 'nws_southern',
        'SJT': 'nws_southern',
        'SJU': 'nws_southern',
        'SLC': 'nws_western',
        'STO': 'nws_western',
        'TAE': 'nws_southern',
        'TBW': 'nws_southern',
        'TFX': 'nws_western',
        'TOP': 'nws_central',
        'TSA': 'nws_southern',
        'TWC': 'nws_western',
        'UNR': 'nws_central',
        'VEF': 'nws_western'
    },
    // Performance settings. Reports are drawn with WebGL (one symbol layer), so
    // tens of thousands display at once; the limits below are safety valves only.
    MAX_MARKERS: 100000, // Maximum markers to display
    MAX_MARKERS_WARNING: 50000, // Highlight the count when approaching the limit
    VIEWPORT_ONLY: false, // true: only count/show reports in the viewport when zoomed in
    MIN_ZOOM_FOR_VIEWPORT: 5, // Minimum (MapLibre) zoom level for viewport filtering
    ZOOM_BASED_LIMITS: {
        // Optional max markers per (MapLibre) zoom level, e.g. 3: 20000. Empty = no limit.
    }
};

// Weather category mappings
const WEATHER_CATEGORIES = {
    WINTER: ['Snow', 'Snow Squall', 'Sleet', 'Freezing Rain', 'Ice'],
    SEVERE: ['Tornado', 'Funnel Cloud', 'Waterspout', 'Thunderstorm', 'Hail'],
    PRECIP: ['Rain', 'Flood', 'Coastal Flooding', 'Snow', 'Snow Squall', 'Sleet', 'Freezing Rain', 'Ice'],
    TROPICAL: ['Rain', 'Flood', 'Coastal Flooding', 'Tropical']
};

// Report type mapping: rtype codes -> display names
const REPORT_TYPE_MAP = {
    "R": "Rain",
    "F": "Flood", "E": "Flood", "v": "Flood",
    "S": "Snow", "Z": "Snow",
    "5": "Ice", "s": "Sleet",
    "H": "Hail",
    "O": "Wind", "N": "Wind",
    "A": "Wind",
    "D": "Thunderstorm", "G": "Thunderstorm", "M": "Thunderstorm",
    "T": "Tornado", "C": "Funnel Cloud", "W": "Waterspout",
    "0": "Tropical", "Q": "Tropical",
    "X": "Temperature",
    "J": "Fog",
    "U": "Wildfire"
};

// Icon configuration by report type and magnitude thresholds
const ICON_CONFIG = {
    "R": { // Rain
        type: "circle",
        emoji: "🌧️",
        thresholds: [
            { max: 1, fill: "#b2f7b3", stroke: "black" },
            { max: 2, fill: "#5CBD5F", stroke: "black" },
            { max: 3, fill: "#27822E", stroke: "black" },
            { max: 4, fill: "#6BD7CB", stroke: "black" },
            { max: 5, fill: "#4B66B4", stroke: "black" },
            { max: 6, fill: "#513EA4", stroke: "black" },
            { max: 8, fill: "#6E3192", stroke: "black" },
            { max: Infinity, fill: "#F122E3", stroke: "black" }
        ]
    },
    "O": { // Non-thunderstorm wind
        type: "circle",
        emoji: "💨",
        thresholds: [
            { max: 35, fill: "#FFEDCC", stroke: "#333" },
            { max: 57, fill: "#FFB266", stroke: "#333" },
            { max: 75, fill: "#FF8000", stroke: "#333" },
            { max: Infinity, fill: "#996300", stroke: "#333" }
        ]
    },
    "N": { // Non-thunderstorm wind
        type: "circle",
        emoji: "💨",
        thresholds: [
            { max: 35, fill: "#FFEDCC", stroke: "#333" },
            { max: 57, fill: "#FFB266", stroke: "#333" },
            { max: 75, fill: "#FF8000", stroke: "#333" },
            { max: Infinity, fill: "#996300", stroke: "#333" }
        ]
    },
    "A": { // High sustained winds (same scale as other non-TS wind)
        type: "circle",
        emoji: "💨",
        thresholds: [
            { max: 35, fill: "#FFEDCC", stroke: "#333" },
            { max: 57, fill: "#FFB266", stroke: "#333" },
            { max: 75, fill: "#FF8000", stroke: "#333" },
            { max: Infinity, fill: "#996300", stroke: "#333" }
        ]
    },
    "S": { // Snow
        type: "circle",
        emoji: "❄️",
        thresholds: [
            { max: 0.1, fill: "#bdd7e7", stroke: "#bdd7e7" },
            { max: 1, fill: "#6baed6", stroke: "#6baed6" },
            { max: 2, fill: "#3182bd", stroke: "#3182bd" },
            { max: 3, fill: "#005199", stroke: "#005199" },
            { max: 6, fill: "#002694", stroke: "#002694" },
            { max: 8, fill: "#ffff96", stroke: "#ffff96" },
            { max: 12, fill: "#ffc400", stroke: "#ffc400" },
            { max: 18, fill: "#ff8700", stroke: "#ff8700" },
            { max: 24, fill: "#db1400", stroke: "#db1400" },
            { max: 30, fill: "#9e0000", stroke: "#9e0000" },
            { max: 36, fill: "#690000", stroke: "#690000" },
            { max: 48, fill: "#360000", stroke: "#360000" },
            { max: 60, fill: "#ccccff", stroke: "#ccccff" },
            { max: 72, fill: "#9f8cd8", stroke: "#9f8cd8" },
            { max: 84, fill: "#7c52a5", stroke: "#7c52a5" },
            { max: Infinity, fill: "#7c52a5", stroke: "white" }
        ]
    },
    "Z": { // Blizzard
        type: "circle",
        emoji: "❄️",
        fill: "#ffffff",
        stroke: "red"
    },
    "SQ": { // Snow Squall
        type: "circle",
        emoji: "❄️",
        fill: "#ffffff",
        stroke: "#dc2626"
    },
    "D": { // Thunderstorm wind
        type: "rect",
        emoji: "⛈️",
        thresholds: [
            { max: 50, fill: "yellow", stroke: "#333" },
            { max: 75, fill: "orange", stroke: "#333" },
            { max: Infinity, fill: "red", stroke: "#333" }
        ]
    },
    "G": { // Thunderstorm wind
        type: "rect",
        emoji: "⛈️",
        thresholds: [
            { max: 50, fill: "yellow", stroke: "#333" },
            { max: 75, fill: "orange", stroke: "#333" },
            { max: Infinity, fill: "red", stroke: "#333" }
        ]
    },
    "M": { // Thunderstorm wind
        type: "rect",
        emoji: "⛈️",
        thresholds: [
            { max: 50, fill: "yellow", stroke: "#333" },
            { max: 75, fill: "orange", stroke: "#333" },
            { max: Infinity, fill: "red", stroke: "#333" }
        ]
    },
    "0": { // Tropical
        type: "circle",
        emoji: "🌀",
        extractWindFromRemark: true,
        thresholds: [
            { max: 75, fill: "#FFFFFF", stroke: "red" },
            { max: 100, fill: "#808080", stroke: "red" },
            { max: Infinity, fill: "#000000", stroke: "red" }
        ]
    },
    "Q": { // Tropical
        type: "circle",
        emoji: "🌀",
        extractWindFromRemark: true,
        thresholds: [
            { max: 75, fill: "#FFFFFF", stroke: "red" },
            { max: 100, fill: "#808080", stroke: "red" },
            { max: Infinity, fill: "#000000", stroke: "red" }
        ]
    },
    "T": { // Tornado (confirmed): 🌪️ on red fill, red border ring
        type: "rect",
        emoji: "🌪️",
        fill: "#dc2626",
        stroke: "#7f1d1d"
    },
    "C": { // Legacy; prefer FC after normalization
        type: "rect",
        emoji: "🌪️",
        fill: "#dc2626",
        stroke: "#fff"
    },
    "W": { // Legacy landspout/tornado styling
        type: "rect",
        emoji: "🌪️",
        fill: "#dc2626",
        stroke: "#7f1d1d"
    },
    "FC": { // Funnel cloud: 🌪️ on red fill, white border
        type: "rect",
        emoji: "🌪️",
        fill: "#dc2626",
        stroke: "#fff"
    },
    "WS": { // Waterspout: same 🌪️ marker, blue fill + blue border
        type: "rect",
        emoji: "🌪️",
        fill: "#2563eb",
        stroke: "#1e40af"
    },
    "H": { // Hail
        type: "rect", // Rectangle/square to match severe thunderstorm style
        emoji: "⚪️", // Hailstone
        thresholds: [
            { max: 1, fill: "#FF99FF", stroke: "#333" },
            { max: 2, fill: "#FF3399", stroke: "#333" },
            { max: Infinity, fill: "#990099", stroke: "#333" }
        ]
    },
    "5": { // Ice / Freezing Rain
        type: "circle",
        emoji: "🧊",
        thresholds: [
            { max: 0.01, fill: "#999999", stroke: "#999999" },  // 0.00" or unknown
            { max: 0.10, fill: "#FFFF00", stroke: "#FFFF00" },  // 0.01-0.09"
            { max: 0.25, fill: "#FFA500", stroke: "#FFA500" },  // 0.10-0.24"
            { max: 0.50, fill: "#FF0000", stroke: "#FF0000" },  // 0.25-0.49"
            { max: 0.75, fill: "#992600", stroke: "#992600" },  // 0.50-0.74"
            { max: 1.00, fill: "#9966FF", stroke: "#9966FF" },  // 0.75-0.99"
            { max: 2.00, fill: "#7D19FF", stroke: "#7D19FF" },  // 1.00-1.99"
            { max: Infinity, fill: "#37007F", stroke: "#37007F" } // 2.00"+
        ]
    },
    "s": { // Sleet
        type: "circle",
        emoji: "⚪️",
        thresholds: [
            { max: 0.01, fill: "#999999", stroke: "#999999" },  // 0.00" or unknown
            { max: 0.50, fill: "#FF99FF", stroke: "#FF99FF" },  // 0.01-0.49"
            { max: 1.00, fill: "#FF3399", stroke: "#FF3399" },  // 0.50-0.99"
            { max: 2.00, fill: "#990099", stroke: "#990099" },  // 1.00-1.99"
            { max: 3.00, fill: "#7D19FF", stroke: "#7D19FF" },  // 2.00-2.99"
            { max: 4.00, fill: "#37007F", stroke: "#37007F" },  // 3.00-3.99"
            { max: Infinity, fill: "#000000", stroke: "#333" }   // 4.00"+
        ]
    },
    "F": { // Flood
        type: "circle",
        emoji: "💧",
        fill: "#b2f7b3",
        stroke: "red"
    },
    "E": { // Flood
        type: "circle",
        emoji: "💧",
        fill: "#b2f7b3",
        stroke: "red"
    },
    "v": { // Flood
        type: "circle",
        emoji: "💧",
        fill: "#b2f7b3",
        stroke: "red"
    },
    "X": { // Temperature
        type: "circle",
        emoji: "🌡️",
        thresholds: [
            { max: -20, fill: "#1e3a8a", stroke: "#fff" },      // Very cold - dark blue
            { max: 0, fill: "#3b82f6", stroke: "#fff" },        // Cold - blue
            { max: 20, fill: "#60a5fa", stroke: "#333" },       // Cool - light blue
            { max: 32, fill: "#93c5fd", stroke: "#333" },       // Freezing - pale blue
            { max: 50, fill: "#86efac", stroke: "#333" },       // Mild - light green
            { max: 70, fill: "#fde047", stroke: "#333" },       // Warm - yellow
            { max: 85, fill: "#fb923c", stroke: "#333" },       // Hot - orange
            { max: 100, fill: "#f87171", stroke: "#333" },      // Very hot - light red
            { max: Infinity, fill: "#dc2626", stroke: "#fff" }  // Extreme hot - dark red
        ]
    },
    "J": { // Fog (visibility in miles when magnitude present)
        type: "circle",
        emoji: "🌫️",
        thresholds: [
            { max: 0.25, fill: "#374151", stroke: "#9ca3af" },
            { max: 0.5, fill: "#4b5563", stroke: "#d1d5db" },
            { max: 1, fill: "#6b7280", stroke: "#e5e7eb" },
            { max: 3, fill: "#9ca3af", stroke: "#f3f4f6" },
            { max: Infinity, fill: "#d1d5db", stroke: "#111827" }
        ]
    },
    "U": { // Wildfire
        type: "circle",
        emoji: "🔥",
        fill: "#ea580c",
        stroke: "#7c2d12"
    }
};

const LEGEND_ITEMS = [
    { name: 'Rain', color: '#5CBD5F', emoji: '🌧️', shape: 'circle' },
    { name: 'Flood', color: '#b2f7b3', emoji: '💧', shape: 'circle' },
    { name: 'Coastal Flooding', color: '#b2f7b3', emoji: '🌊', shape: 'circle' },
    { name: 'Snow', color: '#6baed6', emoji: '❄️', shape: 'circle' },
    { name: 'Snow Squall', color: '#ffffff', emoji: '❄️', shape: 'circle' },
    { name: 'Sleet', color: '#FF99FF', emoji: '⚪️', shape: 'circle' },
    { name: 'Freezing Rain', color: '#FFA500', emoji: '🌧️', shape: 'square' },
    { name: 'Ice', color: '#FFFF00', emoji: '🧊', shape: 'circle' },
    { name: 'Hail', color: '#FF99FF', emoji: '⚪️', shape: 'square' },
    { name: 'Wind', color: '#FFEDCC', emoji: '💨', shape: 'circle' },
    { name: 'Thunderstorm', color: 'yellow', emoji: '⛈️', shape: 'square' },
    { name: 'Tornado', color: '#dc2626', emoji: '🌪️', shape: 'square' },
    { name: 'Funnel Cloud', color: '#dc2626', emoji: '🌪️', shape: 'square' },
    { name: 'Waterspout', color: '#2563eb', emoji: '🌪️', shape: 'square' },
    { name: 'Tropical', color: '#FFFFFF', emoji: '🌀', shape: 'circle' },
    { name: 'Temperature', color: '#60a5fa', emoji: '🌡️', shape: 'circle' },
    { name: 'Fog', color: '#9ca3af', emoji: '🌫️', shape: 'circle' },
    { name: 'Wildfire', color: '#ea580c', emoji: '🔥', shape: 'circle' },
    { name: 'Other', color: '#1f2937', emoji: '⚠️', shape: 'circle' }
];
