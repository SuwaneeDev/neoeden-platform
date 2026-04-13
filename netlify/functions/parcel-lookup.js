// NeoEden Parcel Lookup — Netlify Function
// Chain: Address → UGRC Geocode → Weber County LIR Feature Service → Parcel Data

exports.handler = async (event) => {
    const UGRC_API_KEY = process.env.UGRC_API_KEY;
    
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type'
    };

    if (!UGRC_API_KEY) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'API key not configured' }) };
    }

    // Accept both GET and POST
    let address = '';
    if (event.httpMethod === 'GET') {
        address = event.queryStringParameters?.address || '';
    } else if (event.httpMethod === 'POST') {
        try {
            const body = JSON.parse(event.body);
            address = body.address || '';
        } catch (e) {
            address = '';
        }
    } else if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    address = address.trim();
    if (!address) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Address is required' }) };
    }

    try {
        // --- STEP 1: Parse address into street + zone ---
        // Clean the address: remove UT, Utah, zip codes, extra spaces
        let cleaned = address
            .replace(/,?\s*(UT|Utah)\s*/gi, ',')
            .replace(/\s+\d{5}(-\d{4})?\s*$/, '')
            .replace(/,\s*,/g, ',')
            .replace(/,\s*$/, '')
            .trim();

        // Split into parts
        const parts = cleaned.split(',').map(s => s.trim()).filter(s => s.length > 0);
        
        let street = parts[0] || '';
        let zone = '';

        if (parts.length > 1) {
            zone = parts[1];
        } else {
            // No comma — try to extract city from common Weber County cities
            const weberCities = [
                'Ogden', 'North Ogden', 'Harrisville', 'South Ogden', 
                'Roy', 'Riverdale', 'Washington Terrace', 'Pleasant View',
                'West Haven', 'Marriott-Slaterville', 'Farr West', 'Plain City',
                'Uintah', 'Huntsville', 'Eden'
            ];
            
            for (const city of weberCities) {
                if (cleaned.toLowerCase().includes(city.toLowerCase())) {
                    street = cleaned.replace(new RegExp(city, 'i'), '').trim();
                    zone = city;
                    break;
                }
            }
            
            // If no city found in address, leave zone empty for fallback logic
            if (!zone) {
                zone = parts[1] || '';
            }
        }

        // Clean street: remove trailing/leading punctuation
        street = street.replace(/[,.]$/,'').trim();

        console.log(`Lookup: street="${street}" zone="${zone}"`);
// No default zone - let the geocoder handle it naturally based on street data
            if (!zone) {
                zone = ''; 
            }
        console.log(`Geocode URL: ${geocodeUrl}`);

        const geocodeRes = await fetch(geocodeUrl);
        const geocodeData = await geocodeRes.json();

        console.log(`Geocode response status: ${geocodeData.status}`);

        if (geocodeData.status !== 200 || !geocodeData.result) {
       const geocodeUrl = `https://api.mapserv.utah.gov/api/v1/geocode/${encodeURIComponent(street)}/${encodeURIComponent(zone)}?spatialReference=4326&apiKey=${UGRC_API_KEY}`;            const fallbackZips = ['84404', '84414', '84401', '84403', '84405', '84067'];
            let found = false;
            let fallbackResult = null;

            for (const zip of fallbackZips) {
                if (zip === zone) continue;
                const fallbackUrl = `https://api.mapserv.utah.gov/api/v1/geocode/${encodeURIComponent(street)}/${zip}?spatialReference=4326&apiKey=${UGRC_API_KEY}`;
                const fbRes = await fetch(fallbackUrl);
                const fbData = await fbRes.json();
                if (fbData.status === 200 && fbData.result) {
                    fallbackResult = fbData;
                    found = true;
                    console.log(`Found via fallback zip: ${zip}`);
                    break;
                }
            }

            if (!found) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({ error: `Address "${address}" not found. Please check the spelling and include city (e.g. 2485 Grant Ave, Ogden).` })
                };
            }
            
            // Use fallback result
            var location = fallbackResult.result.location;
            var matchAddr = fallbackResult.result.matchAddress || address;
        } else {
            var location = geocodeData.result.location;
            var matchAddr = geocodeData.result.matchAddress || address;
        }

        const lng = location.x;
        const lat = location.y;

        console.log(`Geocoded to: ${lat}, ${lng}`);
body: JSON.stringify({ error: `Address "${address}" not found. Try including the city (e.g., 2549 Washington Blvd, Ogden).` })        // --- STEP 3: Query Weber County LIR Feature Service ---
        const weberLirUrl = 'https://services1.arcgis.com/99lidPhWCzftIe9K/arcgis/rest/services/Utah_Weber_County_Parcels_LIR/FeatureServer/0/query';

        const queryParams = new URLSearchParams({
            where: '1=1',
            geometry: JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }),
            geometryType: 'esriGeometryPoint',
            spatialRel: 'esriSpatialRelIntersects',
            outFields: '*',
            returnGeometry: false,
            f: 'json'
        });

        const parcelRes = await fetch(`${weberLirUrl}?${queryParams.toString()}`);
        const parcelData = await parcelRes.json();

        if (!parcelData.features || parcelData.features.length === 0) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ 
                    error: 'Geocoded successfully but no parcel found. The address may be outside Weber County parcel coverage.',
                    coordinates: { lat, lng }
                })
            };
        }

        const a = parcelData.features[0].attributes;

        // --- STEP 4: Return formatted parcel data ---
        const result = {
            // Core identifiers
            parcel_id: a.SERIAL_NUM || a.PARCEL_ID || '',
            address: a.PARCEL_ADD || matchAddr,
            city: a.PARCEL_CITY || zone,
            zip: a.PARCEL_ZIP || '',
            county: 'Weber',
            state: 'UT',

            // Property characteristics  
            acres: a.PARCEL_ACRES ? Number(a.PARCEL_ACRES).toFixed(4) : '',
            lot_sqft: a.PARCEL_ACRES ? Math.round(Number(a.PARCEL_ACRES) * 43560) : '',
            building_sqft: a.BLDG_SQFT || a.TOT_BLDG_SQFT || '',
            year_built: a.BUILT_YR || a.EFFBUILT_YR || '',
            property_class: a.PROP_CLASS || '',
            subdivision: a.SUBDIV_NAME || '',
            tax_district: a.TAX_DISTRICT || '',
            market_value: a.TOTAL_MKT_VALUE || '',
            land_value: a.LAND_MKT_VALUE || '',
            floors: a.FLOORS_CNT || '',
            construction: a.CONST_MATERIAL || '',
            primary_res: a.PRIMARY_RES || '',

            // Coordinates
            coordinates: { lat, lng },
            
            // Metadata
            lookup_timestamp: new Date().toISOString(),
            data_source: 'UGRC + Weber County LIR'
        };

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(result)
        };

    } catch (err) {
        console.error('Parcel lookup error:', err);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Something went wrong: ' + err.message })
        };
    }
};
