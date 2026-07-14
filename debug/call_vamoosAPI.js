const axios = require('axios');
const fs = require('fs');

const quoPrint_id = process.argv[2] || 6163;
const outFile = __dirname + '/last_response.json';

axios.post(`http://localhost:5100/reports/presto/vamoosAPI`, {
  data: { quoPrint_id: Number(quoPrint_id) }
})
  .then((res) => {
    console.log('STATUS', res.status);
    fs.writeFileSync(outFile, JSON.stringify(res.data, null, 2));
    console.log('Saved to', outFile);
  })
  .catch((err) => {
    console.error('STATUS', err.response ? err.response.status : 'no response');
    const body = err.response ? err.response.data : { message: err.message };
    fs.writeFileSync(outFile, JSON.stringify(body, null, 2));
    console.error('Saved to', outFile);
  });
