const axios = require('axios');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const keys = require('../../../../config/keys');
const vamoosDbQueries = require('./vamoosDbQueries');
const { getTourHotelsAgents } = require('../../../reports/presto/prestoTourHotelsAgents');

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

// Local-fallback uploads are named "city_<cities_id>_large_<srno>.jpg" (see findLocalImage).
// Imsert indexes the operator's own Vamoos library, so once one of these generic recycled city
// shots has been uploaded, Imsert can and does serve it back as an "AI match" for an unrelated
// search (e.g. a hotel name in the same small town) when it has nothing genuine to offer -
// confirmed happening between the "Teekoy" city card and the "Vanilla County" hotel card, which
// both ended up with the same recycled Teekoy countryside photo under different file IDs.
const LOCAL_FALLBACK_NAME_PATTERN = /^city_\d+_large_\d+\.jpg$/i;

// Looks up photos for a search term via Imsert's own search API (separate from Vamoos), skipping
// any already claimed by another card (Imsert indexes the same underlying operator S3 storage
// the Library search covers, plus more, so the same photo can surface via either path), and any
// result that's actually one of our own recycled local-fallback uploads rather than a genuine
// match. Fetches a small buffer beyond `count` to have room to skip these and still return enough
// results.
async function findImsertImages(term, count, imsertApiKey, usedImageIds) {
  const { data } = await axios.post('https://live.imsert.com/search',
    { text: { high: { text: term } }, perPage: count + 5, page: 1 },
    { headers: { Authorization: `Bearer ${imsertApiKey}`, 'Content-Type': 'application/json' } });

  const results = [];
  for (const result of (data.results || [])) {
    const name = result.image.name || term;
    if (LOCAL_FALLBACK_NAME_PATTERN.test(name)) continue;

    const key = `imsert:${result.image.imageUrl.split('?')[0]}`;
    if (usedImageIds.has(key)) continue;

    usedImageIds.add(key);
    results.push({ file_url: result.image.imageUrl, name });
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

// Strips everything but letters/digits so names can be compared regardless of spacing/
// punctuation differences - e.g. a DB hotel name of "The Tower House" needs to match a Library
// upload saved as "TheTowerHouse", which a plain substring check on the raw strings would miss.
function normalizeForMatch(text) {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Finds an already-uploaded library image whose name contains the search term (normalized,
// case/spacing/punctuation-insensitive substring match) and hasn't already been claimed by
// another card, returning it as a file_id_upload_object so Vamoos reuses the existing file
// instead of re-uploading it, or null if nothing matches. Marks whatever it returns as used so
// no two cards get the same photo.
function findLibraryImage(libraryImages, term, usedImageIds) {
  if (!term) return null;

  const normalizedTerm = normalizeForMatch(term);
  const match = libraryImages.find((item) =>
    normalizeForMatch(item.name).includes(normalizedTerm) && !usedImageIds.has(`library:${item.file.id}`));

  if (!match) return null;

  usedImageIds.add(`library:${match.file.id}`);
  return { file_id: match.file.id, name: match.name };
}

// Downloads a file from a URL our own backend can reach (e.g. the operator's local image
// library over the LAN) and re-uploads it to Vamoos' own S3 storage via its presigned-upload
// flow, since Vamoos' cloud servers can't reach a private LAN address themselves. Reuses an
// existing Library upload with the same filename instead of re-uploading a fresh duplicate every
// run - without this, every re-run was creating a brand-new S3 copy of the same local photo,
// and Imsert (which indexes the Library) would occasionally serve an old duplicate back to an
// unrelated card. Returns it in library_node_upload shape, or null if there's no existing upload
// and the source URL isn't reachable either.
async function uploadLocalFile(source_url, filename, headers, libraryImages, usedImageIds) {
  const existing = libraryImages.find((item) => item.name === filename);
  if (existing) {
    if (usedImageIds.has(`library:${existing.file.id}`)) return null;
    usedImageIds.add(`library:${existing.file.id}`);
    return { file_id: existing.file.id, name: existing.name };
  }

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

// Renders the same "Hotel/Agent services" PDF as the /reports/presto/tourHotelsAgents route
// (built from EXEC p_Rpt_QuoTourHotelAgentList), but in-memory instead of streamed to a response,
// so its bytes can be uploaded to Vamoos as an itinerary document.
async function generateTourHotelsAgentsPdf(quoPrint_id, quotations_id, sequelize) {
  const doc = new PDFDocument({
    margins: { top: 36, bottom: 18, left: 36, right: 36 },
    layout: 'landscape'
  });

  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const ended = new Promise((resolve) => doc.on('end', resolve));

  const fakeReq = { body: { data: { quoPrint_id, quotations_id } } };
  const noopRes = { status: () => ({ json: () => {} }) };

  await getTourHotelsAgents(fakeReq, noopRes, sequelize, doc, fs, 'presto/tourHotelAgents.pdf', false);
  doc.end();
  await ended;

  return Buffer.concat(chunks);
}

// Uploads already-generated file bytes (e.g. the services PDF above) to Vamoos' own S3 storage
// via its presigned-upload flow, same as uploadLocalFile but skipping the download step.
async function uploadBytes(bytes, filename, content_type, headers) {
  const { data: upload } = await axios.post(`${keys.vamoosHost}/file/upload_url`,
    { filename, content_type },
    { headers });

  await axios.put(upload.url, bytes, { headers: { 'Content-Type': content_type } });

  return { file_url: upload.s3url, name: filename };
}

// Checks whether the operator's own local city photo library has a numbered shot for this
// city/occurrence (e.g. .../city/city_103_large_2.jpg). Returns null if that file doesn't
// exist, so the caller can fall back to a stock photo.
async function findLocalImage(imageBaseUrl, cities_id, srno, headers, libraryImages, usedImageIds) {
  if (!imageBaseUrl || !cities_id) return null;

  const base = imageBaseUrl.endsWith('/') ? imageBaseUrl : `${imageBaseUrl}/`;
  const filename = `city_${cities_id}_large_${srno}.jpg`;

  return uploadLocalFile(`${base}city/${filename}`, filename, headers, libraryImages, usedImageIds);
}

// The operator's local "home/explore_1.jpg" image, used as the itinerary's cover photo.
// Returns null if that file doesn't exist, so the caller can fall back to a stock photo.
async function findLocalHomeImage(imageBaseUrl, headers, libraryImages, usedImageIds) {
  if (!imageBaseUrl) return null;

  const base = imageBaseUrl.endsWith('/') ? imageBaseUrl : `${imageBaseUrl}/`;

  return uploadLocalFile(`${base}home/explore_1.jpg`, 'explore_1.jpg', headers, libraryImages, usedImageIds);
}

// Vamoos' public directory of registered "Stay" itineraries (hotels/properties that publish
// their own guest-facing Vamoos itinerary). Setting a location's `vamoos_id` to one of these is
// what produces the richer "nested" accommodation display/icon on the phone - confirmed by
// comparing a manually-built itinerary's locations (which had this) against our own (which
// didn't). Only accepts a result whose name actually contains the search term (after the same
// space/punctuation-insensitive normalization used for Library matching), to avoid linking to an
// unrelated property on a weak/generic search match. Returns null if nothing qualifies.
async function findRegisteredStay(hotelName, headers) {
  // Vamoos' validation rejects "(" and ")" left un-escaped by encodeURIComponent (same class of
  // issue as the "f" filter param elsewhere in this file) - hotel names like "Kettuvallam
  // (Houseboat)" would otherwise 400 and abort the whole Promise.all in buildHotelLocations.
  const q = encodeURIComponent(hotelName).replace(/[()]/g, (c) => (c === '(' ? '%28' : '%29'));
  const list_url = `${keys.vamoosHost}/itinerary/stays?q=${q}&count=5`;
  const { data } = await axios.get(list_url, { headers });

  const normalizedTerm = normalizeForMatch(hotelName);
  const match = (data.items || []).find((item) => normalizeForMatch(item.name).includes(normalizedTerm));

  return match ? match.vamoos_id : null;
}

// Builds one locations[] entry per unique hotel (deduped by name) from the hotel-by-day query,
// assigning each a stable internal_id, plus a day-number -> internal_id map so each day's
// storyboard card can be "connected" to its hotel via location_internal_id. Also looks up each
// hotel in Vamoos' public Stays directory, linking the location to it via `vamoos_id` if found.
async function buildHotelLocations(hotelsByDay, headers) {
  const internalIdByHotelName = {};
  const internalIdByDayNo = {};
  const uniqueHotelRows = [];
  let nextInternalId = 1;

  hotelsByDay.forEach((row) => {
    if (!row.Hotel) return;

    if (!internalIdByHotelName[row.Hotel]) {
      internalIdByHotelName[row.Hotel] = nextInternalId++;
      uniqueHotelRows.push(row);
    }

    internalIdByDayNo[row.DayNo] = internalIdByHotelName[row.Hotel];
  });

  const locations = await Promise.all(uniqueHotelRows.map(async (row) => {
    const stayVamoosId = await findRegisteredStay(row.Hotel, headers);

    return {
      internal_id: internalIdByHotelName[row.Hotel],
      name: row.Hotel,
      latitude: row.Latitude,
      longitude: row.Longitude,
      description: [row.address, row.Contact].filter(Boolean).join(' — '),
      ...(stayVamoosId ? { vamoos_id: stayVamoosId } : {})
    };
  }));

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

// Accommodation rows in the chronological services list (EXEC p_Rpt_QuoTourHotelAgentList) are
// identified by their ServiceDesc mentioning room types together with a meal-plan clause, e.g.
// "1 Double and 1 Twin AC Heritage Splendour Rooms on a Bed & breakfast basis...".
const ACCOMMODATION_ROW_PATTERN = /\b(?:Single|Double|Twin|Triple)\b.*\bon\s+a\b.*\bbasis\b/i;

// Builds a day-number -> hotel contact map from the same chronological services list, so hotel
// storyboard cards can include the contact number that's listed against the accommodation row
// itself for that day (a separate source from getHotelsByDay's own Contact lookup).
function buildHotelContactByDayNo(servicesByDay) {
  const contactByDayNo = {};
  servicesByDay.forEach((row) => {
    if (row.Contact && ACCOMMODATION_ROW_PATTERN.test(row.ServiceDesc || '')) {
      contactByDayNo[row.DayNo] = row.Contact;
    }
  });

  return contactByDayNo;
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
      const { locations: hotelLocations, internalIdByDayNo } = await buildHotelLocations(vamoosData.hotelsByDay, headers);
      const imsertApiKey = await getImsertApiKey(headers);
      const libraryImages = await listLibraryImages(headers);

      // shared across every image lookup below (background, hotel cards, narrative cards) so
      // the same underlying photo never gets claimed by more than one card
      const usedImageIds = new Set();

      // the cover photo is always the Taj Mahal, for every itinerary regardless of destination -
      // sourced through Library/Imsert (properly re-hosted with sharp variants) rather than the
      // static Wikipedia fallback, which is only used if neither source has a match
      const backgroundImages = await findImsertImages('Taj Mahal', 3, imsertApiKey, usedImageIds);

      // attach the same "Hotel/Agent services" PDF the /reports/presto/tourHotelsAgents route
      // produces, as a Document on the itinerary - best-effort, so a PDF failure doesn't block
      // the whole itinerary from being created/updated
      let servicesDocument = null;
      try {
        const pdfBytes = await generateTourHotelsAgentsPdf(quoPrint_id, vamoosData.quoPrint.Quotations_id, sequelize);
        servicesDocument = await uploadBytes(pdfBytes, 'Hotel and Agent Services.pdf', 'application/pdf', headers);
      } catch (err) {
        console.error('[vamoosAPI] failed to generate/upload services PDF', err);
      }

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
        ...(servicesDocument ? { documents: { all: [{ name: 'Documents', children: [servicesDocument] }] } } : {}),
        details: req.body.details || await (async () => {
          const serviceSummaryByDayNo = buildServiceSummaryByDayNo(vamoosData.servicesByDay);
          const hotelContactByDayNo = buildHotelContactByDayNo(vamoosData.servicesByDay);

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
              content: [row.address, row.Contact, hotelContactByDayNo[row.DayNo]]
                .filter(Boolean)
                .map((line) => `<p>${line}</p>`)
                .join(''),
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
            day.image ? null : findLocalImage(vamoosData.imageBaseUrl, day.cities_id, day.srno, headers, libraryImages, usedImageIds)
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
