require('dotenv').config({ path: './config/.env' });
const axios = require('axios');
const keys = require('../config/keys');

const headers = {
  'X-USER-ACCESS-TOKEN': keys.vamoosApiKey,
  'X-OPERATOR-CODE': keys.vamoosOperatorCode,
  'Content-Type': 'application/json'
};

(async () => {
  const { data } = await axios.get(`${keys.vamoosHost}/itinerary/${keys.vamoosOperatorCode}/9312`, { headers });

  const cards = (data.details || []).filter(d => (d.headline || '').toLowerCase().includes('vande bharat') || (d.headline || '').toLowerCase().includes('train ticket'));

  console.log('=== matching cards ===');
  console.log(JSON.stringify(cards, null, 2));

  console.log('=== top-level keys ===');
  console.log(Object.keys(data));

  process.exit(0);
})().catch(err => { console.error(err.response ? JSON.stringify(err.response.data, null, 2) : err.message); process.exit(1); });
