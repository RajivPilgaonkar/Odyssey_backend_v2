const axios = require('axios');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const Anthropic = require('@anthropic-ai/sdk');
const keys = require('../../../../config/keys');
const vamoosDbQueries = require('./vamoosDbQueries');
const { getTourHotelsAgents } = require('../../../reports/presto/prestoTourHotelsAgents');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Only set up when a key is actually configured - lets rewriteDaySummaryWithLLM (below) fall back
// to its rule-based input silently rather than every request needing an API key to work at all.
const anthropicClient = keys.anthropicApiKey ? new Anthropic({ apiKey: keys.anthropicApiKey }) : null;

// Stamped into meta.source on every document this integration creates (confirmed via a live
// test that Vamoos persists arbitrary custom meta keys unchanged, alongside its own "sequence").
// Lets a rerun tell "ours, safe to regenerate" apart from anything attached manually in the
// portal (e.g. an actual ticket), instead of guessing from the document's name.
const SYNC_SOURCE = 'presto-sync';

// Vamoos expects dates as YYYY-MM-DD; SQL Server DATETIME columns come back either as a
// JS Date object or as a "YYYY-MM-DD HH:mm:ss" string depending on the driver, so handle both.
// Date objects are formatted explicitly in Asia/Calcutta (IST) rather than via .toISOString()
// (UTC) - these are date-only Presto values (SMALLDATETIME truncated to 00:00), so both happen to
// land on the same calendar day today, but formatting in the tour's actual timezone is correct
// regardless of that coincidence rather than relying on it.
function toDateOnly(value) {
  if (!value) return undefined;
  if (value instanceof Date) {
    return new Intl.DateTimeFormat('en-CA',
      { timeZone: 'Asia/Calcutta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
  }
  return String(value).slice(0, 10);
}

// Pulls just the year out of a date value, via the same timezone-safe toDateOnly conversion above.
function yearOf(value) {
  const dateOnly = toDateOnly(value);
  return dateOnly ? Number(dateOnly.slice(0, 4)) : null;
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

// Imsert's search results aren't limited to this operator's own uploads - it also indexes other
// properties' own registered Vamoos "Stay" listings (see findRegisteredStay below), each under
// its own S3 "uploads/<PropertyName>/..." folder, and its semantic matching can loosely match a
// totally unrelated property's photo to the search term when it has nothing genuine to offer -
// confirmed happening for "Delhi Andaz Delhi", which returned a photo from
// "uploads/ColonelsRetreat/..." (an unrelated hotel). Rejects a result whose folder is a specific
// OTHER property's name that doesn't relate to the term at all; the operator's own generic
// uploads/webcache folder (keys.vamoosOperatorCode) is never rejected, since that's the shared
// library, not a property-specific one.
function looksLikeWrongProperty(imageUrl, term) {
  const match = /\/(?:uploads|webcache)\/([^/]+)\//.exec(imageUrl);
  if (!match) return false;

  const folder = match[1];
  if (folder === keys.vamoosOperatorCode) return false;

  const normalizedFolder = normalizeForMatch(folder);
  const normalizedTerm = normalizeForMatch(term);
  return !normalizedTerm.includes(normalizedFolder) && !normalizedFolder.includes(normalizedTerm);
}

// A city/opening-screen cover should read as a generic scenic or landmark shot, not a specific
// hotel's own room photo - confirmed happening for Quotations_id 9266's "Delhi" cover, which
// matched "Delhi - Colonel's Retreat 1 - Standard Room 1 - small - WEB" purely because that
// hotel's own descriptive filename happens to mention the city. The same word is exactly right in
// a hotel's own Stay carousel (that IS its room), so this is only applied for the cover search,
// not baked into findImsertImages/findLibraryImage generally.
function looksLikeAccommodationPhoto(name) {
  return /\b(room|suite)\b/i.test(name);
}


// Looks up photos for a search term via Imsert's own AI/semantic search API (separate from
// Vamoos), skipping any already claimed by another card, any result that's actually one of our own
// recycled local-fallback uploads rather than a genuine match, and any result that looks like it
// belongs to an unrelated property (see looksLikeWrongProperty above). Used for a card's own cover
// photo and the opening-screen background only - a Stay/City document's own carousel now comes
// from curated Library folders instead (see findCuratedHotelPhotos/findCuratedCityPhotos below),
// not this search, since Imsert's semantic ranking proved too unpredictable for reliably finding a
// specific hand-uploaded photo (confirmed live: a plainly, uniquely-named photo still ranked
// outside the top 10 results for its own exact search term). Pass preferGenericPhotos for an
// opening-screen cover search: tries Imsert's "webcache" tier (real Unsplash-sourced scenery)
// first, skips anything that looks like a hotel room, and widens the results page - confirmed
// live, the one genuine landmark photo for a "Delhi" cover search ranked #9, past the usual
// count+5 buffer other searches use. Fetches a small buffer beyond `count` to have room to skip
// rejected results and still return enough.
async function findImsertImages(term, count, imsertApiKey, usedImageIds, { preferGenericPhotos = false } = {}) {
  const perPage = preferGenericPhotos ? Math.max(count + 5, 25) : count + 5;
  const { data } = await axios.post('https://live.imsert.com/search',
    { text: { high: { text: term } }, perPage, page: 1 },
    { headers: { Authorization: `Bearer ${imsertApiKey}`, 'Content-Type': 'application/json' } });

  let candidates = data.results || [];
  if (preferGenericPhotos) {
    candidates = [...candidates].sort((a, b) =>
      Number(/\/webcache\//.test(b.image.imageUrl)) - Number(/\/webcache\//.test(a.image.imageUrl)));
  }

  const results = [];
  for (const result of candidates) {
    const name = result.image.name || term;
    if (LOCAL_FALLBACK_NAME_PATTERN.test(name)) continue;
    if (looksLikeWrongProperty(result.image.imageUrl, term)) continue;
    if (preferGenericPhotos && looksLikeAccommodationPhoto(name)) continue;

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
// no two cards get the same photo. Always used for a generic search (a card's own cover photo, the
// opening-screen background) rather than one specific property.
function findLibraryImage(libraryImages, term, usedImageIds) {
  if (!term) return null;

  const normalizedTerm = normalizeForMatch(term);
  const match = libraryImages.find((item) =>
    normalizeForMatch(item.name).includes(normalizedTerm) && !usedImageIds.has(`library:${item.file.id}`));

  if (!match) return null;

  usedImageIds.add(`library:${match.file.id}`);
  return { file_id: match.file.id, name: match.name };
}

// Fetches images from one specific Library subfolder (e.g. "/library/Hotel/Delhi/") - unlike
// listLibraryImages (the flat top-level /library/ listing, fetched once per request and shared
// across every card), a curated hotel/city folder is specific to one card and only needed by it,
// so there's no shared list to reuse across cards. Returns [] (not an error) if the folder doesn't
// exist yet, so the caller can leave the carousel blank rather than guessing at a substitute.
async function listLibraryFolderImages(headers, folderPath) {
  const list_url = `${keys.vamoosHost}/file/list?path=${folderPath}&count=200&order_by=name`;
  try {
    const { data } = await axios.get(list_url, { headers });
    return (data.items || []).filter((item) =>
      !item.is_folder && item.file && item.file.mime_type && item.file.mime_type.startsWith('image/'));
  } catch (err) {
    return [];
  }
}

// Vamoos auto-generates a smaller "app" version (roughly 800px wide) of every uploaded image
// alongside the original - since these curated photos get downloaded and embedded as base64 (see
// toEmbeddableDataUri), using the original full-resolution file was bloating the document (a
// single original ran ~1MB; its "app" variant was ~117KB, a ~90% reduction) with no visible
// benefit on a phone screen. Falls back to the original if a variant genuinely isn't there.
function getEmbeddableSizeUrl(item) {
  return (item.file.variants && item.file.variants.app && item.file.variants.app.https_url) || item.file.https_url;
}

// Finds up to `count` curated photo URLs for a hotel's Stay carousel from the operator's own
// hand-organized Library folder /library/Hotel/<City>/ (confirmed live:
// "/library/Hotel/Delhi/Andaz Delhi 1", "Andaz Delhi 2" for the Andaz Delhi hotel), matched by the
// hotel's own bare name (e.g. "Andaz Delhi") appearing in the photo's name - the folder itself
// already guarantees these are Stay photos, so the name no longer needs its own "Hotel" marker
// word. Library-only, deliberately no Imsert fallback: Imsert's semantic ranking proved too
// unpredictable for reliably finding one specific curated photo (see findImsertImages above), and
// a blank carousel is preferable to a wrong photo. Returns [] if the city's Hotel folder doesn't
// exist yet, or nothing in it matches this hotel's name.
async function findCuratedHotelPhotos(hotelRow, headers, usedImageIds, count) {
  if (!hotelRow || !hotelRow.City || !hotelRow.Hotel) return [];

  const images = await listLibraryFolderImages(headers, `/library/Hotel/${encodeURIComponent(hotelRow.City)}/`);
  const normalizedHotel = normalizeForMatch(hotelRow.Hotel);

  const urls = [];
  for (const item of images) {
    if (urls.length >= count) break;
    const key = `library:${item.file.id}`;
    if (usedImageIds.has(key) || !normalizeForMatch(item.name).includes(normalizedHotel)) continue;

    usedImageIds.add(key);
    urls.push(getEmbeddableSizeUrl(item));
  }

  return urls;
}

// Same idea as findCuratedHotelPhotos, for a City document's carousel from the flat
// /library/City/ folder (confirmed live: "Delhi 1", "Delhi 2" for Delhi), matched by the city's
// own name. Library-only, same reasoning as findCuratedHotelPhotos above.
async function findCuratedCityPhotos(cityRow, headers, usedImageIds, count) {
  if (!cityRow || !cityRow.City) return [];

  const images = await listLibraryFolderImages(headers, '/library/City/');
  const normalizedCity = normalizeForMatch(cityRow.City);

  const urls = [];
  for (const item of images) {
    if (urls.length >= count) break;
    const key = `library:${item.file.id}`;
    if (usedImageIds.has(key) || !normalizeForMatch(item.name).includes(normalizedCity)) continue;

    usedImageIds.add(key);
    urls.push(getEmbeddableSizeUrl(item));
  }

  return urls;
}

// Finds up to `count` curated photo URLs for a Sightseeing/Excursion document's carousel from
// /library/Sightseeing/<City>/ (e.g. "/library/Sightseeing/Jodhpur/316_1", "316_2" for
// Services_id 316's Jodhpur activity), matched by the row's own Services_id as the filename's
// prefix before the "_N" order suffix - unambiguous, unlike a hotel/city name, since Services_id
// uniquely identifies one specific activity (no usedImageIds dedup needed here for that reason -
// unlike a hotel/city, which can recur across different days, a given Services_id's own folder is
// never a contested resource). Library-only, same reasoning as findCuratedHotelPhotos above.
// Returns [] if the city's Sightseeing folder doesn't exist yet, or nothing in it matches this
// activity's Services_id.
async function findCuratedSightseeingPhotos(row, headers, count) {
  if (!row || !row.City || !row.Services_id) return [];

  const images = await listLibraryFolderImages(headers, `/library/Sightseeing/${encodeURIComponent(row.City)}/`);
  const prefix = `${row.Services_id}_`;

  return images
    .filter((item) => item.name.trim().startsWith(prefix))
    .sort((a, b) => Number(a.name.trim().slice(prefix.length)) - Number(b.name.trim().slice(prefix.length)))
    .slice(0, count)
    .map(getEmbeddableSizeUrl);
}

// Groups the flat /library/City/ folder's images by city, parsing the "<City> <Number>" naming
// convention (e.g. "Delhi 1", "Delhi 2") and sorting each city's own list by that number - so a
// caller can index into "the Nth photo of this city" directly, rather than searching by name each
// time. Skips anything that doesn't end in a number (nothing to group it under).
function groupCityPhotosByCity(cityLibraryImages) {
  const byCity = {};
  for (const item of cityLibraryImages) {
    const match = /^(.+?)\s+(\d+)$/.exec(item.name.trim());
    if (!match) continue;

    const key = normalizeForMatch(match[1]);
    (byCity[key] = byCity[key] || []).push({ number: Number(match[2]), file_id: item.file.id, name: item.name });
  }

  Object.values(byCity).forEach((list) => list.sort((a, b) => a.number - b.number));
  return byCity;
}

// Picks a day-card's own cover photo by cycling through that day's last city's curated photos in
// /library/City/ - "Delhi 1" for the first day whose last city (time-wise) is Delhi, "Delhi 2" for
// the next such day, wrapping back to "Delhi 1" if the tour spends more days in a city than it has
// curated photos for. visitCounts is a plain object shared and mutated across the whole itinerary
// (one counter per city), so each call advances that city's own sequence. Returns null - left
// blank, never guessed at - if this city has no curated photos in the Library at all.
function pickCycledCityPhoto(cityPhotosByCity, cityName, visitCounts) {
  if (!cityName) return null;

  const key = normalizeForMatch(cityName);
  const photos = cityPhotosByCity[key];
  if (!photos || !photos.length) return null;

  visitCounts[key] = (visitCounts[key] || 0) + 1;
  const photo = photos[(visitCounts[key] - 1) % photos.length];
  return { file_id: photo.file_id, name: photo.name };
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

// Downloads an image and returns it as a base64 data: URI, so a Stay/City document embeds the
// actual bytes rather than a link to fetch later. Necessary because Library/Imsert URLs are
// presigned and expire ~30 minutes after being issued - confirmed live against a real production
// Stay document (Quotations_id 9314, built just two days earlier): its own embedded photo was
// already 403ing, since nothing ever re-signs a URL once it's baked into a static uploaded HTML
// page. A byte embed can't go stale the same way, since there's nothing left to fetch later - this
// is also exactly how the manually-built "doyle" reference itinerary stores its own hotel photos
// (inspected directly: every <img> in its Stay documents is a data: URI, not a link). Returns null
// on any download failure so one bad photo doesn't block the rest of the carousel.
async function toEmbeddableDataUri(url) {
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const mimeType = response.headers['content-type'] || 'image/jpeg';
    return `data:${mimeType};base64,${Buffer.from(response.data).toString('base64')}`;
  } catch (err) {
    console.error('[vamoosAPI] failed to download image for embedding', url, err.message);
    return null;
  }
}

// Builds a hotel's photo carousel: a single cropped photo if only one turned up, a swipeable
// (scroll-snap, scrollbar hidden) strip for more, or nothing if none were found at all.
function buildCarouselHtml(imageUrls) {
  if (!imageUrls.length) return '';

  if (imageUrls.length === 1) {
    return `<p></p><img class="carousel-single" src="${imageUrls[0]}">`;
  }

  return `<p></p><div class="carousel">${imageUrls.map((url) => `<img src="${url}">`).join('')}</div>`;
}

// Builds one <table> (blank/Description header) from a f_GetCardServiceDescRows(QuoLines_id)
// result set, matching the shape of the manually-built "Services" documents, plus a trailing
// Contact row when the activity has a vendor organisation and/or phone number - per that day's own
// Organisation/Phone columns from p_Rpt_QuoTourCardFormat. Organisation (the vendor's own name,
// e.g. "Ramico Tours & Travels Pvt. Ltd.") shows on its own line above the phone (click-to-dial),
// in the same cell - two separate <p> tags rather than <br>, since the app's content renderer isn't
// a full HTML parser (see buildServiceSummaryByDayNo in the vamoosPrestoItinerary.js caller for the
// same reasoning). Falls back to showing just the phone number alone when there's no organisation
// name, and the row is omitted entirely only when neither is present.
// f_GetCardServiceDescRows represents a yes/no field (e.g. "Guide") as a literal ServiceDesc of
// "1" rather than an actual word - shown as a green checkmark instead of a bare digit, which
// reads as a typo/leftover data rather than a deliberate yes.
function formatServiceDescValue(value) {
  return (value || '').trim() === '1' ? '<span class="check-mark">&#10003;</span>' : value;
}

function buildServiceDescTable(rows, descriptionLabel, organisation, phone) {
  const body = rows
    .map((row) => `<tr><td><p>${row.Timings}</p></td><td><p>${formatServiceDescValue(row.ServiceDesc)}</p></td></tr>`)
    .join('');

  const hasOrganisation = organisation && organisation.trim();
  const hasPhone = phone && phone.trim();
  const phoneLine = hasPhone ? `<p>${buildPhoneLink(phone)}</p>` : '';

  let contactRow = '';
  if (hasOrganisation) {
    contactRow = `<tr><td><p>Contact</p></td><td><p>${organisation}</p>${phoneLine}</td></tr>`;
  } else if (hasPhone) {
    contactRow = `<tr><td><p>Contact</p></td><td>${phoneLine}</td></tr>`;
  }

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
    // TrsType 2 (Accommodation) already shows the hotel's own name as the Stay row's first line -
    // showing it again as the Contact row's organisation would be redundant, but the phone number
    // is still worth keeping (buildServiceDescTable already falls back to a phone-only Contact row
    // when there's no organisation name)
    const isAccommodation = row.TrsType === 2;
    return buildServiceDescTable(descRows, getServiceDescLabel(row.TrsType, row.ServiceDesc),
      isAccommodation ? null : row.Organisation, row.Phone);
  }));

  const html = wrapDocumentHtml('Services', tables.join(''), { dark: true });
  const uploaded = await uploadBytes(Buffer.from(html), 'Services.html', 'text/html', headers);

  // uploadBytes reuses the upload filename as the document's display name by default, but that
  // shows the ".html" extension as part of the icon caption in the app - override it to match
  // how the manually-built "Services" document names itself (file.short_name keeps the
  // extension, just not the document's own display name)
  return { ...uploaded, name: 'Services', meta: { source: SYNC_SOURCE } };
}

// Builds a card's "Stay" document from the hotel's own description (addressbook/hotels tables),
// for whichever day has a HotelAddressbook_id - matching the single-column table shape of a
// manually-built hotel document (studied against itinerary odyssey123's Day 1 "Haveli Hauz Khas
// Delhi" document), named "Stay" rather than the hotel's own name (the hotel's own name is still
// shown, bold/underlined, as the first line of the body). The Contact/Phone line reuses the same
// day row's Phone column (same source as the Services document's Contact row) rather than a
// separate hotel-specific number, formatted with the anchor attributes odyssey123's phone links
// use. Below that, a swipeable photo carousel, downloaded and embedded as base64 (see
// toEmbeddableDataUri) rather than linked - omitted entirely if search found nothing. imageUrls is
// resolved ahead of time by the sequential image-claiming pre-pass in the route handler below (see
// its comment for why that's sequential rather than running these lookups here in parallel with
// every other card). Returns null if the day has no hotel, or the hotel has no description.
async function buildStayDocument(hotelRow, hotel, imageUrls, headers) {
  if (!hotelRow || !hotel || !hotel.description) return null;

  const contactParagraph = (hotelRow.Phone && hotelRow.Phone.trim())
    ? `<p></p><p><strong>Contact:</strong> ${buildPhoneLink(hotelRow.Phone)}</p>`
    : '';

  const embeddedPhotos = (await Promise.all((imageUrls || []).map(toEmbeddableDataUri))).filter(Boolean);
  const imagesHtml = buildCarouselHtml(embeddedPhotos);

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
  return { ...uploaded, name: 'Stay', icon_id: 288, meta: { source: SYNC_SOURCE } };
}

// Builds a card's "City" document - identical in structure to buildStayDocument above, just
// sourced from cities/writeup instead of addressbook/hotels, keyed off Cities_id instead of
// HotelAddressbook_id. icon_id 284 is the city/location icon (studied against itinerary
// odyssey123's "Delhi" document, same day as its "Haveli Hauz Khas Delhi" hotel document).
// cityRow/city/imageUrls are all resolved ahead of time by the sequential image-claiming pre-pass
// in the route handler below (see its comment for why). Returns null if the day has no city, or
// the city has no writeup on file.
async function buildCityDocument(cityRow, city, imageUrls, headers) {
  if (!cityRow || !city || !city.writeup) return null;

  const contactParagraph = (cityRow.Phone && cityRow.Phone.trim())
    ? `<p></p><p><strong>Contact:</strong> ${buildPhoneLink(cityRow.Phone)}</p>`
    : '';

  const embeddedPhotos = (await Promise.all((imageUrls || []).map(toEmbeddableDataUri))).filter(Boolean);
  const imagesHtml = buildCarouselHtml(embeddedPhotos);

  const body = `<table style="min-width: 25px"><colgroup><col style="min-width: 25px"></colgroup>` +
    `<tbody><tr><td colspan="1" rowspan="1">` +
    `<p><strong><u>${city.City}</u></strong></p>` +
    `<p>${city.writeup}</p>` +
    `${contactParagraph}` +
    `${imagesHtml}` +
    `</td></tr></tbody></table>`;

  const html = wrapDocumentHtml('City', body, { dark: true });
  const uploaded = await uploadBytes(Buffer.from(html), 'City.html', 'text/html', headers);

  return { ...uploaded, name: 'City', icon_id: 284, meta: { source: SYNC_SOURCE } };
}

// Builds a card's Sightseeing document - same single-column layout as Stay/City, sourced from
// services.description/writeup (keyed off the row's own Services_id) instead of a hotel/city
// description - description as the bold/underlined title (matching how Stay/City use the hotel's
// own name/city's own name, rather than the SP's derived ServiceDesc column) and writeup as the
// body. docName is "Excursion" for a day with a single sightseeing activity, or "Excursion(1)"/
// "Excursion(2)"/... when there's more than one (the caller numbers them, since that depends on
// the whole day's rows, not just this one). icon_id 284 matches the manually-built "doyle"
// reference itinerary's own sightseeing documents (e.g. "Mehrangarh Fort and Jaswant Thada") -
// the same icon its City documents use, since Vamoos has no separate sightseeing/landmark icon.
// imageUrls (see findCuratedSightseeingPhotos above) are downloaded and embedded as base64, same
// as Stay/City, so the carousel can't go stale. Returns null if the service has no writeup on file.
async function buildSightseeingDocument(row, service, docName, imageUrls, headers) {
  if (!service || !service.writeup) return null;

  const embeddedPhotos = (await Promise.all((imageUrls || []).map(toEmbeddableDataUri))).filter(Boolean);
  const imagesHtml = buildCarouselHtml(embeddedPhotos);

  const body = `<table style="min-width: 25px"><colgroup><col style="min-width: 25px"></colgroup>` +
    `<tbody><tr><td colspan="1" rowspan="1">` +
    `<p><strong><u>${service.description}</u></strong></p>` +
    `<p>${service.writeup}</p>` +
    `${imagesHtml}` +
    `</td></tr></tbody></table>`;

  const html = wrapDocumentHtml(docName, body, { dark: true });
  const uploaded = await uploadBytes(Buffer.from(html), `${docName}.html`, 'text/html', headers);

  return { ...uploaded, name: docName, icon_id: 284, meta: { source: SYNC_SOURCE } };
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

// Parenthetical distance/duration Presto sometimes appends to a Drive row's own description (e.g.
// "Drive to Thekkady (161kms, 05:00hrs)") - stripped from the day summary below since it reads as
// trip logistics rather than the "fun" descriptive content the summary is for. The full text
// (distance/duration included) still shows in the per-row Additional Information list right below
// the summary, so nothing is actually lost.
const DISTANCE_DURATION_PATTERN = /\s*\(\s*\d+\s*kms?\.?,?\s*\d{1,2}:\d{2}\s*h(?:rs?)?\.?\s*\)/gi;

function stripDistanceDuration(text) {
  if (!text) return text;
  return text
    .replace(DISTANCE_DURATION_PATTERN, '')
    .replace(/\s+([.,])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Maps a row's own AtTime (HH:MM, per p_Rpt_QuoTourCardFormat's AtTime VARCHAR(5) column) to a
// casual time-of-day word - used only for Drive rows below, whose own ServiceDesc usually has no
// time-of-day phrasing of its own (unlike Sightseeing rows, which already read "Morning city tour
// of..." straight from Presto's own written description, so are left as-is).
function timeOfDayLabel(atTime) {
  const match = /^(\d{1,2}):/.exec(atTime || '');
  if (!match) return null;

  const hour = Number(match[1]);
  if (hour < 12) return 'Morning';
  if (hour < 17) return 'Afternoon';
  return 'Evening';
}

// Some Drive rows DO already lead with their own time-of-day phrasing (e.g. "Early morning drive
// to Satna... where you board the ... train to Varanasi") - guards the Drive-row handling below
// from double-prefixing ("Morning early morning drive to...").
const STARTS_WITH_TIME_OF_DAY = /^(early|late|full\s+day|rest\s+of\s+the\s+day|morning|afternoon|evening|night)\b/i;

function lowerFirst(text) {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

// Real ServiceDesc text isn't always punctuated consistently (some rows end with a period, some
// don't) - without this, two sentences with no trailing period run straight into each other with
// no separator when joined below (e.g. "...to Mararikulam 1 Twin and 1 Double...").
function ensureFullStop(text) {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

// Builds a short, easy-to-read summary for a card's Additional Information section, from the same
// ordered activity rows the per-row time list below it is built from. Template-based (no external
// API) - a placeholder for a future LLM-written version, sharing the same insertion point.
//
// Leans on Presto's own written ServiceDesc text throughout rather than synthesizing generic
// phrases ("your arrival transfer", "some sightseeing") - it's already brochure-quality prose that
// naturally covers arrival framing on its own (e.g. "You arrive in Delhi by BA 143 from London at
// 23:35. You are met on arrival ... and transferred to your hotel.") once the pax/date/admin
// clutter is trimmed off (see buildServiceSummaryByDayNo above for that same trimServiceDesc
// cleanup). The one place real data gets woven in on top of that: an Accommodation row's hotel
// name, looked up live via getHotelDescription (the same lookup buildStayDocument already relies
// on, keyed off HotelAddressbook_id) rendered as "Stay at {name}." Falls back to a generic "Stay
// at your hotel." (never the raw room-type/booking text, which reads as booking admin rather than
// a description) only if that lookup comes back empty.
//
// A TrsType 1 (Tickets) row can carry p_Rpt_QuoTourCardFormat's own Overnight flag (1/0) - an
// overnight train/bus/flight slept on rather than a hotel (confirmed: Overnight only ever appears
// on TrsType 1 rows, never on the TrsType 2 Accommodation row above - the two are mutually
// exclusive by day, not a gate on each other). Tickets rows tend to be terser/more formal than a
// narrative Transport row (booking class, ticket numbers), so this is synthesized rather than
// trusting the raw ServiceDesc, same reasoning as the "Stay at your hotel." accommodation fallback.
const OVERNIGHT_TRAVEL_SENTENCE = 'Sleep on the overnight train.';

// Returns null only for a day with no real activities at all (e.g. a "Day At Leisure" filler
// day) - every other day gets a draft, including a single-activity day, since the draft now feeds
// rewriteDaySummariesWithLLM below rather than being shown verbatim: a lone sightseeing row's own
// line right below the summary would once have made a same-text draft purely redundant, but the
// LLM rewrite means the summary can genuinely add something (a line or two of richer color) rather
// than just repeating it, the same way "Stay at {hotel}." already adds something beyond the raw
// room/booking line for a lone accommodation day.
async function buildDaySummarySentence(rows, getHotelDescription) {
  const activityRows = rows.filter((row) => row.QuoLines_id);
  if (!activityRows.length) return null;

  async function hotelClause(row) {
    let hotelName = null;
    try {
      const hotel = await getHotelDescription(row.HotelAddressbook_id);
      hotelName = hotel && hotel.Organisation;
    } catch (err) {
      console.error('[vamoosAPI] failed to look up hotel name for day summary', err);
    }
    return hotelName ? `Stay at ${hotelName}.` : 'Stay at your hotel.';
  }

  const isAccommodationStay = (row) => row.TrsType === 2 && row.HotelAddressbook_id;
  const isOvernightTravel = (row) => row.TrsType === 1 && row.Overnight;

  const sentences = [];

  for (const row of activityRows) {
    if (row.TrsType === 2) {
      if (isAccommodationStay(row)) sentences.push(await hotelClause(row));
      continue;
    }

    if (isOvernightTravel(row)) {
      sentences.push(OVERNIGHT_TRAVEL_SENTENCE);
      continue;
    }

    if (row.TrsType === 5) {
      const cleaned = stripDistanceDuration(trimServiceDesc(row.ServiceDesc));
      if (!cleaned) continue;
      const period = !STARTS_WITH_TIME_OF_DAY.test(cleaned) && timeOfDayLabel(row.AtTime);
      sentences.push(ensureFullStop(period ? `${period} ${lowerFirst(cleaned)}` : cleaned));
      continue;
    }

    const description = stripDistanceDuration(trimServiceDesc(row.ServiceDesc));
    if (description) sentences.push(ensureFullStop(description));
  }

  return sentences.length ? sentences.join(' ') : null;
}

// Formats one row of the per-card Additional Information time list (below the LLM-written summary
// - see rewriteDaySummariesWithLLM below). An Accommodation row's raw ServiceDesc is internal
// booking detail (room type, meal basis) rather than something worth showing verbatim - shown
// instead as "Stay: {hotel name}" (no AtTime prefix; that's not meaningful for a whole-night stay),
// via the same getHotelDescription lookup buildStayDocument and buildDaySummarySentence already
// rely on. Every other TrsType is left exactly as it was (AtTime bold, ServiceDesc as-is).
async function formatAdditionalInfoRow(row, getHotelDescription) {
  if (row.TrsType !== 2 || !row.HotelAddressbook_id) {
    return `<p><strong>${row.AtTime}</strong>   ${row.ServiceDesc}</p>`;
  }

  let hotelName = null;
  try {
    const hotel = await getHotelDescription(row.HotelAddressbook_id);
    hotelName = hotel && hotel.Organisation;
  } catch (err) {
    console.error('[vamoosAPI] failed to look up hotel name for Additional Information row', err);
  }

  return `<p>Stay: ${hotelName || 'Your Hotel'}</p>`;
}

// Extracts the [origin, destination] pair from a draft's "from X to Y" clause (the shape
// buildDaySummarySentence's Drive handling produces), or null if the draft has no such clause -
// used by preservesTravelOrder below to sanity-check the LLM rewrite didn't reverse it.
function extractFromToOrder(draft) {
  const match = /\bfrom\s+([A-Z][\w'-]*(?:\s+[A-Z][\w'-]*)*)\s+to\s+([A-Z][\w'-]*(?:\s+[A-Z][\w'-]*)*)/.exec(draft || '');
  return match ? [match[1], match[2]] : null;
}

// Cheap, deterministic guard against a real failure mode observed while testing this feature: the
// LLM restructuring a "from X to Y" sentence can occasionally reverse it (more likely when a place
// name repeats across adjacent days, e.g. two consecutive days both mentioning the same
// stopover) - tightening the prompt alone didn't reliably prevent this, it just moved which day it
// happened to. True (safe to use the rewrite) when the draft has no from/to clause to check, or
// when the rewrite still mentions the origin before the destination; false (mentions either out of
// order or drops one) is treated as a failed rewrite for that single day only.
function preservesTravelOrder(draft, rewritten) {
  const pair = extractFromToOrder(draft);
  if (!pair) return true;

  const [from, to] = pair;
  const fromIndex = rewritten.indexOf(from);
  const toIndex = rewritten.indexOf(to);
  return fromIndex !== -1 && toIndex !== -1 && fromIndex < toIndex;
}

// Rewrites a whole itinerary's worth of day-summary drafts (see buildDaySummarySentence above) in
// a single call, rather than one call per day. A per-day call is blind to every other day - it
// has no memory of what phrasing it already used - so it reliably converges on the same handful
// of "safe" travel-writing phrases every time ("settle in", "scenic drive", ...), which reads as
// monotonous once a traveler reads the whole itinerary end to end. Seeing every day at once lets
// Claude deliberately vary vocabulary, sentence rhythm, and opening words across the set, and
// write with genuine excitement rather than just restating the facts. Still a style pass only -
// never allowed to add or remove facts from any individual day's draft.
//
// entries is an array of { cardNo, draft } - only cards with a non-null draft (nothing to rewrite
// for a suppressed single-activity/leisure day, see buildDaySummarySentence). Returns a
// { [cardNo]: rewrittenSentence } map. Best-effort: returns {} (every card falls back to its own
// draft) if no API key is configured, entries is empty, the response doesn't match the input
// count, or the call fails for any reason - the itinerary never shows less than the proven
// rule-based sentences.
async function rewriteDaySummariesWithLLM(entries) {
  if (!anthropicClient || !entries.length) return {};

  try {
    const response = await anthropicClient.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 4000,
      system: 'You are polishing the day-by-day summary lines of a travel itinerary into vivid, ' +
        'exciting, easy-to-read holiday-brochure prose - the kind that keeps a traveler engaged ' +
        'reading through the whole trip, not a dry restatement of facts. You will be given one ' +
        'draft sentence per day, numbered in order. Rewrite each one individually. Rules: ' +
        '(1) for a CITY or famous LANDMARK already named in that day\'s draft, you may add brief, ' +
        'well-known, unmistakably-true color about it (a famous nickname like "the Pink City", a ' +
        'globally iconic monument, well-established cultural/historical character) - but only ' +
        'facts you are highly confident are accurate and undisputed, never a guess; (2) for a ' +
        'HOTEL or property named in that day\'s draft, add NO descriptive detail beyond its name - ' +
        'you have no real knowledge of specific small properties (their setting, views, ambience) ' +
        'and any invented detail is a guess that risks simply being wrong (e.g. do not call a ' +
        'named hotel a "refuge in the foothills" unless the draft itself says so); (3) never invent ' +
        'a place, activity, or fact that is not in the draft or well-known/true as in rule 1; ' +
        '(4) never drop a fact that is present in that day\'s own draft; (5) when a draft names two ' +
        'places in a from/to, departure/arrival, or origin/destination relationship, keep that same ' +
        'relationship and order in the rewrite - do not restructure the sentence in a way that ' +
        'changes, reverses, or leaves ambiguous which place is the origin and which is the ' +
        'destination, and be careful not to blend a place mentioned in one day with a same-named ' +
        'place in an adjacent day; (6) actively vary your vocabulary, sentence structure, and ' +
        'opening words across the full set of days - do not lean on the same stock phrases (e.g. ' +
        '"settle in", "scenic drive") more than once across the whole itinerary; (7) keep each one ' +
        'to one or two short, punchy sentences; (8) return exactly one rewritten sentence per input ' +
        'draft, in the same order.',
      messages: [{
        role: 'user',
        content: entries.map((entry, index) => `${index + 1}. ${entry.draft}`).join('\n')
      }],
      output_config: {
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              sentences: { type: 'array', items: { type: 'string' } }
            },
            required: ['sentences'],
            additionalProperties: false
          }
        }
      }
    });

    const text = response.content.find((block) => block.type === 'text');
    const parsed = text && JSON.parse(text.text);
    const sentences = parsed && parsed.sentences;

    if (!Array.isArray(sentences) || sentences.length !== entries.length) {
      console.error('[vamoosAPI] LLM day-summary batch rewrite returned a mismatched result, falling back to drafts');
      return {};
    }

    const rewrittenByCardNo = {};
    entries.forEach((entry, index) => {
      const rewritten = sentences[index];
      const safe = preservesTravelOrder(entry.draft, rewritten);
      if (!safe) {
        console.error(`[vamoosAPI] LLM day-summary rewrite reversed travel order for CardNo ${entry.cardNo}, falling back to its draft`);
      }
      rewrittenByCardNo[entry.cardNo] = safe ? rewritten : entry.draft;
    });
    return rewrittenByCardNo;
  } catch (err) {
    console.error('[vamoosAPI] failed to batch-rewrite day summaries via LLM', err);
    return {};
  }
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

// Fetches the currently-live itinerary and returns a day_number -> documents[] map of only the
// documents NOT stamped with SYNC_SOURCE - i.e. anything attached manually in the Vamoos portal
// (an actual ticket, etc.) rather than by this integration. Converts each one from the read shape
// GET returns (which the create/update endpoint rejects as-is - it has extra fields like id/tag/
// file.id that fail its "no additional properties" validation) to the plain file_url/name/meta
// shape a POST accepts, so it can be spliced back into that day's freshly-rebuilt documents rather
// than being silently overwritten. Best-effort: on any failure, returns {} (nothing preserved)
// rather than blocking the create/update - only called when an existing vamoos_id was found, so
// a brand-new itinerary never bothers with this.
async function getManualDocumentsByDayNo(operator_code, reference_code, headers) {
  let itinerary;
  try {
    const { data } = await axios.get(`${keys.vamoosHost}/itinerary/${operator_code}/${reference_code}`, { headers });
    itinerary = data;
  } catch (err) {
    console.error('[vamoosAPI] failed to fetch existing itinerary for manual-document preservation', err);
    return {};
  }

  const manualByDayNo = {};
  (itinerary.details || []).forEach((detail) => {
    const dayNo = detail.meta && detail.meta.day_number;
    if (dayNo === undefined) return;

    const manualDocs = (detail.documents || [])
      .filter((doc) => !doc.meta || doc.meta.source !== SYNC_SOURCE)
      .map((doc) => ({
        file_url: doc.file.https_url.split('?')[0],
        name: doc.name,
        ...(doc.meta ? { meta: doc.meta } : {}),
        ...(doc.icon_id ? { icon_id: doc.icon_id } : {})
      }));

    if (manualDocs.length) manualByDayNo[dayNo] = manualDocs;
  });

  return manualByDayNo;
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

      // only a rerun (an existing itinerary) can have manually-attached documents to preserve -
      // a brand-new itinerary has nothing live yet to fetch
      const manualDocumentsByDayNo = vamoos_id
        ? await getManualDocumentsByDayNo(operator_code, reference_code, headers)
        : {};

      const { locations: hotelLocations, internalIdByDayNo } = await buildHotelLocations(vamoosData.hotelsByDay, headers);
      const imsertApiKey = await getImsertApiKey(headers);
      const libraryImages = await listLibraryImages(headers);
      const cityPhotosByCity = groupCityPhotosByCity(await listLibraryFolderImages(headers, '/library/City/'));

      // shared across every image lookup below (background, hotel cards, narrative cards) so
      // the same underlying photo never gets claimed by more than one card
      const usedImageIds = new Set();

      // one counter per city, shared and mutated across every card below in day order, so each
      // day's own cover photo cycles through that city's curated /library/City/ photos in sequence
      // (see pickCycledCityPhoto above) rather than every day in the same city showing the same one
      const cityVisitCounts = {};

      // the cover photo is the city the tour spends the most nights in (ties go to whichever of
      // those cities is visited first), sourced from p_Rpt_QuoTourCardFormat's own City column -
      // populated on every row (unlike Cities_id, which the SP nulls out on repeat days to dedup
      // the City document) - so this needs no separate DB round-trip to un-dedup it. Claiming its
      // photo(s) here, before any per-card/document image lookup runs, means the shared
      // usedImageIds set already keeps that same photo from being reused in the day-to-day cards
      // or a City document's carousel further down.
      const cityByQuoLinesId = {};
      vamoosData.tourCards.forEach((row) => {
        if (row.QuoLines_id && row.City) cityByQuoLinesId[row.QuoLines_id] = row.City;
      });

      const coverCity = findCityWithMostNights(vamoosData.tourCards, cityByQuoLinesId);
      const backgroundImages = coverCity
        ? await findImsertImages(coverCity, 3, imsertApiKey, usedImageIds, { preferGenericPhotos: true })
        : [];

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

      // opening-screen title year - the tour's actual start year, per the first row's own
      // ServiceDate (tourCards comes back CardNo-ordered from the SP, so [0] is day one)
      const tourYear = yearOf(vamoosData.tourCards[0] && vamoosData.tourCards[0].ServiceDate);

      // basic trial payload, following the Vamoos "Create An Itinerary" guide
      const itinerary_data = {
        departure_date: req.body.departure_date || toDateOnly(vamoosData.quoPrint.StartDate) || '2020-09-22',
        return_date: req.body.return_date || toDateOnly(vamoosData.quoPrint.EndDate) || '2020-09-30',
        // Vamoos defaults new itineraries to Europe/London when this is left unset (confirmed by
        // comparing a manually-built itinerary's own top-level "timezone" field against ours,
        // which had none) - all Presto tours are India-based, so Asia/Calcutta always applies.
        timezone: req.body.timezone || 'Asia/Calcutta',
        field1: (vamoosData.quoPrint.country || 'Rome Trip 2020') + (tourYear ? `, ${tourYear}` : ''),
        field3: vamoosData.quoPrint.PaxInfo || '--',
        client_reference: vamoosData.quoPrint.Reference || '',
        background: req.body.background
          || (coverCity && findLibraryImage(
                libraryImages.filter((item) => !looksLikeAccommodationPhoto(item.name)), coverCity, usedImageIds))
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

          // Phase 0: claims every image (card covers, Stay/City carousels) sequentially, in day
          // order, BEFORE any of the per-card work in Phase 1 below runs in parallel. Two
          // different days can want the same photo (e.g. a hotel visited on both an early and a
          // later day) - each claim checks and marks the shared usedImageIds set so the same
          // photo is never used twice, and doing that check-and-mark sequentially is what makes
          // the day that "wins" a contested photo deterministic (always the earlier day) rather
          // than a race between whichever card's Imsert network call happens to resolve first.
          // Confirmed live (Quotations_id 9266): Day 1 and Day 9 both stay at Andaz Delhi, and
          // running these same claims inside a parallel per-card loop left Day 1's Stay carousel
          // empty because Day 9's own claim - running concurrently, not after - won the race for
          // the same photos. hotelRow/cityRow and their descriptions are resolved here too (not
          // just inside buildStayDocument/buildCityDocument) so a day whose hotel/city has no
          // description on file never claims carousel photos it'll then throw away.
          const imageClaimsByCardNo = {};
          for (const cardNo of cardNosInOrder) {
            const rows = rowsByCardNo[cardNo].sort((a, b) => a.SubCardNo - b.SubCardNo);

            // the day's own cover photo cycles through its last city's (time-wise) curated
            // /library/City/ photos - see pickCycledCityPhoto above
            const image = pickCycledCityPhoto(cityPhotosByCity, rows[rows.length - 1].City, cityVisitCounts);

            const hotelRow = rows.find((row) => row.HotelAddressbook_id) || null;
            let hotel = null;
            let stayImages = [];
            if (hotelRow) {
              hotel = await dbQueries.getHotelDescription(hotelRow.HotelAddressbook_id);
              if (hotel && hotel.description) {
                stayImages = await findCuratedHotelPhotos(hotelRow, headers, usedImageIds, Infinity);
              }
            }

            const cityRow = rows.find((row) => row.Cities_id) || null;
            let city = null;
            let cityImages = [];
            if (cityRow) {
              city = await dbQueries.getCityDescription(cityRow.Cities_id);
              if (city && city.writeup) {
                cityImages = await findCuratedCityPhotos(cityRow, headers, usedImageIds, Infinity);
              }
            }

            imageClaimsByCardNo[cardNo] = { image, hotelRow, hotel, stayImages, cityRow, city, cityImages };
          }

          // Phase 1: build everything for each card except the final Additional Information
          // content string, which needs every card's draft summary rewritten together in one
          // batch (see rewriteDaySummariesWithLLM above) rather than one at a time.
          const cardsData = await Promise.all(cardNosInOrder.map(async (cardNo, index) => {
            const rows = rowsByCardNo[cardNo].sort((a, b) => a.SubCardNo - b.SubCardNo);
            const firstRow = rows[0];
            const claims = imageClaimsByCardNo[cardNo];

            // A multi-day "Days At Leisure" gap card (see p_Rpt_QuoTourCardFormat's own gap-fill
            // logic) is inserted as a single CardNo covering several real days at once - the
            // numbering simply skips ahead to the next real activity's CardNo, so the gap between
            // this card's CardNo and the next one in cardNosInOrder tells us how many days it
            // actually spans. Vamoos's own "Day #" badge (meta.day_number below) has only ever
            // been observed as a single integer, so it stays the first day of the range (safe,
            // known-working) - the day range instead goes into the headline text, which we fully
            // control and don't need to guess whether Vamoos supports as a range.
            const nextCardNo = cardNosInOrder[index + 1];
            const lastDayNo = nextCardNo && nextCardNo - cardNo > 1 ? nextCardNo - 1 : cardNo;
            const headline = lastDayNo > cardNo ? `Days ${cardNo}-${lastDayNo} At Leisure` : firstRow.Title;

            const draftSummary = await buildDaySummarySentence(rows, dbQueries.getHotelDescription);

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
              stayDoc = await buildStayDocument(claims.hotelRow, claims.hotel, claims.stayImages, headers);
            } catch (err) {
              console.error(`[vamoosAPI] failed to build stay document for CardNo ${cardNo}`, err);
            }

            let cityDoc = null;
            try {
              cityDoc = await buildCityDocument(claims.cityRow, claims.city, claims.cityImages, headers);
            } catch (err) {
              console.error(`[vamoosAPI] failed to build city document for CardNo ${cardNo}`, err);
            }

            // one Sightseeing document per TrsType=3 row that has a Services_id - "Excursion" for
            // a day with just one, "Excursion(1)"/"Excursion(2)"/... when there's more than one -
            // paired with that row's own SubCardNo so it can be placed chronologically below
            let sightseeingEntries = [];
            try {
              const sightseeingRows = rows.filter((row) => row.TrsType === 3 && row.Services_id);
              const built = await Promise.all(sightseeingRows.map(async (row, index) => {
                const docName = sightseeingRows.length > 1 ? `Excursion(${index + 1})` : 'Excursion';
                const service = await dbQueries.getServiceDescription(row.Services_id);
                const imageUrls = await findCuratedSightseeingPhotos(row, headers, Infinity);
                const doc = await buildSightseeingDocument(row, service, docName, imageUrls, headers);
                return { subCardNo: row.SubCardNo, doc };
              }));
              sightseeingEntries = built.filter((entry) => entry.doc);
            } catch (err) {
              console.error(`[vamoosAPI] failed to build sightseeing documents for CardNo ${cardNo}`, err);
            }

            // Stay/City/Excursion are ordered to match the row order they came from in the stored
            // procedure (e.g. a hotel arrived at between two sightseeing stops sits between their
            // two Excursion documents), by the SubCardNo of whichever row each one came from.
            // Services stays first regardless - it's a whole-day summary, not tied to one row.
            const chronologicalDocs = [
              ...(claims.hotelRow && stayDoc ? [{ subCardNo: claims.hotelRow.SubCardNo, doc: stayDoc }] : []),
              ...(claims.cityRow && cityDoc ? [{ subCardNo: claims.cityRow.SubCardNo, doc: cityDoc }] : []),
              ...sightseeingEntries
            ].sort((a, b) => a.subCardNo - b.subCardNo).map((entry) => entry.doc);

            // re-append whatever was manually attached to this day's card last time, so
            // regenerating from Presto doesn't wipe it out
            const documents = [servicesDoc, ...chronologicalDocs].filter(Boolean)
              .concat(manualDocumentsByDayNo[cardNo] || []);

            return { cardNo, headline, rows, draftSummary, image: claims.image, documents };
          }));

          // Phase 2: one Claude call for the whole itinerary's worth of drafts (see
          // rewriteDaySummariesWithLLM above for why this is batched rather than per-day), then
          // assemble each card's final Additional Information content.
          const rewrittenByCardNo = await rewriteDaySummariesWithLLM(
            cardsData
              .filter((card) => card.draftSummary)
              .map((card) => ({ cardNo: card.cardNo, draft: card.draftSummary }))
          );

          return Promise.all(cardsData.map(async (card) => {
            const summarySentence = rewrittenByCardNo[card.cardNo] || card.draftSummary;

            // Additional Information: an optional summary (see buildDaySummarySentence/
            // rewriteDaySummariesWithLLM above), followed by every row for the day (see
            // formatAdditionalInfoRow above) - each its own <p> block with real spaces, not
            // &nbsp;, since the app's content renderer isn't a full HTML parser (see
            // buildServiceSummaryByDayNo above)
            const rowLines = await Promise.all(
              card.rows.map((row) => formatAdditionalInfoRow(row, dbQueries.getHotelDescription))
            );
            const content = (summarySentence ? `<p>${summarySentence}</p>` : '') + rowLines.join('');

            return {
              headline: card.headline,
              content,
              content_type: 'text/html',
              meta: { day_number: card.cardNo },
              ...(card.image ? { image: card.image } : {}),
              ...(card.documents.length ? { documents: card.documents } : {})
            };
          }));
        })(),
        ...(vamoos_id ? { vamoos_id, is_active: true } : {})
      };

      console.log(vamoos_id
        ? `[vamoosAPI] updating existing itinerary vamoos_id=${vamoos_id} at ${itinerary_url}`
        : `[vamoosAPI] creating new itinerary at ${itinerary_url}`);
      console.log('[vamoosAPI] payload', itinerary_data);

      // best-effort: a snapshot of exactly what was sent, for diffing against what the app then
      // renders - failing to write it should never block the actual sync
      try {
        const debugPath = path.join(__dirname, '../../../../debug', `${vamoosData.quoPrint.Quotations_id}.json`);
        fs.writeFileSync(debugPath, JSON.stringify(itinerary_data, null, 2));
      } catch (err) {
        console.error('[vamoosAPI] failed to write debug payload', err);
      }

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
