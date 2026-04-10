exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    const UGRC_API_KEY = process.env.UGRC_API_KEY;
    if (!UGRC_API_KEY) {
        return { statusCode: 500, body: JSON.stringify({ error: 'API key not configured' }) };
    }

    try {
        const { address } = JSON.parse(event.body);
        if (!address) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Address is required' }) };
        }

        const parts = address.split(',').map(s => s.trim());
        const street = parts[0];
        let zone = 'Ogden';
        if (parts.length > 1) {
            zone = parts[1].replace(/\s*(UT|Utah)\s*/gi, '').trim();
            if (!zone && parts.length > 2) zone = parts[2].trim();
            if (!zone) zone = 'Ogden';
        }

        const geocodeUrl = `https://api.mapserv.utah.gov/api/v1/geocode/${encodeURIComponent(street)}/${encodeURIComponent(zone)}?spatialReference=4326&apiKey=${UGRC_API_KEY}`;
        const geocodeRes = await fetch(geocodeUrl);
        const geocodeData = await geocodeRes.json();

        if (geocodeData.status !== 200 || !geocodeData.result) {
            return { statusCode: 404, body: JSON.stringify({ error: 'Address not found. Please check and try again.' }) };
        }

        const { x: lng, y: lat } = geocodeData.result.location;
        const matchAddress = geocodeData.result.matchAddress || address;

        const weberLirUrl = 'https://services1.arcgis.com/99lidPhWCzftIe9K/arcgis/rest/services/Utah_Weber_County_Parcels_LIR/FeatureServer/0/query';
        const queryParams = new URLSearchParams({
            where: '1=1',
            geometry: JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }),
            geometryType: 'esriGeometryPoint',
            spatialRel: 'esriSpatialRelIntersects',
            outFields: 'PARCEL_ID,PARCEL_ADD,PARCEL_CITY,PARCEL_ZIP,TOTAL_MKT_VALUE,LAND_MKT_VALUE,PARCEL_ACRES,PROP_CLASS,PRIMARY_RES,HOUSE_CNT,SUBDIV_NAME,BLDG_SQFT,FLOORS_CNT,BUILT_YR,EFFBUILT_YR,CONST_MATERIAL,TAX_DISTRICT,SERIAL_NUM',
            returnGeometry: false,
            f: 'json'
        });

        const parcelRes = await fetch(`${weberLirUrl}?${queryParams.toString()}`);
        const parcelData = await parcelRes.json();

        if (!parcelData.features || parcelData.features.length === 0) {
            return { statusCode: 404, body: JSON.stringify({ error: 'No parcel found. Weber County addresses only.' }) };
        }

        const attrs = parcelData.features[0].attributes;

        const result = {
            address: attrs.PARCEL_ADD || matchAddress,
            city: attrs.PARCEL_CITY || zone,
            zip: attrs.PARCEL_ZIP || '',
            parcelId: attrs.PARCEL_ID || attrs.SERIAL_NUM || '',
            serialNumber: attrs.SERIAL_NUM || '',
            acres: attrs.PARCEL_ACRES ? Number(attrs.PARCEL_ACRES).toFixed(3) : '',
            marketValue: attrs.TOTAL_MKT_VALUE || '',
            landValue: attrs.LAND_MKT_VALUE || '',
            buildingSqFt: attrs.BLDG_SQFT || '',
            floors: attrs.FLOORS_CNT || '',
            yearBuilt: attrs.BUILT_YR || attrs.EFFBUILT_YR || '',
            constructionMaterial: attrs.CONST_MATERIAL || '',
            propertyClass: attrs.PROP_CLASS || '',
            primaryResidence: attrs.PRIMARY_RES || '',
            subdivision: attrs.SUBDIV_NAME || '',
            taxDistrict: attrs.TAX_DISTRICT || '',
            housesOnParcel: attrs.HOUSE_CNT || '',
            coordinates: { lat, lng },
            county: 'Weber',
            lookupTimestamp: new Date().toISOString()
        };

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(result)
        };

    } catch (err) {
        console.error('Parcel lookup error:', err);
        return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong. Please try again.' }) };
    }
};
