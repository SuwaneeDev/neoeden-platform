// NeoEden Parcel Lookup — Netlify Function
exports.handler = async (event) => {
    const UGRC_API_KEY = process.env.UGRC_API_KEY;
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type'
    };

    if (!UGRC_API_KEY) return { statusCode: 500, headers, body: JSON.stringify({ error: 'API key not configured' }) };

    let address = '';
    if (event.httpMethod === 'POST') {
        try {
            const body = JSON.parse(event.body);
            address = body.address || '';
        } catch (e) { address = ''; }
    } else {
        address = event.queryStringParameters?.address || '';
    }

    address = address.trim();
    if (!address) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Address is required' }) };

    try {
        // Clean address
        let cleaned = address.replace(/,?\s*(UT|Utah)\s*/gi, ',').replace(/\s+\d{5}(-\d{4})?\s*$/, '').trim();
        const parts = cleaned.split(',').map(s => s.trim());
        let street = parts[0];
        let zone = parts[1] || ''; // NO HARDCODED DEFAULT

        console.log(`SYSTEM_CHECK: Searching for Street: "${street}" in Zone: "${zone}"`);

        const geocodeUrl = `https://api.mapserv.utah.gov/api/v1/geocode/${encodeURIComponent(street)}/${encodeURIComponent(zone)}?spatialReference=4326&apiKey=${UGRC_API_KEY}`;
        const geocodeRes = await fetch(geocodeUrl);
        const geocodeData = await geocodeRes.json();

        if (geocodeData.status !== 200 || !geocodeData.result) {
            return { statusCode: 404, headers, body: JSON.stringify({ error: `Address "${address}" not found. Try format: 1074 Wahlen Way, Harrisville` }) };
        }

        const { x: lng, y: lat } = geocodeData.result.location;
        const weberLirUrl = 'https://services1.arcgis.com/99lidPhWCzftIe9K/arcgis/rest/services/Utah_Weber_County_Parcels_LIR/FeatureServer/0/query';
        const queryParams = new URLSearchParams({
            where: '1=1',
            geometry: JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }),
            geometryType: 'esriGeometryPoint',
            spatialRel: 'esriSpatialRelIntersects',
            outFields: '*',
            f: 'json'
        });

        const parcelRes = await fetch(`${weberLirUrl}?${queryParams.toString()}`);
        const parcelData = await parcelRes.json();
        const a = parcelData.features?.[0]?.attributes;

        if (!a) return { statusCode: 404, headers, body: JSON.stringify({ error: 'No parcel found at these coordinates.' }) };

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                parcel_id: a.SERIAL_NUM || a.PARCEL_ID,
                address: a.PARCEL_ADD || address,
                city: a.PARCEL_CITY || zone,
                acres: a.PARCEL_ACRES ? Number(a.PARCEL_ACRES).toFixed(4) : '',
                lot_sqft: a.PARCEL_ACRES ? Math.round(Number(a.PARCEL_ACRES) * 43560) : '',
                building_sqft: a.BLDG_SQFT || '',
                year_built: a.BUILT_YR || '',
                property_class: a.PROP_CLASS || ''
            })
        };
    } catch (err) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
};
