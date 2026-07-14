require('dotenv').config({ path: './config/.env' });
const axios = require('axios');
const keys = require('../config/keys');

const headers = {
  'X-USER-ACCESS-TOKEN': keys.vamoosApiKey,
  'X-OPERATOR-CODE': keys.vamoosOperatorCode,
  'Content-Type': 'application/json'
};

async function getItinerary(reference_code) {
  const { data } = await axios.get(`${keys.vamoosHost}/itinerary/${keys.vamoosOperatorCode}/${reference_code}`, { headers });
  return data;
}

(async () => {
  const trial = await getItinerary('trial100!');
  const tour9312 = await getItinerary('9312');

  console.log('=== trial100! locations ===');
  console.log(JSON.stringify(trial.locations, null, 2));

  console.log('=== 9312 locations ===');
  console.log(JSON.stringify(tour9312.locations, null, 2));

  console.log('=== trial100! sample detail with location_internal_id ===');
  console.log(JSON.stringify((trial.details || []).filter(d => d.location_internal_id), null, 2));

  console.log('=== 9312 sample detail with location_internal_id (first 2) ===');
  console.log(JSON.stringify((tour9312.details || []).filter(d => d.location_internal_id).slice(0, 2), null, 2));

  process.exit(0);
})().catch(err => { console.error(err.response ? err.response.data : err.message); process.exit(1); });
