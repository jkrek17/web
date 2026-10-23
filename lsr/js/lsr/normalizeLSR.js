// ============================================================================
// LSR normalization (shared by map app and reports table)
// ============================================================================

import { getUnitForReportType, getReportTypeName, isCoastalFlood } from '../utils/formatters.js';

/**
 * @param {object} geoJsonData - GeoJSON FeatureCollection from LSR API
 * @param {object} reportTypeMap - same as global REPORT_TYPE_MAP in config.js
 * @returns {{ normalized: Array<object>, stats: object }}
 */
export function normalizeLSRReports(geoJsonData, reportTypeMap) {
    const features = geoJsonData?.features || [];
    const normalized = [];
    const stats = {
        total: features.length,
        invalidCoords: 0,
        invalidSamples: []
    };
    const invalidSampleLimit = 50;

    for (const feature of features) {
        const props = feature.properties || {};
        const lat = parseFloat(props.lat);
        const lon = parseFloat(props.lon);

        if (isNaN(lat) || isNaN(lon)) {
            stats.invalidCoords++;
            if (stats.invalidSamples.length < invalidSampleLimit) {
                stats.invalidSamples.push({
                    type: props.typetext || getReportTypeName(props.type || props.rtype || '', reportTypeMap),
                    rtype: props.type || props.rtype || '',
                    magnitude: props.magnitude || 0,
                    location: [props.city, props.st || props.state].filter(Boolean).join(', '),
                    time: props.valid || '',
                    lat: props.lat,
                    lon: props.lon
                });
            }
            continue;
        }

        let rtype = props.type || props.rtype || '';
        const typetext = props.typetext || '';
        const remark = props.remark || '';

        const upperTypetext = typetext ? typetext.toUpperCase() : '';
        const lowerTypetext = typetext ? typetext.toLowerCase() : '';
        const isSnowSquall = upperTypetext.includes('SNOW SQUALL');

        const isTemperature = upperTypetext && (
            upperTypetext.includes('TEMPERATURE') ||
            upperTypetext.includes('EXTREME TEMP') ||
            upperTypetext.includes('EXTREME COLD') ||
            upperTypetext.includes('WIND CHILL') ||
            upperTypetext.includes('HEAT INDEX') ||
            upperTypetext.includes('EXTREME HEAT') ||
            (upperTypetext.includes('COLD') && (upperTypetext.includes('WARNING') || upperTypetext.includes('ADVISORY'))) ||
            (upperTypetext.includes('HEAT') && (upperTypetext.includes('WARNING') || upperTypetext.includes('ADVISORY')))
        );
        const isFreezingRain = upperTypetext.includes('FREEZING RAIN') ||
            upperTypetext.includes('FREEZING_RAIN') ||
            upperTypetext.includes('FREEZING DRIZZLE') ||
            upperTypetext.includes('FREEZING_DRIZZLE') ||
            upperTypetext.includes('FZRA');
        const isSleet = upperTypetext.includes('SLEET');
        const isCoastalFloodReport = ['F', 'E', 'v'].includes(rtype) && isCoastalFlood(typetext, remark);
        const isFog = upperTypetext.includes('FOG');
        const isWildfire = upperTypetext.includes('WILDFIRE') ||
            upperTypetext.includes('BRUSH FIRE') ||
            upperTypetext.includes('GRASS FIRE') ||
            upperTypetext.includes('WILDFIRES');
        const isWaterspoutText = upperTypetext.includes('WATERSPOUT');
        const isLandspoutText = upperTypetext.includes('LANDSPOUT');
        const isFunnelCloud = upperTypetext.includes('FUNNEL CLOUD') || upperTypetext.includes('FUNNEL_CLOUD');
        const isHighSustainedWind = rtype === 'A' ||
            upperTypetext.includes('HIGH SUST WIND') ||
            upperTypetext.includes('HIGH SUSTAINED') ||
            (upperTypetext.includes('SUSTAINED') && upperTypetext.includes('WIND'));

        let iconRtype = rtype;
        if (isSnowSquall) {
            iconRtype = 'SQ';
        }
        if (isSleet) {
            iconRtype = 's';
        }
        if (isTemperature) {
            iconRtype = 'X';
        }
        if (isFog) {
            iconRtype = 'J';
        }
        if (isWildfire) {
            iconRtype = 'U';
        }
        if (isHighSustainedWind) {
            iconRtype = 'O';
        }
        if (rtype === 'T' && isFunnelCloud) {
            iconRtype = 'FC';
        } else if (rtype === 'C') {
            iconRtype = isFunnelCloud ? 'FC' : 'T';
        } else if (rtype === 'W') {
            if (isWaterspoutText) {
                iconRtype = 'WS';
            } else if (isLandspoutText) {
                iconRtype = 'T';
            }
        }

        let filterType;
        if (isTemperature) {
            filterType = 'Temperature';
        } else if (isSnowSquall) {
            filterType = 'Snow Squall';
        } else if (isFreezingRain) {
            filterType = 'Freezing Rain';
        } else if (isSleet) {
            filterType = 'Sleet';
        } else if (isCoastalFloodReport) {
            filterType = 'Coastal Flooding';
        } else if (isFog) {
            filterType = 'Fog';
        } else if (isWildfire) {
            filterType = 'Wildfire';
        } else if (isHighSustainedWind) {
            filterType = 'Wind';
        } else if (iconRtype === 'FC') {
            filterType = 'Funnel Cloud';
        } else if (iconRtype === 'WS') {
            filterType = 'Waterspout';
        } else if (rtype === 'W' && isLandspoutText) {
            filterType = 'Tornado';
        } else {
            filterType = getReportTypeName(rtype, reportTypeMap);
        }

        let magnitude = parseFloat(props.magnitude) || 0;
        const valid = (props.valid || '').replace('T', ' ');
        const city = props.city || '';
        const state = props.st || props.state || '';
        const wfo = props.wfo || '';

        let category = getReportTypeName(rtype, reportTypeMap);
        if (isSnowSquall) {
            category = 'Snow Squall';
        } else if (isFreezingRain) {
            category = 'Freezing Rain';
        } else if (isSleet) {
            category = 'Sleet';
        } else if (isCoastalFloodReport) {
            category = 'Coastal Flooding';
        } else if (isFog) {
            category = 'Fog';
        } else if (isWildfire) {
            category = 'Wildfire';
        } else if (isHighSustainedWind) {
            category = typetext || 'Wind';
        } else if (iconRtype === 'FC') {
            category = 'Funnel Cloud';
        } else if (iconRtype === 'WS') {
            category = 'Waterspout';
        }

        if (isSnowSquall) {
            magnitude = 0;
        }

        if (lowerTypetext.includes('tropical')) {
            category = 'Tropical';
        } else if (typetext && !lowerTypetext.includes('unknown') && !isFreezingRain && !isSleet && !isCoastalFloodReport && !isSnowSquall && !isFog && !isWildfire && !isHighSustainedWind && iconRtype !== 'FC' && iconRtype !== 'WS') {
            category = typetext;
        }

        const unit = getUnitForReportType(iconRtype);
        const iconMagnitude = isSnowSquall ? 0 : magnitude;
        const locationStr = city + (state ? ', ' + state : '');

        normalized.push({
            lat,
            lon,
            rtype,
            iconRtype,
            typetext,
            remark,
            magnitude,
            iconMagnitude,
            unit,
            location: locationStr,
            state,
            wfo,
            time: valid,
            type: category,
            category,
            filterType,
            isSnowSquall,
            isFreezingRain,
            isSleet,
            isCoastalFloodReport,
            isFog,
            isWildfire
        });
    }

    stats.normalized = normalized.length;

    return { normalized, stats };
}
