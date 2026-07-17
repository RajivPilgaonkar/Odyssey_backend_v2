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

// Finds up to `count` embeddable photo URLs for a hotel carousel (Library first, then Imsert AI
// search to fill any remainder), sharing the same usedImageIds set as every other image lookup so
// a photo already claimed elsewhere (a card cover, a different hotel's carousel, ...) isn't reused
// here too. Unlike findLibraryImage/findImsertImages - which return Vamoos file_id_upload_object/
// file_url shapes for Vamoos' own image/background fields - this returns plain HTTPS URLs, since
// these go into an <img src> inside a document we're building ourselves, not a Vamoos image slot.
async function findHotelCarouselImages(term, count, libraryImages, imsertApiKey, usedImageIds) {
  if (!term) return [];

  const normalizedTerm = normalizeForMatch(term);
  const urls = [];

  for (const item of libraryImages) {
    if (urls.length >= count) break;
    const key = `library:${item.file.id}`;
    if (usedImageIds.has(key) || !normalizeForMatch(item.name).includes(normalizedTerm)) continue;

    usedImageIds.add(key);
    urls.push(item.file.https_url);
  }

  if (urls.length < count) {
    const imsertMatches = await findImsertImages(term, count - urls.length, imsertApiKey, usedImageIds);
    urls.push(...imsertMatches.map((match) => match.file_url));
  }

  return urls;
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

// Vamoos Document Editor's own HTML boilerplate (CSS reset/typography/table styles), reused
// verbatim so documents built here render identically to one authored by hand in the editor -
// scraped from a manually-built "Services" document on itinerary 9312's Card 1. Pass
// { dark: true } (used for both "Services" and "Stay" now) to flip to a black page with
// off-white text instead - html/body's background are both set (not just body) so there's no
// mismatched white edge/border showing around the black content on devices that paint the html
// root before body's own background applies. The .activity-table stripe colors (see below) get a
// dark-appropriate pair of hues rather than being neutralized, since Services still wants its
// stacked tables to read apart at a glance - Stay's own wrapper table isn't in that class, so it
// never picks these up either way.
function wrapDocumentHtml(title, bodyHtml, { dark = false } = {}) {
  const darkOverrides = dark ? `
html, body { background: #000000; }
p { color: #f2f2f2; }
a { color: #6db3ff; }
table { border-color: #333333; }
.prose > table.activity-table:nth-of-type(odd) { background: #12202f; border-color: #2c4a6e; }
.prose > table.activity-table:nth-of-type(odd) th { background: #1c3350; }
.prose > table.activity-table:nth-of-type(even) { background: #2a2013; border-color: #5a4526; }
.prose > table.activity-table:nth-of-type(even) th { background: #3d2f1a; }
/* header label ("Arrival Transfer", "Hotel", ...) bright, everything else in the box dimmer, so
   each activity reads as a distinct card with a clear heading rather than one undifferentiated
   list - and the row dividers drop to near-invisible instead of the light-mode #eee, which read
   as harsh bright lines against these dark backgrounds and made adjacent boxes blur together. */
.activity-table th p { color: #ffffff; }
.activity-table td p { color: #a9b7c4; }
.activity-table th, .activity-table td { border-bottom-color: rgba(255, 255, 255, 0.08); }
` : '';

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="generator" content="Vamoos Document Editor" />
    <title>${title}</title>
    <style>
*, *::before, *::after { box-sizing: border-box; }
html, body { height: 100%; margin: 0; padding: 0; overflow-x: hidden; }
table { border-collapse: collapse; width: 100%; }
img { display: block; max-width: 100%; height: auto; }
body {
  margin: 0;
  padding: 15px 10px;
  font-family: "Lato","Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 16px;
  line-height: 1.6;
  color: #222;
}
main { max-width: 800px; margin: 0 auto; padding-bottom: 1rem; }
p { margin: 0 0 1rem 0; color: #333; }
strong { font-weight: 600; }
a { color: #0066cc; text-decoration: none; }
table { margin: 1.5rem 0; border: 1px solid #eaeaea; border-radius: 10px; overflow: hidden; }
th, td { border-bottom: 1px solid #eee; padding: 0.75rem 1rem; text-align: left; }
th { font-weight: 600; }
.prose > :first-child { margin-top: 0; }
/* alternate each stacked Services activity table's background so multiple tables in one document
   are easy to tell apart at a glance - two distinct pastel hues (cool blue / warm sand) read much
   faster than two shades of the same gray would, while staying light enough that body text
   (#222/#333) stays well above WCAG AA's 4.5:1 contrast minimum. Scoped to .activity-table (not
   just "table") so Stay's own single wrapper table - a different document, but built from this
   same shared boilerplate - never picks this up too. */
.prose > table.activity-table:nth-of-type(odd) { background: #e8f0fb; border-color: #8fb8e6; }
.prose > table.activity-table:nth-of-type(odd) th { background: #c7ddf5; }
.prose > table.activity-table:nth-of-type(even) { background: #fdf3e7; border-color: #e0b877; }
.prose > table.activity-table:nth-of-type(even) th { background: #f5dfc0; }
/* ~10% shorter rows than the shared th/td default (0.75rem/1rem) - scoped to .activity-table so
   Stay's own single content cell keeps its original, already-approved padding. vertical-align
   plus zeroing the cell <p>'s own margin (normally 1rem bottom, 0 top - fine for stacked
   paragraphs like Stay's, but lopsided for a single line of text in a row) fixes the text sitting
   high with extra space below it; row height now comes from the cell's own (symmetric) padding
   instead. */
.activity-table th, .activity-table td { padding: 0.68rem 0.9rem; vertical-align: middle; }
.activity-table th p, .activity-table td p { margin: 0; }
.check-mark { color: #22c55e; font-weight: 700; font-size: 1.15em; }
/* Swipeable carousel (no JS) for a hotel's photos - a plain horizontal scroll-snap strip, but
   with the scrollbar itself hidden (it was the visible "slider" track that looked out of place,
   not the swipe gesture). A fixed height + object-fit (not aspect-ratio, a newer property some
   embedded webviews may not support) keeps every photo the same card size regardless of its own
   orientation/resolution. */
.carousel { display: flex; gap: 0.75rem; margin: 1.5rem 0; overflow-x: auto; scroll-snap-type: x mandatory; -webkit-overflow-scrolling: touch; scrollbar-width: none; -ms-overflow-style: none; }
.carousel::-webkit-scrollbar { display: none; }
.carousel img { flex: 0 0 82%; max-width: 82%; height: 200px; scroll-snap-align: start; margin: 0; border-radius: 8px; object-fit: cover; }
.carousel-single { height: 200px; object-fit: cover; border-radius: 8px; }
${darkOverrides}
    </style>
  </head>
  <body style="background-color: ${dark ? '#000000' : 'rgb(255, 255, 255)'};">
    <main class="container">
      <article class="prose">
        ${bodyHtml}
      </article>
    </main>
  </body>
</html>`;
}

// Builds a clickable tel: link from a Phone field that may list multiple numbers comma-separated
// (e.g. "0484 266 9933, 266 8594") - a tel: URI can only target one number, so it dials the first
// one listed, stripped down to digits/+, while still showing the full raw text so nothing the
// reader might need (the other numbers) is hidden. Anchor attributes match the manually-built
// phone links studied on itinerary odyssey123's hotel document.
function buildPhoneLink(phone) {
  const digits = phone.split(',')[0].replace(/[^\d+]/g, '');
  return digits
    ? `<a target="_blank" rel="noopener noreferrer nofollow" href="tel:${digits}">${phone}</a>`
    : phone;
}

// Builds a hotel's photo carousel: a single cropped photo if only one turned up, a swipeable
// (scroll-snap, scrollbar hidden) strip if two did, or nothing if the search found no photos at
// all. Caps at 2 since that's all findHotelCarouselImages is ever asked to find.
function buildCarouselHtml(imageUrls) {
  if (!imageUrls.length) return '';

  if (imageUrls.length === 1) {
    return `<p></p><img class="carousel-single" src="${imageUrls[0]}">`;
  }

  return `<p></p><div class="carousel">${imageUrls.map((url) => `<img src="${url}">`).join('')}</div>`;
}

// Builds one <table> (blank/Description header) from a f_GetCardServiceDescRows(QuoLines_id)
// result set, matching the shape of the manually-built "Services" documents, plus a trailing
// Contact/Phone row (click-to-dial) when the activity has a phone number - omitted entirely if
// blank/null, per that day's own Phone column from p_Rpt_QuoTourCardFormat.
// f_GetCardServiceDescRows represents a yes/no field (e.g. "Guide") as a literal ServiceDesc of
// "1" rather than an actual word - shown as a green checkmark instead of a bare digit, which
// reads as a typo/leftover data rather than a deliberate yes.
function formatServiceDescValue(value) {
  return (value || '').trim() === '1' ? '<span class="check-mark">&#10003;</span>' : value;
}

function buildServiceDescTable(rows, descriptionLabel, phone) {
  const body = rows
    .map((row) => `<tr><td><p>${row.Timings}</p></td><td><p>${formatServiceDescValue(row.ServiceDesc)}</p></td></tr>`)
    .join('');

  const contactRow = (phone && phone.trim())
    ? `<tr><td><p>Contact</p></td><td><p>${buildPhoneLink(phone)}</p></td></tr>`
    : '';

  return `<table class="activity-table"><thead><tr><th><p></p></th><th><p>${descriptionLabel}</p></th></tr></thead><tbody>${body}${contactRow}</tbody></table>`;
}

// Per QuoLines.TrsType (see FitMargins for the canonical type -> description mapping this
// mirrors: 1 Tickets, 2 Accommodation, 3 Sight Seeing, 4 Transfer, 5 Transport), picks the
// activity table's second header label. TrsType 4 (Transfer) further splits into Arrival/Departure
// based on the row's own ServiceDesc, since both directions share the same TrsType.
function getServiceDescLabel(trsType, serviceDesc) {
  switch (trsType) {
    case 1: return 'Travel';
    case 2: return 'Hotel';
    case 3: return 'Sightseeing';
    case 4: return /departure/i.test(serviceDesc || '') ? 'Departure Transfer' : 'Arrival Transfer';
    case 5: return 'Drive';
    default: return 'Description';
  }
}

// Builds a card's "Services" document: one table per activity that day (per QuoLines_id), stacked
// one below the other in the same chronological (AtTime) order the rows already come in from
// p_Rpt_QuoTourCardFormat. Returns null if the day has no QuoLines_id rows to pull from (e.g. a
// "Day At Leisure" filler day).
async function buildServicesDocument(dayRows, getCardServiceDescRows, headers) {
  const activityRows = dayRows.filter((row) => row.QuoLines_id);
  if (!activityRows.length) return null;

  const tables = await Promise.all(activityRows.map(async (row) => {
    const descRows = await getCardServiceDescRows(row.QuoLines_id);
    return buildServiceDescTable(descRows, getServiceDescLabel(row.TrsType, row.ServiceDesc), row.Phone);
  }));

  const html = wrapDocumentHtml('Services', tables.join(''), { dark: true });
  const uploaded = await uploadBytes(Buffer.from(html), 'Services.html', 'text/html', headers);

  // uploadBytes reuses the upload filename as the document's display name by default, but that
  // shows the ".html" extension as part of the icon caption in the app - override it to match
  // how the manually-built "Services" document names itself (file.short_name keeps the
  // extension, just not the document's own display name)
  return { ...uploaded, name: 'Services' };
}

// Builds a card's "Stay" document from the hotel's own description (addressbook/hotels tables),
// for whichever day has a HotelAddressbook_id - matching the single-column table shape of a
// manually-built hotel document (studied against itinerary odyssey123's Day 1 "Haveli Hauz Khas
// Delhi" document), named "Stay" rather than the hotel's own name (the hotel's own name is still
// shown, bold/underlined, as the first line of the body). The Contact/Phone line reuses the same
// day row's Phone column (same source as the Services document's Contact row) rather than a
// separate hotel-specific number, formatted with the anchor attributes odyssey123's phone links
// use. Below that, up to 2 photos found via the hotel's own ImageHint (e.g. "Kochi The Tower
// House"), in a swipeable carousel - omitted entirely if the search comes up empty. Returns null
// if the day has no hotel, or the hotel has no description on file.
async function buildStayDocument(dayRows, getHotelDescription, headers, libraryImages, imsertApiKey, usedImageIds) {
  const hotelRow = dayRows.find((row) => row.HotelAddressbook_id);
  if (!hotelRow) return null;

  const hotel = await getHotelDescription(hotelRow.HotelAddressbook_id);
  if (!hotel || !hotel.description) return null;

  const contactParagraph = (hotelRow.Phone && hotelRow.Phone.trim())
    ? `<p></p><p><strong>Contact:</strong> ${buildPhoneLink(hotelRow.Phone)}</p>`
    : '';

  const imageUrls = await findHotelCarouselImages(hotelRow.ImageHint, 2, libraryImages, imsertApiKey, usedImageIds);
  const imagesHtml = buildCarouselHtml(imageUrls);

  const body = `<table style="min-width: 25px"><colgroup><col style="min-width: 25px"></colgroup>` +
    `<tbody><tr><td colspan="1" rowspan="1">` +
    `<p><strong><u>${hotel.Organisation}</u></strong></p>` +
    `<p>${hotel.description}</p>` +
    `${contactParagraph}` +
    `${imagesHtml}` +
    `</td></tr></tbody></table>`;

  const html = wrapDocumentHtml('Stay', body, { dark: true });
  const uploaded = await uploadBytes(Buffer.from(html), 'Stay.html', 'text/html', headers);

  // icon_id 288 is the hotel/accommodation icon the manually-built document used - untested
  // whether Vamoos actually honors an icon_id passed at creation time the way it echoes one
  // back on read, so worth confirming against the real icon once this runs live
  return { ...uploaded, name: 'Stay', icon_id: 288 };
}

// Builds a card's "City" document - identical in structure to buildStayDocument above, just
// sourced from cities/writeup instead of addressbook/hotels, keyed off Cities_id instead of
// HotelAddressbook_id, and searching for 3 photos instead of 2. icon_id 284 is the city/location
// icon (studied against itinerary odyssey123's "Delhi" document, same day as its "Haveli Hauz
// Khas Delhi" hotel document). Returns null if the day has no city, or the city has no writeup
// on file.
async function buildCityDocument(dayRows, getCityDescription, headers, libraryImages, imsertApiKey, usedImageIds) {
  const cityRow = dayRows.find((row) => row.Cities_id);
  if (!cityRow) return null;

  const city = await getCityDescription(cityRow.Cities_id);
  if (!city || !city.writeup) return null;

  const contactParagraph = (cityRow.Phone && cityRow.Phone.trim())
    ? `<p></p><p><strong>Contact:</strong> ${buildPhoneLink(cityRow.Phone)}</p>`
    : '';

  const imageUrls = await findHotelCarouselImages(cityRow.ImageHint, 3, libraryImages, imsertApiKey, usedImageIds);
  const imagesHtml = buildCarouselHtml(imageUrls);

  const body = `<table style="min-width: 25px"><colgroup><col style="min-width: 25px"></colgroup>` +
    `<tbody><tr><td colspan="1" rowspan="1">` +
    `<p><strong><u>${city.City}</u></strong></p>` +
    `<p>${city.writeup}</p>` +
    `${contactParagraph}` +
    `${imagesHtml}` +
    `</td></tr></tbody></table>`;

  const html = wrapDocumentHtml('City', body, { dark: true });
  const uploaded = await uploadBytes(Buffer.from(html), 'City.html', 'text/html', headers);

  return { ...uploaded, name: 'City', icon_id: 284 };
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

// Finds the city the tour spends the most NIGHTS in (for the itinerary's cover photo), from the
// same p_Rpt_QuoTourCardFormat rows the cards are built from. p_Rpt_QuoTourCardFormat only keeps
// Cities_id on a city's first occurrence (it nulls out repeats), so it can't be used to count
// nights directly - cityByQuoLinesId (an undeduped QuoLines -> Cities lookup) is used instead.
//
// A day's night is spent in whichever city that day is attributed to - including a transfer day,
// since the SP attributes the whole day to the destination and the traveler slept in the origin
// city the night before (already counted against the origin's own day there) - except the tour's
// very last day, which is a same-day departure with no night following it. Ties go to whichever
// city's first day comes earliest in the tour.
function findCityWithMostNights(tourCards, cityByQuoLinesId) {
  const rowsByCardNo = {};
  tourCards.forEach((row) => {
    (rowsByCardNo[row.CardNo] = rowsByCardNo[row.CardNo] || []).push(row);
  });

  const cardNos = Object.keys(rowsByCardNo).map(Number);
  const lastCardNo = Math.max(...cardNos);

  const nightsByCity = {};
  const firstCardNoByCity = {};

  cardNos.forEach((cardNo) => {
    const cityRow = rowsByCardNo[cardNo].find((row) => row.QuoLines_id && cityByQuoLinesId[row.QuoLines_id]);
    if (!cityRow) return;

    const city = cityByQuoLinesId[cityRow.QuoLines_id];
    firstCardNoByCity[city] = Math.min(firstCardNoByCity[city] ?? Infinity, cardNo);
    nightsByCity[city] = (nightsByCity[city] || 0) + (cardNo === lastCardNo ? 0 : 1);
  });

  return Object.keys(nightsByCity).sort((a, b) =>
    nightsByCity[b] - nightsByCity[a] || firstCardNoByCity[a] - firstCardNoByCity[b]
  )[0] || null;
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

      // the cover photo is the city the tour spends the most nights in (ties go to whichever of
      // those cities is visited first), sourced from the same undeduped QuoLines -> Cities join
      // used to count nights per city. Claiming its photo(s) here, before any per-card/document
      // image lookup runs, means the shared usedImageIds set already keeps that same photo from
      // being reused in the day-to-day cards or a City document's carousel further down.
      const quoLinesIds = vamoosData.tourCards.filter((row) => row.QuoLines_id).map((row) => row.QuoLines_id);
      const cityRows = await dbQueries.getCitiesByQuoLinesIds(quoLinesIds);
      const cityByQuoLinesId = {};
      cityRows.forEach((row) => { if (row.City) cityByQuoLinesId[row.QuoLines_id] = row.City; });

      const coverCity = findCityWithMostNights(vamoosData.tourCards, cityByQuoLinesId);
      const backgroundImages = coverCity ? await findImsertImages(coverCity, 3, imsertApiKey, usedImageIds) : [];

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
          || (coverCity && findLibraryImage(libraryImages, coverCity, usedImageIds))
          || backgroundImages[0],
        locations: req.body.locations || hotelLocations,
        ...(servicesDocument ? { documents: { all: [{ name: 'Documents', children: [servicesDocument] }] } } : {}),
        details: req.body.details || await (async () => {
          // one card per day, per EXEC p_Rpt_QuoTourCardFormat (which itself wraps
          // p_Rpt_QuoTourHotelAgentList and fills any gap days with "Day(s) At Leisure" rows) -
          // grouped by CardNo since a day can have multiple SubCardNo rows (e.g. a drive followed
          // by a hotel stay), of which only the first (by SubCardNo) is used for the card itself
          const rowsByCardNo = {};
          vamoosData.tourCards.forEach((row) => {
            (rowsByCardNo[row.CardNo] = rowsByCardNo[row.CardNo] || []).push(row);
          });

          const cardNosInOrder = Object.keys(rowsByCardNo).map(Number).sort((a, b) => a - b);

          return Promise.all(cardNosInOrder.map(async (cardNo) => {
            const rows = rowsByCardNo[cardNo].sort((a, b) => a.SubCardNo - b.SubCardNo);
            const firstRow = rows[0];

            const image = firstRow.ImageHint
              ? findLibraryImage(libraryImages, firstRow.ImageHint, usedImageIds)
                || (await findImsertImages(firstRow.ImageHint, 1, imsertApiKey, usedImageIds))[0]
                || null
              : null;

            // Additional Information: every row for the day (AtTime bold, ServiceDesc as-is,
            // no regex trimming) - each its own <p> block with real spaces, not &nbsp;, since the
            // app's content renderer isn't a full HTML parser (see buildServiceSummaryByDayNo above)
            const content = rows
              .map((row) => `<p><strong>${row.AtTime}</strong>   ${row.ServiceDesc}</p>`)
              .join('');

            // per-card "Services", "Stay" and "City" documents - best-effort, so a lookup
            // failure on one day doesn't block the rest of the itinerary
            let servicesDoc = null;
            try {
              servicesDoc = await buildServicesDocument(rows, dbQueries.getCardServiceDescRows, headers);
            } catch (err) {
              console.error(`[vamoosAPI] failed to build services document for CardNo ${cardNo}`, err);
            }

            let stayDoc = null;
            try {
              stayDoc = await buildStayDocument(rows, dbQueries.getHotelDescription, headers, libraryImages, imsertApiKey, usedImageIds);
            } catch (err) {
              console.error(`[vamoosAPI] failed to build stay document for CardNo ${cardNo}`, err);
            }

            let cityDoc = null;
            try {
              cityDoc = await buildCityDocument(rows, dbQueries.getCityDescription, headers, libraryImages, imsertApiKey, usedImageIds);
            } catch (err) {
              console.error(`[vamoosAPI] failed to build city document for CardNo ${cardNo}`, err);
            }

            const documents = [servicesDoc, stayDoc, cityDoc].filter(Boolean);

            return {
              headline: firstRow.Title,
              content,
              content_type: 'text/html',
              meta: { day_number: cardNo },
              ...(image ? { image } : {}),
              ...(documents.length ? { documents } : {})
            };
          }));
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
