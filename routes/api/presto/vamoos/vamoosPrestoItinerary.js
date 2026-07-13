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

// Gets an Imsert API key for the current operator (Imsert is Vamoos' separate AI image
// search product - it indexes the operator's own uploaded photo library via AI/semantic
// search, not just generic stock). This isn't a documented public endpoint of Imsert's own
// API; the key-issuing call is documented on Vamoos' side, the rest was found by reading
// Vamoos' own portal frontend, so treat it as liable to change without notice.
async function getImsertApiKey(headers) {
  const { data } = await axios.post(`${keys.vamoosHost}/operator/imsert/key`, undefined, { headers });
  return data.api_key;
}

// Looks up photos for a search term via Imsert's own search API (separate from Vamoos), skipping
// any already claimed by another card (Imsert indexes the same underlying operator S3 storage
// the Library search covers, plus more, so the same photo can surface via either path). Fetches
// a small buffer beyond `count` to have room to skip duplicates and still return enough results.
async function findImsertImages(term, count, imsertApiKey, usedImageIds) {
  const { data } = await axios.post('https://live.imsert.com/search',
    { text: { high: { text: term } }, perPage: count + 5, page: 1 },
    { headers: { Authorization: `Bearer ${imsertApiKey}`, 'Content-Type': 'application/json' } });

  const results = [];
  for (const result of (data.results || [])) {
    const key = `imsert:${result.image.imageUrl.split('?')[0]}`;
    if (usedImageIds.has(key)) continue;

    usedImageIds.add(key);
    results.push({ file_url: result.image.imageUrl, name: result.image.name || term });
    if (results.length >= count) break;
  }

  return results;
}

// Lists the operator's own uploaded library images (root /library/ folder) once per request,
// so callers can check whether a photo already exists there before searching/uploading a new
// one. Note: Vamoos wants the "path" param's slashes literal, not percent-encoded (the OpenAPI
// spec marks it allowReserved) - axios's default query serializer breaks this, so the path is
// built directly into the URL string instead of passed via axios's `params` option.
async function listLibraryImages(headers) {
  const list_url = `${keys.vamoosHost}/file/list?path=/library/&count=200&order_by=name`;
  const { data } = await axios.get(list_url, { headers });

  return (data.items || []).filter((item) =>
    !item.is_folder && item.file && item.file.mime_type && item.file.mime_type.startsWith('image/'));
}

// Finds an already-uploaded library image whose name contains the search term (case-insensitive
// substring match) and hasn't already been claimed by another card, returning it as a
// file_id_upload_object so Vamoos reuses the existing file instead of re-uploading it, or null
// if nothing matches. Marks whatever it returns as used so no two cards get the same photo.
function findLibraryImage(libraryImages, term, usedImageIds) {
  const match = libraryImages.find((item) =>
    item.name.toLowerCase().includes(term.toLowerCase()) && !usedImageIds.has(`library:${item.file.id}`));

  if (!match) return null;

  usedImageIds.add(`library:${match.file.id}`);
  return { file_id: match.file.id, name: match.name };
}

// Downloads a file from a URL our own backend can reach (e.g. the operator's local image
// library over the LAN) and re-uploads it to Vamoos' own S3 storage via its presigned-upload
// flow, since Vamoos' cloud servers can't reach a private LAN address themselves. Returns it
// in library_node_upload shape, or null if the source URL isn't reachable/doesn't exist.
async function uploadLocalFile(source_url, filename, headers) {
  let bytes;
  try {
    const response = await axios.get(source_url, { responseType: 'arraybuffer' });
    bytes = response.data;
  } catch (err) {
    return null;
  }

  const { data: upload } = await axios.post(`${keys.vamoosHost}/file/upload_url`,
    { filename, content_type: 'image/jpeg' },
    { headers });

  await axios.put(upload.url, bytes, { headers: { 'Content-Type': 'image/jpeg' } });

  return { file_url: upload.s3url, name: filename };
}

// Checks whether the operator's own local city photo library has a numbered shot for this
// city/occurrence (e.g. .../city/city_103_large_2.jpg). Returns null if that file doesn't
// exist, so the caller can fall back to a stock photo.
async function findLocalImage(imageBaseUrl, cities_id, srno, headers) {
  if (!imageBaseUrl || !cities_id) return null;

  const base = imageBaseUrl.endsWith('/') ? imageBaseUrl : `${imageBaseUrl}/`;
  const filename = `city_${cities_id}_large_${srno}.jpg`;

  return uploadLocalFile(`${base}city/${filename}`, filename, headers);
}

// The operator's local "home/explore_1.jpg" image, used as the itinerary's cover photo.
// Returns null if that file doesn't exist, so the caller can fall back to a stock photo.
async function findLocalHomeImage(imageBaseUrl, headers) {
  if (!imageBaseUrl) return null;

  const base = imageBaseUrl.endsWith('/') ? imageBaseUrl : `${imageBaseUrl}/`;

  return uploadLocalFile(`${base}home/explore_1.jpg`, 'explore_1.jpg', headers);
}

// Builds one locations[] entry per unique hotel (deduped by name) from the hotel-by-day query,
// assigning each a stable internal_id, plus a day-number -> internal_id map so each day's
// storyboard card can be "connected" to its hotel via location_internal_id.
function buildHotelLocations(hotelsByDay) {
  const locations = [];
  const internalIdByHotelName = {};
  const internalIdByDayNo = {};
  let nextInternalId = 1;

  hotelsByDay.forEach((row) => {
    if (!row.Hotel) return;

    if (!internalIdByHotelName[row.Hotel]) {
      const internal_id = nextInternalId++;
      internalIdByHotelName[row.Hotel] = internal_id;
      locations.push({
        internal_id,
        name: row.Hotel,
        latitude: row.Latitude,
        longitude: row.Longitude,
        description: [row.address, row.Contact].filter(Boolean).join(' — ')
      });
    }

    internalIdByDayNo[row.DayNo] = internalIdByHotelName[row.Hotel];
  });

  return { locations, internalIdByDayNo };
}

// Trims redundant pax-count/date/time clauses out of a ServiceDesc, since that info is already
// conveyed by the row's own AtTime and the day the storyboard card belongs to, e.g.
// "Transfer... for 4 pax on 27-03-2027 at 13:00 hrs by 1 A/C Toyota Innova. Pax arrive by on
// 27-03-2027 at 13:00 hrs." -> "Transfer... by 1 A/C Toyota Innova."
function trimServiceDesc(text) {
  if (!text) return text;

  return text
    .replace(/\s+for \d+ pax\b/gi, '')
    .replace(/\s+on \d{2}-\d{2}-\d{4} at \d{2}:\d{2} hrs\b/gi, '')
    .replace(/\s*Pax arrive by[^.]*\.\s*$/i, '')
    // drop logistics/admin sentences (guide/vehicle arrangement, payment notes) - a period only
    // ends the sentence here if followed by whitespace+capital letter or end of string, so it
    // doesn't stop early at an abbreviation's period (e.g. "Govt.")
    .replace(/\s*Please provide.*?\.(?=\s+[A-Z]|\s*$)/g, '')
    .replace(/\s*Entrance Fees.*?\.(?=\s+[A-Z]|\s*$)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Simplifies an accommodation-booking ServiceDesc down to just the room type and night count,
// since bed-count/AC-class/meal-basis/date details are booking minutiae the traveler doesn't
// need on the storyboard, e.g. "1 Double and 1 Twin AC Heritage Splendour Rooms on a Bed &
// breakfast basis from 27-03-2027 to 29-03-2027 (2 nights)." -> "Stay in Heritage Splendour
// Rooms (2 nights)". Returns null (not a plain string) if the text doesn't match this shape,
// so the caller can fall back to the general trim instead.
function trimAccommodationDesc(text) {
  const match = text && text.match(
    /\b(?:Non-AC|AC)\s+(.+?)\s+on\s+a\s+.+?\s+basis\s+from\s+\d{2}-\d{2}-\d{4}\s+to\s+\d{2}-\d{2}-\d{4}\s+(\([^)]*night[^)]*\))/i);

  return match ? `Stay in ${match[1]} ${match[2]}` : null;
}

// Builds a day-number -> HTML string map from the chronological services list (per
// EXEC p_Rpt_QuoTourHotelAgentList), bolding each row's time. The phone app's content renderer
// isn't a full HTML parser: it displays <br> and &nbsp; as literal text instead of formatting
// them (confirmed by direct testing), but does support <p> and <strong> with plain spaces - so
// each row becomes its own <p> block (no <br> joins) with real spaces, not &nbsp;, after the time.
function buildServiceSummaryByDayNo(servicesByDay) {
  const rowsByDayNo = {};
  servicesByDay.forEach((row) => {
    (rowsByDayNo[row.DayNo] = rowsByDayNo[row.DayNo] || []).push(row);
  });

  const summaryByDayNo = {};
  Object.keys(rowsByDayNo).forEach((dayNo) => {
    summaryByDayNo[dayNo] = rowsByDayNo[dayNo]
      .map((row) => {
        const description = trimAccommodationDesc(row.ServiceDesc) || trimServiceDesc(row.ServiceDesc);
        return `<p><strong>${row.AtTime}</strong>   ${description}</p>`;
      })
      .join('');
  });

  return summaryByDayNo;
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
      const { locations: hotelLocations, internalIdByDayNo } = buildHotelLocations(vamoosData.hotelsByDay);
      const imsertApiKey = await getImsertApiKey(headers);
      const libraryImages = await listLibraryImages(headers);

      // shared across every image lookup below (background, hotel cards, narrative cards) so
      // the same underlying photo never gets claimed by more than one card
      const usedImageIds = new Set();

      // the cover photo is always the Taj Mahal, for every itinerary regardless of destination -
      // sourced through Library/Imsert (properly re-hosted with sharp variants) rather than the
      // static Wikipedia fallback, which is only used if neither source has a match
      const backgroundImages = await findImsertImages('Taj Mahal', 3, imsertApiKey, usedImageIds);

      // basic trial payload, following the Vamoos "Create An Itinerary" guide
      const itinerary_data = {
        departure_date: req.body.departure_date || toDateOnly(vamoosData.quoPrint.StartDate) || '2020-09-22',
        return_date: req.body.return_date || toDateOnly(vamoosData.quoPrint.EndDate) || '2020-09-30',
        field1: vamoosData.quoPrint.country || 'Rome Trip 2020',
        field3: vamoosData.quoPrint.PaxInfo || '--',
        client_reference: vamoosData.quoPrint.Reference || '',
        background: req.body.background
          || findLibraryImage(libraryImages, 'Taj Mahal', usedImageIds)
          || backgroundImages[0]
          || {
            file_url: 'https://upload.wikimedia.org/wikipedia/commons/f/f3/Taj_Mahal%2C_Agra.jpg',
            name: "Taj Mahal"
          },
        locations: req.body.locations || hotelLocations,
        details: req.body.details || await (async () => {
          const serviceSummaryByDayNo = buildServiceSummaryByDayNo(vamoosData.servicesByDay);

          // number each day by its occurrence within its city (1st Delhi day = 1, 2nd = 2, ...)
          const occurrencesByCity = {};
          const daysWithSrno = vamoosData.quoPrintDays.map((day) => {
            const srno = (occurrencesByCity[day.city] || 0) + 1;
            occurrencesByCity[day.city] = srno;
            return { ...day, srno };
          });

          // hotel cards claim their image first - a hotel-name match is more precise than a
          // generic city match, so it shouldn't lose out to a same-named city card
          const hotelCardsByDayNo = {};
          await Promise.all(vamoosData.hotelsByDay.map(async (row) => {
            const image = findLibraryImage(libraryImages, row.Hotel, usedImageIds)
              || (await findImsertImages(row.Hotel, 1, imsertApiKey, usedImageIds))[0]
              || null;

            hotelCardsByDayNo[row.DayNo] = {
              headline: row.Hotel,
              content: [row.address, row.Contact].filter(Boolean).join(' — '),
              content_type: 'text/html',
              meta: { day_number: row.DayNo },
              location_internal_id: internalIdByDayNo[row.DayNo],
              ...(image ? { image } : {})
            };
          }));

          // first choice for narrative/city cards: an already-uploaded library photo not
          // already claimed by a hotel card or an earlier occurrence of the same city
          const daysWithLibraryImage = daysWithSrno.map((day) => ({
            ...day,
            libraryImage: findLibraryImage(libraryImages, day.city, usedImageIds)
          }));

          // next choice: Imsert's AI search - only for days without a library match, fetching
          // enough per unique city up front so repeats cycle through different shots
          const occurrencesNeedingImsert = {};
          daysWithLibraryImage.forEach((day) => {
            if (!day.libraryImage) {
              occurrencesNeedingImsert[day.city] = (occurrencesNeedingImsert[day.city] || 0) + 1;
            }
          });

          const imsertImagesByCity = {};
          await Promise.all(Object.keys(occurrencesNeedingImsert).map(async (city) => {
            imsertImagesByCity[city] = await findImsertImages(city, occurrencesNeedingImsert[city], imsertApiKey, usedImageIds);
          }));

          const imsertUsedByCity = {};
          const withImsertImages = daysWithLibraryImage.map((day) => {
            if (day.libraryImage) return { ...day, image: day.libraryImage };

            const images = imsertImagesByCity[day.city] || [];
            const index = imsertUsedByCity[day.city] || 0;
            imsertUsedByCity[day.city] = index + 1;
            return { ...day, image: images[index] || null };
          });

          // fallback: the operator's own local city photo library (city_<cities_id>_large_<srno>.jpg),
          // only fetched for the days neither library nor Imsert had anything for
          const localImages = await Promise.all(withImsertImages.map((day) =>
            day.image ? null : findLocalImage(vamoosData.imageBaseUrl, day.cities_id, day.srno, headers)
          ));

          const narrativeCards = withImsertImages.map((day, i) => {
            const image = day.image || localImages[i];

            return {
              headline: day.city,
              content: serviceSummaryByDayNo[day.SrNo] || day.DaySummaryInfo,
              content_type: 'text/html',
              meta: { day_number: day.SrNo },
              ...(image ? { image } : {}),
              ...(internalIdByDayNo[day.SrNo] ? { location_internal_id: internalIdByDayNo[day.SrNo] } : {})
            };
          });

          const allCards = [];
          narrativeCards.forEach((card, i) => {
            allCards.push(card);
            const hotelCard = hotelCardsByDayNo[withImsertImages[i].SrNo];
            if (hotelCard) allCards.push(hotelCard);
          });

          return allCards;
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
