const axios = require('axios');

/*=== This image is fetched from a URL ===*/
async function fetchImage(src) {

  try {
    const image = await axios
    .get(src, {
        responseType: 'arraybuffer'
    });
    //.then(response => Buffer.from(response.data, 'binary').toString('base64'));
    return image.data;
  } catch {
    console.log('Could not fetch ' + src);
    return null;
  }
  //return Buffer.from(image.data, 'binary')/*.toString('base64')*/;
}  

module.exports = { fetchImage };