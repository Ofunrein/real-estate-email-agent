#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { google } from "googleapis";
import pg from "pg";

const { Pool } = pg;

export const PROPERTIES_TAB = "properties";
export const PROPERTIES_HEADERS = [
  "address",
  "price",
  "beds",
  "baths",
  "city",
  "state",
  "zip",
  "description",
  "neighborhood",
  "property_type",
  "features",
  "days_on_market",
  "photo_url",
  "sqft",
  "year_built",
  "status",
  "listing_url",
  "agent_name",
  "agent_email",
];

const DEFAULT_ACTOR = "truefetch~zillow-real-estate-listings";
const DEFAULT_RESULT_COST = 0.0017;
const DEFAULT_RUN_COST = 0;
const DEFAULT_EXISTING_CSV = "dataset_zillow-detail-scraper_2026-05-18_18-15-11-332.csv";
const AUSTIN_ZIPS = [
  "78701", "78702", "78703", "78704", "78705", "78717", "78721", "78722",
  "78723", "78724", "78725", "78726", "78727", "78728", "78729", "78730",
  "78731", "78732", "78733", "78734", "78735", "78736", "78737", "78738",
  "78739", "78741", "78742", "78744", "78745", "78746", "78747", "78748",
  "78749", "78750", "78751", "78752", "78753", "78754", "78756", "78757",
  "78758", "78759",
];

const PROPERTY_TYPES = [
  { label: "single_family", actorValue: "house" },
  { label: "condo", actorValue: "condo" },
  { label: "townhouse", actorValue: "townhouse" },
  { label: "apartment", actorValue: "apartment" },
  { label: "residential_broad", actorValue: "residential" },
];

const LISTING_TYPES = [
  { label: "for_sale", actorValue: "for_sale" },
  { label: "for_rent", actorValue: "for_rent" },
  { label: "recently_sold", actorValue: "sold" },
];

const PRICE_BANDS = [
  { label: "under_300k", maxPrice: 300000 },
  { label: "300k_500k", minPrice: 300000, maxPrice: 500000 },
  { label: "500k_750k", minPrice: 500000, maxPrice: 750000 },
  { label: "750k_1m", minPrice: 750000, maxPrice: 1000000 },
  { label: "1m_plus", minPrice: 1000000 },
];

const BED_BANDS = [
  { label: "studio_1", maxBeds: 1 },
  { label: "2_beds", minBeds: 2, maxBeds: 2 },
  { label: "3_beds", minBeds: 3, maxBeds: 3 },
  { label: "4_plus", minBeds: 4 },
];

function loadDotenv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

function parseArgs(argv) {
  const args = {
    city: "Austin",
    state: "TX",
    target: 2000,
    dryRun: false,
    syncDb: false,
    limitPerQuery: 50,
    actor: process.env.APIFY_ZILLOW_SEARCH_ACTOR || DEFAULT_ACTOR,
    sleepMs: 1200,
    maxQueries: 0,
    planOnly: false,
    timeoutSeconds: 120,
    existingCsv: process.env.ZILLOW_EXISTING_CSV || DEFAULT_EXISTING_CSV,
    retries: 2,
    retryBaseMs: 2000,
    fromApifyRunsSince: "",
    runLimit: 100,
    reportPath: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index];
    if (arg === "--city") args.city = next();
    else if (arg === "--state") args.state = next();
    else if (arg === "--target") args.target = Number(next());
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--sync-db") args.syncDb = true;
    else if (arg === "--limit-per-query") args.limitPerQuery = Number(next());
    else if (arg === "--actor") args.actor = next();
    else if (arg === "--sleep-ms") args.sleepMs = Number(next());
    else if (arg === "--max-queries") args.maxQueries = Number(next());
    else if (arg === "--plan-only") args.planOnly = true;
    else if (arg === "--timeout-seconds") args.timeoutSeconds = Number(next());
    else if (arg === "--existing-csv") args.existingCsv = next();
    else if (arg === "--retries") args.retries = Number(next());
    else if (arg === "--retry-base-ms") args.retryBaseMs = Number(next());
    else if (arg === "--from-apify-runs-since") args.fromApifyRunsSince = next();
    else if (arg === "--run-limit") args.runLimit = Number(next());
    else if (arg === "--report-path") args.reportPath = next();
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  args.target = Math.max(1, Math.floor(args.target || 2000));
  args.limitPerQuery = Math.max(1, Math.floor(args.limitPerQuery || 50));
  args.sleepMs = Math.max(0, Math.floor(args.sleepMs || 0));
  args.timeoutSeconds = Math.max(10, Math.floor(args.timeoutSeconds || 120));
  args.retries = Math.max(0, Math.floor(args.retries || 0));
  args.retryBaseMs = Math.max(0, Math.floor(args.retryBaseMs || 0));
  args.runLimit = Math.max(1, Math.floor(args.runLimit || 100));
  return args;
}

function usage() {
  return `Usage:
  node scripts/import-zillow-apify-properties.mjs --city Austin --state TX --target 2000 --dry-run --limit-per-query 50
  node scripts/import-zillow-apify-properties.mjs --city Austin --state TX --target 2000 --sync-db

Flags:
  --city <name>              City search scope. Default: Austin
  --state <abbr>             State abbreviation. Default: TX
  --target <count>           Desired new unique properties. Default: 2000
  --dry-run                  Fetch and report only; do not write Sheets or Neon
  --sync-db                  After Sheet append, run npm run sync:sheets
  --limit-per-query <count>  Apify max_results per search slice. Default: 50
  --actor <id>               Apify actor ID. Default: ${DEFAULT_ACTOR}
  --max-queries <count>      Cap slices for smoke tests. Default: unlimited
  --sleep-ms <ms>            Delay between actor calls. Default: 1200
  --plan-only                Print strategy and estimate without Apify calls
  --existing-csv <path>      Existing scraped Zillow CSV for duplicate detection
  --retries <count>          Retries for transient Apify failures. Default: 2
  --retry-base-ms <ms>       Retry backoff base delay. Default: 2000
  --from-apify-runs-since <iso> Recover items from already-paid Apify runs
  --run-limit <count>        Max Apify runs to inspect in recovery mode
  --report-path <path>       Write final report JSON to disk
`;
}

function clean(value) {
  if (value == null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function digits(value) {
  const text = clean(value).replace(/,/g, "");
  const match = text.match(/\d+(?:\.\d+)?/);
  return match ? match[0] : "";
}

function apifyPriceDigits(priceObj, item) {
  if (priceObj && typeof priceObj === "object" && Object.keys(priceObj).length > 0) {
    for (const key of ["value", "market", "min", "text", "rent_estimate"]) {
      const parsed = digits(priceObj[key]);
      if (parsed) return parsed;
    }
    return "";
  }
  return digits(pick(item.list_price, item.priceForHDP, item.price, item.zestimate, item.rentZestimate));
}

function pick(...values) {
  for (const value of values) {
    const text = clean(value);
    if (text) return text;
  }
  return "";
}

function zipFromText(...values) {
  for (const value of values) {
    const match = clean(value).match(/\b(78\d{3})\b/);
    if (match) return match[1];
  }
  return "";
}

function cityStateFromLocation(location) {
  const parts = clean(location).split(",").map((part) => part.trim()).filter(Boolean);
  return {
    city: parts[0] || "",
    state: parts.find((part) => /^[A-Z]{2}$/.test(part)) || "",
    zip: parts.find((part) => /^78\d{3}$/.test(part)) || "",
  };
}

function listText(value) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean).join(",");
  return clean(value);
}

function titleizeType(value) {
  const text = clean(value);
  if (!text) return "";
  const map = {
    SINGLE_FAMILY: "Single-Family Home",
    SingleFamily: "Single-Family Home",
    houses: "Single-Family Home",
    house: "Single-Family Home",
    HOUSE: "Single-Family Home",
    House: "Single-Family Home",
    CONDO: "Condo",
    condo: "Condo",
    Condo: "Condo",
    TOWNHOUSE: "Townhouse",
    townhomes: "Townhouse",
    townhouse: "Townhouse",
    Townhouse: "Townhouse",
    MULTI_FAMILY: "Multi-Family",
    multi_family: "Multi-Family",
    APARTMENT: "Apartment",
    apartments: "Apartment",
    apartment: "Apartment",
    Apartment: "Apartment",
    MANUFACTURED: "Manufactured",
  };
  return map[text] || text.replace(/[_-]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeListingUrl(item) {
  const raw = pick(item.listing_url, item.property_url, item.source_url, item.official_url, item.detailUrl, item.url, item.hdpUrl, item.bdpUrl, item.postingUrl);
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/")) return `https://www.zillow.com${raw}`;
  const zpid = pick(item.zpid, item.property_id, item.listing_id);
  return zpid ? `https://www.zillow.com/homedetails/${zpid}_zpid/` : "";
}

function normalizePhotoUrl(item) {
  const responsive = Array.isArray(item.responsivePhotos) ? item.responsivePhotos : [];
  const photo = responsive.find((entry) => typeof entry?.url === "string" && entry.url)?.url;
  const imageUrls = Array.isArray(item.image_urls) ? item.image_urls : [];
  return pick(
    item.photo_url,
    item.cover_image,
    imageUrls[0],
    item.primary_photo,
    item.imgSrc,
    item.hiResImageLink,
    item.desktopWebHdpImageLink,
    item.image,
    item.photo,
    item.primaryPhoto,
    photo,
  );
}

function statusFromItem(item, slice) {
  return pick(item.status, item.homeStatus, item.listingStatus, item.home_status, slice?.listingLabel)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function normalizeApifyItem(item, slice = {}) {
  const addressObject = item.address && typeof item.address === "object" ? item.address : {};
  const attribution = item.attributionInfo && typeof item.attributionInfo === "object" ? item.attributionInfo : {};
  const price = item.price && typeof item.price === "object" ? item.price : null;
  const rooms = item.rooms && typeof item.rooms === "object" ? item.rooms : {};
  const area = item.area && typeof item.area === "object" ? item.area : {};
  const dates = item.dates && typeof item.dates === "object" ? item.dates : {};
  const contact = item.contact && typeof item.contact === "object" ? item.contact : {};
  const locationParts = cityStateFromLocation(item.location);
  const row = {
    address: pick(item.address, item.streetAddress, item.street_address, addressObject.streetAddress, item.abbreviatedAddress),
    price: apifyPriceDigits(price, item),
    beds: digits(pick(rooms.beds, item.beds, item.bedrooms, item.bedroomsTotal)),
    baths: digits(pick(rooms.baths, item.baths, item.baths_full, item.bathrooms, item.bathroomsTotalInteger)),
    city: pick(item.city, addressObject.city, locationParts.city, slice.city),
    state: pick(item.state, addressObject.state, locationParts.state, slice.state),
    zip: pick(item.zip, item.zip_code, item.zipcode, addressObject.zipcode, locationParts.zip, zipFromText(item.title, item.description, item.location), slice.zip),
    description: pick(item.description, item.agent_broker),
    neighborhood: pick(item.neighborhood, addressObject.neighborhood, item.neighborhood_name, item.subdivision, item.hood),
    property_type: titleizeType(pick(item.property_type, item.propertyType, item.homeType, item.home_type, slice.propertyTypeLabel)),
    features: pick(listText(item.features), listText(item.amenities), item.whatILove),
    days_on_market: digits(pick(dates.market_days, item.days_on_market, item.daysOnZillow, item.timeOnZillow)),
    photo_url: normalizePhotoUrl(item),
    sqft: digits(pick(area.floor, area.floor_text, item.sqft, item.livingArea, item.livingAreaValue, item.living_area)),
    year_built: digits(pick(item.year_built, item.yearBuilt)),
    status: statusFromItem(item, slice),
    listing_url: normalizeListingUrl(item),
    agent_name: pick(item.agent_name, item.agentName, contact.agent, contact.agency, attribution.agentName, attribution.brokerName),
    agent_email: pick(item.agent_email, item.agentEmail, contact.email, attribution.agentEmail),
  };
  return Object.fromEntries(PROPERTIES_HEADERS.map((header) => [header, row[header] || ""]));
}

export function normalizeAddressKey(address) {
  return clean(address)
    .toLowerCase()
    .replace(/\b(?:street|st)\b/g, "st")
    .replace(/\b(?:avenue|ave)\b/g, "ave")
    .replace(/\b(?:drive|dr)\b/g, "dr")
    .replace(/\b(?:road|rd)\b/g, "rd")
    .replace(/\b(?:boulevard|blvd)\b/g, "blvd")
    .replace(/\b(?:lane|ln)\b/g, "ln")
    .replace(/\b(?:court|ct)\b/g, "ct")
    .replace(/[^a-z0-9#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function listingKey(row) {
  const url = clean(row.listing_url).toLowerCase();
  if (url === "https://www.zillow.com" || url === "https://www.zillow.com/") return "";
  const zpid = url.match(/\/(\d+)_zpid\b/)?.[1];
  return zpid ? `zpid:${zpid}` : url ? `url:${url}` : "";
}

export function dedupeRows(rows, existingRows = []) {
  const seenAddresses = new Set();
  const seenListings = new Set();
  const unique = [];
  const duplicates = [];

  for (const row of existingRows) {
    const address = normalizeAddressKey(row.address);
    const listing = listingKey(row);
    if (address) seenAddresses.add(address);
    if (listing) seenListings.add(listing);
  }

  for (const row of rows) {
    const address = normalizeAddressKey(row.address);
    const listing = listingKey(row);
    const duplicate = !address || seenAddresses.has(address) || (listing && seenListings.has(listing));
    if (duplicate) {
      if (address) seenAddresses.add(address);
      if (listing) seenListings.add(listing);
      duplicates.push(row);
      continue;
    }
    seenAddresses.add(address);
    if (listing) seenListings.add(listing);
    unique.push(row);
  }
  return { unique, duplicates };
}

function buildDedupeState(existingRows = []) {
  const seenAddresses = new Set();
  const seenListings = new Set();
  for (const row of existingRows) {
    const address = normalizeAddressKey(row.address);
    const listing = listingKey(row);
    if (address) seenAddresses.add(address);
    if (listing) seenListings.add(listing);
  }
  return { seenAddresses, seenListings };
}

function isDuplicateAndMark(row, state) {
  const address = normalizeAddressKey(row.address);
  const listing = listingKey(row);
  const duplicate = !address || state.seenAddresses.has(address) || (listing && state.seenListings.has(listing));
  if (address) state.seenAddresses.add(address);
  if (listing) state.seenListings.add(listing);
  return duplicate;
}

function parseCsvLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\"") {
      if (quoted && line[index + 1] === "\"") {
        cell += "\"";
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

function parseCsv(text) {
  const rows = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    current += char;
    if (char === "\"") {
      if (quoted && text[index + 1] === "\"") {
        current += text[index + 1];
        index += 1;
      } else {
        quoted = !quoted;
      }
    }
    if ((char === "\n" || char === "\r") && !quoted) {
      const line = current.replace(/\r?\n$/, "");
      if (line) rows.push(parseCsvLine(line));
      current = "";
      if (char === "\r" && text[index + 1] === "\n") index += 1;
    }
  }
  if (current.trim()) rows.push(parseCsvLine(current));
  return rows;
}

export function rowsFromExistingZillowCsv(csvPath) {
  const resolved = path.resolve(process.cwd(), csvPath || "");
  if (!csvPath || !fs.existsSync(resolved)) return [];
  const parsed = parseCsv(fs.readFileSync(resolved, "utf8").replace(/^\uFEFF/, ""));
  if (parsed.length < 2) return [];
  const headers = parsed[0];
  return parsed.slice(1).map((row) => {
    const object = Object.fromEntries(headers.map((header, index) => [header, row[index] || ""]));
    return {
      address: pick(object["address/streetAddress"], object.streetAddress, object.abbreviatedAddress, object.addressOrUrlFromInput),
      city: pick(object["address/city"], object.city),
      state: pick(object["address/state"], object.state),
      zip: pick(object["address/zipcode"], object.zipcode, object["adTargets/zip"]),
      listing_url: normalizeListingUrl({
        hdpUrl: pick(object.hdpUrl, object.bdpUrl, object.postingUrl),
        zpid: object.zpid,
      }),
    };
  }).filter((row) => row.address || row.listing_url);
}

function inRange(value, min, max) {
  const numeric = Number(digits(value));
  if (!numeric) return true;
  if (min && numeric < min) return false;
  if (max && numeric > max) return false;
  return true;
}

function matchesSlice(row, slice) {
  return inRange(row.price, slice.minPrice, slice.maxPrice)
    && inRange(row.beds, slice.minBeds, slice.maxBeds);
}

function everyNth(values, limit) {
  if (values.length <= limit) return values;
  const step = values.length / limit;
  return Array.from({ length: limit }, (_, index) => values[Math.floor(index * step)]);
}

export function buildSearchSlices({ city = "Austin", state = "TX", target = 2000, limitPerQuery = 50, maxQueries = 0 } = {}) {
  const estimatedQueries = Math.max(12, Math.ceil(target / Math.max(1, Math.floor(limitPerQuery * 0.45))));
  const zipCount = Math.min(AUSTIN_ZIPS.length, Math.max(8, Math.ceil(estimatedQueries / 3)));
  const zips = everyNth(AUSTIN_ZIPS, zipCount);
  const slices = [];
  for (const listing of LISTING_TYPES) {
    for (const propertyType of PROPERTY_TYPES) {
      slices.push({
        city,
        state,
        zip: "",
        location: `${city}, ${state}`,
        listingType: listing.actorValue,
        listingLabel: listing.label,
        propertyType: propertyType.actorValue,
        propertyTypeLabel: propertyType.label,
        minPrice: 0,
        maxPrice: 0,
        minBeds: 0,
        maxBeds: 0,
        label: `${listing.label}/${propertyType.label}/citywide`,
      });
    }
  }
  for (const priceBand of PRICE_BANDS) {
    for (const bedBand of BED_BANDS) {
      for (const listing of LISTING_TYPES) {
        for (const propertyType of PROPERTY_TYPES) {
          const zip = zips[slices.length % zips.length];
          slices.push({
            city,
            state,
            zip,
            location: `${zip}, ${state}`,
            listingType: listing.actorValue,
            listingLabel: listing.label,
            propertyType: propertyType.actorValue,
            propertyTypeLabel: propertyType.label,
            minPrice: priceBand.minPrice || 0,
            maxPrice: priceBand.maxPrice || 0,
            minBeds: bedBand.minBeds || 0,
            maxBeds: bedBand.maxBeds || 0,
            label: `${listing.label}/${propertyType.label}/${priceBand.label}/${bedBand.label}/${zip}`,
          });
        }
      }
    }
  }
  const capped = maxQueries ? slices.slice(0, maxQueries) : slices;
  return capped;
}

export function buildActorPayload(slice, limitPerQuery) {
  const payload = {
    country: "United States",
    location: slice.location,
    listing_type: slice.listingType,
    max_results: limitPerQuery,
    property_type: slice.propertyType,
  };
  if (process.env.APIFY_ZILLOW_SEARCH_EXTRA_JSON) {
    return { ...payload, ...JSON.parse(process.env.APIFY_ZILLOW_SEARCH_EXTRA_JSON) };
  }
  return payload;
}

function estimateCost({ target, plannedQueries, limitPerQuery }) {
  const resultCost = Number(process.env.APIFY_ZILLOW_RESULT_COST || DEFAULT_RESULT_COST);
  const runCost = Number(process.env.APIFY_ZILLOW_RUN_COST || DEFAULT_RUN_COST);
  const resultBased = target * resultCost;
  const runBased = plannedQueries * runCost;
  const highResultCount = plannedQueries * limitPerQuery * resultCost;
  return {
    result_cost: resultCost,
    run_cost: runCost,
    target_estimate: Number((resultBased + runBased).toFixed(2)),
    high_fetch_estimate: Number((highResultCount + runBased).toFixed(2)),
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8"));
}

async function sheetsClient() {
  const credentials = readJson(process.env.GMAIL_CREDENTIALS_PATH || "credentials.json");
  const token = readJson(process.env.GMAIL_TOKEN_PATH || "token.json");
  const app = credentials.installed || credentials.web;
  const auth = new google.auth.OAuth2(app.client_id, app.client_secret, app.redirect_uris?.[0]);
  auth.setCredentials(token);
  return google.sheets({ version: "v4", auth });
}

async function readExistingProperties(sheets, spreadsheetId) {
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${PROPERTIES_TAB}!A:ZZ`,
  });
  const rows = result.data.values || [];
  if (!rows.length) return [];
  const headers = rows[0];
  return rows.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] || ""])));
}

async function readExistingDatabaseProperties() {
  if (!process.env.DATABASE_URL) {
    return [];
  }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
  });
  try {
    const result = await pool.query(
      `select address, listing_url
         from properties
        where client_id = $1`,
      [process.env.CLIENT_ID || "default"],
    );
    return result.rows.map((row) => ({
      address: row.address || "",
      listing_url: row.listing_url || "",
    }));
  } finally {
    await pool.end();
  }
}

async function appendProperties(sheets, spreadsheetId, rows) {
  if (!rows.length) return 0;
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${PROPERTIES_TAB}!A:ZZ`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: rows.map((row) => PROPERTIES_HEADERS.map((header) => row[header] || "")),
    },
  });
  return rows.length;
}

async function runApifyActor({ actor, token, payload, timeoutSeconds }) {
  const url = `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&timeout=${timeoutSeconds}&memory=1024`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Apify ${actor} failed (${response.status}): ${text.slice(0, 500)}`);
  }
  const parsed = JSON.parse(text || "[]");
  return Array.isArray(parsed) ? parsed : [];
}

function isTransientApifyError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /\b(502|503|504|TIMED-OUT|timeout|run-failed|Bad Gateway)\b/i.test(message);
}

function isHardLimitApifyError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /Monthly usage hard limit exceeded|actor-disabled|platform-feature-disabled/i.test(message);
}

async function runApifyActorWithRetry({ actor, token, payload, timeoutSeconds, retries, retryBaseMs }) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await runApifyActor({ actor, token, payload, timeoutSeconds });
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !isTransientApifyError(error)) break;
      const delay = retryBaseMs * (attempt + 1);
      console.error(`Transient Apify failure; retrying in ${delay}ms (${attempt + 1}/${retries}): ${error instanceof Error ? error.message : error}`);
      if (delay) await sleep(delay);
    }
  }
  throw lastError;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function missingRequiredFields(rows) {
  const fields = ["address", "city", "state", "listing_url"];
  const counts = Object.fromEntries(fields.map((field) => [field, 0]));
  for (const row of rows) {
    for (const field of fields) {
      if (!clean(row[field])) counts[field] += 1;
    }
  }
  return counts;
}

function compactSample(row) {
  return Object.fromEntries(PROPERTIES_HEADERS.filter((header) => clean(row[header])).map((header) => [header, row[header]]));
}

function printStrategy(args, slices) {
  const cost = estimateCost({ target: args.target, plannedQueries: slices.length, limitPerQuery: args.limitPerQuery });
  const firstPayloads = slices.slice(0, 6).map((slice) => ({
    label: slice.label,
    actor: args.actor,
    payload: buildActorPayload(slice, args.limitPerQuery),
  }));
  console.log(JSON.stringify({
    mode: args.dryRun ? "dry_run" : args.planOnly ? "plan_only" : "live_write",
    actor: args.actor,
    target_new_properties: args.target,
    planned_queries: slices.length,
    limit_per_query: args.limitPerQuery,
    strategy: {
      location_scope: `${args.city}, ${args.state}`,
      zip_rotation: "Austin ZIPs, spread across slices",
      listing_types: LISTING_TYPES.map((item) => item.actorValue),
      property_types: PROPERTY_TYPES.map((item) => item.actorValue),
      residential_broad_note: "The actor does not expose separate multi-family/manufactured filters; residential slices keep those rows when Zillow returns them.",
      price_bands: PRICE_BANDS,
      bed_bands: BED_BANDS,
      dedupe: ["normalized address", "listing URL", "Zillow zpid"],
      writes: args.dryRun || args.planOnly ? "none" : "append Google Sheets, optionally npm run sync:sheets",
    },
    estimated_apify_cost_usd: cost,
    first_payloads: firstPayloads,
  }, null, 2));
}

async function syncSheetsToDatabase() {
  await new Promise((resolve, reject) => {
    const child = spawn("npm", ["run", "sync:sheets"], { stdio: "inherit", shell: false });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`npm run sync:sheets exited ${code}`)));
  });
}

async function fetchApifyJson(url) {
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Apify read failed (${response.status}): ${text.slice(0, 500)}`);
  }
  return JSON.parse(text || "{}");
}

async function recoverApifyRunItems({ actor, token, since, runLimit }) {
  const sinceMs = Date.parse(since);
  if (!Number.isFinite(sinceMs)) throw new Error(`Invalid --from-apify-runs-since value: ${since}`);
  const runsUrl = `https://api.apify.com/v2/acts/${actor}/runs?token=${encodeURIComponent(token)}&limit=${runLimit}&desc=1`;
  const runsPayload = await fetchApifyJson(runsUrl);
  const runs = (runsPayload.data?.items || [])
    .filter((run) => run.status === "SUCCEEDED" && run.defaultDatasetId && Date.parse(run.startedAt) >= sinceMs)
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  const batches = [];
  for (const run of runs) {
    const itemsUrl = `https://api.apify.com/v2/datasets/${run.defaultDatasetId}/items?token=${encodeURIComponent(token)}&clean=true`;
    const items = await fetchApifyJson(itemsUrl);
    batches.push({
      label: `recovered/${run.id}/${run.startedAt}`,
      runId: run.id,
      datasetId: run.defaultDatasetId,
      items: Array.isArray(items) ? items : [],
    });
  }
  return batches;
}

function writeJsonFile(filePath, payload) {
  if (!filePath) return;
  const resolved = path.resolve(process.cwd(), filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(payload, null, 2)}\n`);
}

export async function runImport(rawArgs = process.argv.slice(2)) {
  loadDotenv();
  const args = parseArgs(rawArgs);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }

  const slices = buildSearchSlices(args);
  printStrategy(args, slices);
  if (args.planOnly) {
    return { planOnly: true, plannedQueries: slices.length };
  }

  const token = process.env.APIFY_TOKEN || "";
  if (!token) throw new Error("APIFY_TOKEN is required unless --plan-only is used");

  const spreadsheetId = process.env.GOOGLE_SHEET_ID || "";
  if (!spreadsheetId) throw new Error("GOOGLE_SHEET_ID is required");
  const sheets = await sheetsClient();
  const [sheetRows, databaseRows] = await Promise.all([
    readExistingProperties(sheets, spreadsheetId),
    readExistingDatabaseProperties().catch((error) => {
      console.error(`Database duplicate index skipped: ${error instanceof Error ? error.message : error}`);
      return [];
    }),
  ]);
  const csvRows = rowsFromExistingZillowCsv(args.existingCsv);
  const existingRows = [...sheetRows, ...databaseRows, ...csvRows];
  console.log(JSON.stringify({
    duplicate_index: {
      sheets: sheetRows.length,
      neon: databaseRows.length,
      existing_zillow_csv: csvRows.length,
      total_rows_indexed: existingRows.length,
    },
  }, null, 2));

  const fetched = [];
  const normalized = [];
  const candidateRows = [];
  const duplicateRows = [];
  const dedupeState = buildDedupeState(existingRows);
  const perSlice = [];

  const processRows = (items, sliceLabel, slice = {}) => {
    fetched.push(...items);
    const rows = items.map((item) => normalizeApifyItem(item, slice)).filter((row) => row.address);
    normalized.push(...rows);
    for (const row of rows) {
      if (isDuplicateAndMark(row, dedupeState)) duplicateRows.push(row);
      else if (candidateRows.length < args.target) candidateRows.push(row);
    }
    perSlice.push({ label: sliceLabel, fetched: items.length, normalized: rows.length });
    console.log(`Progress: fetched=${fetched.length} normalized=${normalized.length} candidates=${candidateRows.length} duplicates=${duplicateRows.length} current_slice=${items.length}/${rows.length}`);
  };

  if (args.fromApifyRunsSince) {
    const batches = await recoverApifyRunItems({
      actor: args.actor,
      token,
      since: args.fromApifyRunsSince,
      runLimit: args.runLimit,
    });
    console.log(`Recovered ${batches.length} successful Apify run dataset(s) since ${args.fromApifyRunsSince}`);
    for (const batch of batches) {
      if (candidateRows.length >= args.target) break;
      processRows(batch.items, batch.label, { city: args.city, state: args.state });
    }
  } else {
    let stoppedReason = "";
    for (const slice of slices) {
    if (candidateRows.length >= args.target) break;
    const payload = buildActorPayload(slice, args.limitPerQuery);
    console.log(`Apify search ${perSlice.length + 1}/${slices.length}: ${slice.label}`);
    let items = [];
    try {
      items = await runApifyActorWithRetry({
        actor: args.actor,
        token,
        payload,
        timeoutSeconds: args.timeoutSeconds,
        retries: args.retries,
        retryBaseMs: args.retryBaseMs,
      });
    } catch (error) {
      if (isHardLimitApifyError(error)) {
        stoppedReason = error instanceof Error ? error.message : String(error);
        perSlice.push({ label: slice.label, fetched: 0, normalized: 0, error: stoppedReason });
        console.error(`Stopping Apify searches: ${stoppedReason}`);
        break;
      }
      perSlice.push({ label: slice.label, fetched: 0, normalized: 0, error: error instanceof Error ? error.message : String(error) });
      console.error(`Slice failed: ${slice.label}: ${error instanceof Error ? error.message : error}`);
      continue;
    }
    processRows(items, slice.label, slice);
    if (args.sleepMs) await sleep(args.sleepMs);
    }
    if (stoppedReason) {
      perSlice.stoppedReason = stoppedReason;
    }
  }

  const toAppend = candidateRows.slice(0, args.target);
  let appended = 0;
  let upserted = 0;
  if (!args.dryRun) {
    appended = await appendProperties(sheets, spreadsheetId, toAppend);
    if (args.syncDb) {
      await syncSheetsToDatabase();
      upserted = appended;
    }
  }

  const report = {
    city: args.city,
    state: args.state,
    dry_run: args.dryRun,
    fetched_count: fetched.length,
    normalized_count: normalized.length,
    existing_sheet_count: sheetRows.length,
    existing_neon_count: databaseRows.length,
    existing_zillow_csv_count: csvRows.length,
    existing_duplicate_index_count: existingRows.length,
    duplicate_count: duplicateRows.length + Math.max(0, candidateRows.length - toAppend.length),
    appended_to_sheets_count: appended,
    upserted_to_neon_count: upserted,
    candidate_new_count: toAppend.length,
    missing_required_fields: missingRequiredFields(toAppend),
    sample_rows: toAppend.slice(0, 5).map(compactSample),
    per_slice: perSlice,
  };
  writeJsonFile(args.reportPath, { ...report, candidate_rows: toAppend });
  console.log(JSON.stringify(report, null, 2));
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runImport().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
