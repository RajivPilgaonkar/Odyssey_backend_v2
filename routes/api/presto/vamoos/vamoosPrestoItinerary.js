const axios = require('axios');
const keys = require('../../../../config/keys');
const vamoosDbQueries = require('./vamoosDbQueries');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Vamoos expects dates as YYYY-MM-DD; SQL Server DATETIME columns come back either as a
// JS Date object or as a "YYYY-MM-DD HH:mm:ss" string depending on the driver, so handle both.
function toDateOnly(value) {
  if (!value) return undefined;
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

async function waitForJob(jobId, headers) {
  const job_url = `${keys.vamoosHost}/job/${jobId}`;

  for (let attempt = 1; attempt <= 10; attempt++) {
    await sleep(1000);

    const { data: job } = await axios.get(job_url, { headers });
    console.log(`[vamoosAPI] job ${jobId} status (attempt ${attempt}):`, job.status);

    if (job.status !== 'enqueued' && job.status !== 'processing') {
      return job;
    }
  }

  throw new Error(`Job ${jobId} did not complete in time`);
}

// if the response was a 202 (queued), wait for the job to finish and return its result instead
async function resolveResponse(response, headers) {
  if (response.status !== 202) {
    return response.data;
  }

  const job = await waitForJob(response.data.id, headers);

  if (job.status === 'failed') {
    const error = new Error(job.error_message || 'Job failed');
    error.response = { status: 400, data: job };
    throw error;
  }

  return job;
}

// Vamoos' Unsplash proxy returns image_url with a stray extra "?" (it should be "&")
// separating the ixlib param from the resize params. Vamoos still fetches the raw file fine,
// but its thumbnail/variant generator chokes on the malformed URL and silently produces no
// variants, so apps have nothing to display and fall back to the itinerary's background image.
function fixUnsplashUrl(url) {
  const parts = url.split('?');
  return parts.length <= 2 ? url : `${parts[0]}?${parts.slice(1).join('&')}`;
}

// Looks up stock photos for a search term via Vamoos' own Unsplash proxy (the same
// source that powers the "suggested images" grid in the portal editor), and returns them
// in the shape expected by a library_node_upload (file_url + name).
async function findStockImages(term, count, headers) {
  const search_url = `${keys.vamoosHost}/proxies/unsplash/search?term=${encodeURIComponent(term)}&count=${count}`;

  const { data } = await axios.get(search_url, { headers });

  return (data || []).map((result) => ({
    file_url: fixUnsplashUrl(result.image_url),
    name: (result.attribution && result.attribution.author_name)
      ? `Photo by ${result.attribution.author_name} on Unsplash`
      : term
  }));
}

// Vamoos reference_codes (passcodes) stay reserved even once deactivated, so a plain
// create fails with "passcode already taken" on a rerun. Look up any existing itinerary
// (including deactivated ones) and reuse its vamoos_id so the create becomes an in-place update.
async function findExistingVamoosId(operator_code, reference_code, headers) {
  // built manually and fully percent-encoded - Vamoos rejects axios's default
  // encoding of the "f" JSON filter param (it leaves { } " : unescaped)
  const query = `archived=on&f=${encodeURIComponent(JSON.stringify({ reference_code }))}`;
  const list_url = `${keys.vamoosHost}/itinerary?${query}`;

  const { data } = await axios.get(list_url, { headers });

  const existing = data.items && data.items[0];
  return existing ? existing.vamoos_id : null;
}

module.exports = (app,db,sequelize) => {

  const dbQueries = vamoosDbQueries(sequelize);

  /*=== trial route: create a basic Vamoos itinerary ===*/
  app.post('/reports/presto/vamoosAPI', async (req, res) => {

    console.log('[vamoosAPI] request body', req.body);

    const quoPrint_id = req.body.data.quoPrint_id;

    let vamoosData;
    try {
      vamoosData = await dbQueries.getVamoosItineraryData(quoPrint_id);
    } catch (err) {
      console.error('[vamoosAPI] failed to get Vamoos itinerary data', err);
      return res.status(400).json({ message: "error while trying to get Vamoos itinerary data" });
    }

    console.log('[vamoosAPI] db data', vamoosData);

    const operator_code = req.body.operator_code || keys.vamoosOperatorCode;
    const reference_code = req.body.reference_code || String(vamoosData.quoPrint.Quotations_id);

    if (!reference_code) {
      return res.status(400).json({ message: 'reference_code is required' });
    }

    const itinerary_url = `${keys.vamoosHost}/itinerary/${operator_code}/${reference_code}`;

    const headers = {
      'X-USER-ACCESS-TOKEN': keys.vamoosApiKey,
      'X-OPERATOR-CODE': operator_code,
      'Content-Type': 'application/json'
    };

    try {
      const vamoos_id = await findExistingVamoosId(operator_code, reference_code, headers);

      // basic trial payload, following the Vamoos "Create An Itinerary" guide
      const itinerary_data = {
        departure_date: req.body.departure_date || toDateOnly(vamoosData.quoPrint.StartDate) || '2020-09-22',
        return_date: req.body.return_date || toDateOnly(vamoosData.quoPrint.EndDate) || '2020-09-30',
        field1: vamoosData.quoPrint.country || 'Rome Trip 2020',
        field3: vamoosData.quoPrint.PaxInfo || '--',
        client_reference: vamoosData.quoPrint.Reference || '',
        background: req.body.background || {
          file_url: 'https://upload.wikimedia.org/wikipedia/commons/5/53/Colosseum_in_Rome%2C_Italy_-_April_2007.jpg',
          name: "Colosseum"
        },
        locations: req.body.locations || [
          {
            name: 'Vamoosia',
            description: 'A fictional test city used to try out the locations field.',
            latitude: 12.3456,
            longitude: 65.4321
          },
          {
            name: 'Trialburg',
            description: 'A second fictional test city, for checking multiple locations at once.',
            latitude: -8.1234,
            longitude: 34.5678
          }
        ],
        details: req.body.details || await (async () => {
          // fetch enough images per city up front (one per occurrence) so repeats of the
          // same city cycle through different photos instead of reusing the same one
          const occurrencesByCity = {};
          vamoosData.quoPrintDays.forEach((day) => {
            occurrencesByCity[day.city] = (occurrencesByCity[day.city] || 0) + 1;
          });

          const imagesByCity = {};
          await Promise.all(Object.keys(occurrencesByCity).map(async (city) => {
            imagesByCity[city] = await findStockImages(city, occurrencesByCity[city], headers);
          }));

          const usedCountByCity = {};
          return vamoosData.quoPrintDays.map((day) => {
            const images = imagesByCity[day.city] || [];
            const index = usedCountByCity[day.city] || 0;
            usedCountByCity[day.city] = index + 1;
            const image = images[index % (images.length || 1)];

            return {
              headline: day.city,
              content: day.DaySummaryInfo,
              content_type: 'html',
              meta: { day_number: day.SrNo },
              ...(image ? { image } : {})
            };
          });
        })(),
        ...(vamoos_id ? { vamoos_id, is_active: true } : {})
      };

      console.log(vamoos_id
        ? `[vamoosAPI] updating existing itinerary vamoos_id=${vamoos_id} at ${itinerary_url}`
        : `[vamoosAPI] creating new itinerary at ${itinerary_url}`);
      console.log('[vamoosAPI] payload', itinerary_data);

      const response = await axios.post(itinerary_url, itinerary_data, { headers });
      const result = await resolveResponse(response, headers);

      console.log('[vamoosAPI] done', result);
      res.status(200).json(result);

    } catch (err) {
      const status = err.response ? err.response.status : 500;
      const data = err.response ? err.response.data : { message: err.message };
      console.error(`[vamoosAPI] failed ${status}`, data);
      res.status(status).json(data);
    }

  });

};
