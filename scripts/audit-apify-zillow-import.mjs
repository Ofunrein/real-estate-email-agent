#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import {
  normalizeApifyItem,
  normalizeAddressKey,
  PROPERTIES_HEADERS,
  rowsFromExistingZillowCsv,
} from "./import-zillow-apify-properties.mjs";

const DEFAULT_ACTOR = "truefetch~zillow-real-estate-listings";
const DEFAULT_EXISTING_CSV = "dataset_zillow-detail-scraper_2026-05-18_18-15-11-332.csv";

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
    since: "2026-06-11T00:00:00.000Z",
    actor: process.env.APIFY_ZILLOW_SEARCH_ACTOR || DEFAULT_ACTOR,
    reportPath: "reports/apify-import-audit-20260611.json",
    importMissing: false,
    syncDb: false,
    existingCsv: process.env.ZILLOW_EXISTING_CSV || DEFAULT_EXISTING_CSV,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === "--since") args.since = next();
    else if (arg === "--actor") args.actor = next();
    else if (arg === "--report-path") args.reportPath = next();
    else if (arg === "--import-missing") args.importMissing = true;
    else if (arg === "--sync-db") args.syncDb = true;
    else if (arg === "--existing-csv") args.existingCsv = next();
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function clean(value) {
  if (value == null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function listingKey(row) {
  const url = clean(row.listing_url).toLowerCase();
  if (url === "https://www.zillow.com" || url === "https://www.zillow.com/") return "";
  const zpid = url.match(/\/(\d+)_zpid\b/)?.[1];
  return zpid ? `zpid:${zpid}` : url ? `url:${url}` : "";
}

function zpidFromItem(item, row) {
  const url = clean(row?.listing_url);
  const fromUrl = url.match(/\/(\d+)_zpid\b/)?.[1];
  if (fromUrl) return fromUrl;
  return clean(item.zpid || item.property_id || item.listing_id);
}

function propertyKeys(row, item = {}) {
  const address = normalizeAddressKey(row.address);
  const listing = listingKey(row);
  const zpid = zpidFromItem(item, row);
  const keys = [];
  if (zpid) keys.push(`zpid:${zpid}`);
  if (listing) keys.push(listing);
  if (address) keys.push(`addr:${address}`);
  return keys;
}

async function fetchApifyJson(url) {
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) throw new Error(`Apify read failed (${response.status}): ${text.slice(0, 500)}`);
  return JSON.parse(text || "{}");
}

async function listAllSuccessfulRuns({ actor, token, sinceMs }) {
  const runs = [];
  let offset = 0;
  const pageSize = 250;
  while (true) {
    const url = `https://api.apify.com/v2/acts/${actor}/runs?token=${encodeURIComponent(token)}&limit=${pageSize}&offset=${offset}&desc=1`;
    const payload = await fetchApifyJson(url);
    const items = payload.data?.items || [];
    if (!items.length) break;
    let pastSince = false;
    for (const run of items) {
      const started = Date.parse(run.startedAt);
      if (!Number.isFinite(started) || started < sinceMs) {
        pastSince = true;
        continue;
      }
      if (run.status === "SUCCEEDED" && run.defaultDatasetId) {
        runs.push(run);
      }
    }
    offset += items.length;
    if (pastSince || items.length < pageSize) break;
  }
  return runs.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
}

async function fetchDatasetItems(datasetId, token) {
  const items = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const url = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${encodeURIComponent(token)}&clean=true&limit=${limit}&offset=${offset}`;
    const batch = await fetchApifyJson(url);
    if (!Array.isArray(batch) || !batch.length) break;
    items.push(...batch);
    if (batch.length < limit) break;
    offset += batch.length;
  }
  return items;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8"));
}

async function sheetsClient() {
  const { google } = await import("googleapis");
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
    range: "properties!A:ZZ",
  });
  const rows = result.data.values || [];
  if (!rows.length) return [];
  const headers = rows[0];
  return rows.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] || ""])));
}

async function readExistingDatabaseProperties() {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
  });
  try {
    const result = await pool.query(
      `select address, listing_url, city, state, zip from properties where client_id = $1`,
      [process.env.CLIENT_ID || "default"],
    );
    return result.rows.map((row) => ({
      address: row.address || "",
      listing_url: row.listing_url || "",
      city: row.city || "",
      state: row.state || "",
      zip: row.zip || "",
    }));
  } finally {
    await pool.end();
  }
}

async function appendProperties(sheets, spreadsheetId, rows) {
  if (!rows.length) return 0;
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "properties!A:ZZ",
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: rows.map((row) => PROPERTIES_HEADERS.map((header) => row[header] || "")),
    },
  });
  return rows.length;
}

async function syncSheetsToDatabase() {
  await new Promise((resolve, reject) => {
    const child = spawn("npm", ["run", "sync:sheets"], { stdio: "inherit", shell: false });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`npm run sync:sheets exited ${code}`))));
  });
}

function buildIndex(rows, label) {
  const byAddress = new Map();
  const byListing = new Map();
  const byZpid = new Map();
  const addressDupes = [];
  const zpidCollisions = [];
  const seenAddress = new Map();
  const seenZpid = new Map();

  for (const row of rows) {
    const address = normalizeAddressKey(row.address);
    const listing = listingKey(row);
    const zpid = listing?.startsWith("zpid:") ? listing.slice(5) : "";

    if (address) {
      if (seenAddress.has(address)) addressDupes.push({ address: row.address, first: seenAddress.get(address), duplicate: label });
      else seenAddress.set(address, row.address);
      byAddress.set(address, row);
    }
    if (listing) byListing.set(listing, row);
    if (zpid) {
      if (seenZpid.has(zpid) && seenZpid.get(zpid) !== row.address) {
        zpidCollisions.push({ zpid, first: seenZpid.get(zpid), second: row.address });
      }
      seenZpid.set(zpid, row.address);
      byZpid.set(zpid, row);
    }
  }
  return { byAddress, byListing, byZpid, addressDupes, zpidCollisions };
}

function isInIndex(row, index) {
  const address = normalizeAddressKey(row.address);
  const listing = listingKey(row);
  const zpid = listing?.startsWith("zpid:") ? listing.slice(5) : "";
  if (address && index.byAddress.has(address)) return true;
  if (listing && index.byListing.has(listing)) return true;
  if (zpid && index.byZpid.has(zpid)) return true;
  return false;
}

function compactRow(row) {
  return {
    address: row.address,
    city: row.city,
    state: row.state,
    zip: row.zip,
    listing_url: row.listing_url,
    price: row.price,
  };
}

async function main() {
  loadDotenv();
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: node scripts/audit-apify-zillow-import.mjs [--since ISO] [--import-missing] [--sync-db]`);
    process.exit(0);
  }

  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN required");
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) throw new Error("GOOGLE_SHEET_ID required");

  const sinceMs = Date.parse(args.since);
  if (!Number.isFinite(sinceMs)) throw new Error(`Invalid --since: ${args.since}`);

  console.log(`Listing Apify runs for ${args.actor} since ${args.since}...`);
  const runs = await listAllSuccessfulRuns({ actor: args.actor, token, sinceMs });
  console.log(`Found ${runs.length} successful runs`);

  const apifyUnion = new Map();
  const runDetails = [];
  let totalRawItems = 0;

  for (const run of runs) {
    const items = await fetchDatasetItems(run.defaultDatasetId, token);
    totalRawItems += items.length;
    let normalizedCount = 0;
    for (const item of items) {
      const row = normalizeApifyItem(item, { city: "Austin", state: "TX" });
      if (!row.address) continue;
      normalizedCount += 1;
      const id = propertyKeys(row, item).find((k) => k.startsWith("zpid:"))
        || propertyKeys(row, item).find((k) => k.startsWith("url:"))
        || propertyKeys(row, item).find((k) => k.startsWith("addr:"));
      if (!id) continue;
      if (!apifyUnion.has(id)) {
        apifyUnion.set(id, { row, runIds: [run.id], itemCount: 1 });
      } else {
        const entry = apifyUnion.get(id);
        entry.itemCount += 1;
        if (!entry.runIds.includes(run.id)) entry.runIds.push(run.id);
      }
    }
    runDetails.push({
      runId: run.id,
      startedAt: run.startedAt,
      datasetId: run.defaultDatasetId,
      rawItems: items.length,
      normalizedItems: normalizedCount,
    });
    process.stdout.write(`  run ${run.id}: ${items.length} raw, ${normalizedCount} normalized\r`);
  }
  console.log("");

  const sheets = await sheetsClient();
  const [sheetRows, dbRows] = await Promise.all([
    readExistingProperties(sheets, spreadsheetId),
    readExistingDatabaseProperties(),
  ]);
  const csvRows = rowsFromExistingZillowCsv(args.existingCsv);

  const sheetsIndex = buildIndex(sheetRows, "sheets");
  const neonIndex = buildIndex(dbRows, "neon");
  const combinedIndex = buildIndex([...sheetRows, ...dbRows, ...csvRows], "combined");

  const apifyRows = [...apifyUnion.values()].map((e) => e.row);
  const missingFromSheets = apifyRows.filter((row) => !isInIndex(row, sheetsIndex));
  const missingFromNeon = apifyRows.filter((row) => !isInIndex(row, neonIndex));
  const missingFromCombined = apifyRows.filter((row) => !isInIndex(row, combinedIndex));

  const apifyKeySet = new Set();
  for (const row of apifyRows) {
    for (const k of propertyKeys(row)) apifyKeySet.add(k);
  }

  const extraInSheets = sheetRows.filter((row) => {
    const keys = propertyKeys(row);
    return keys.length && !keys.some((k) => apifyKeySet.has(k));
  });
  const extraInNeon = dbRows.filter((row) => {
    const keys = propertyKeys(row);
    return keys.length && !keys.some((k) => apifyKeySet.has(k));
  });

  const apifyAddressDupes = [];
  const apifyZpidDupes = [];
  const seenApifyAddr = new Map();
  const seenApifyZpid = new Map();
  for (const row of apifyRows) {
    const addr = normalizeAddressKey(row.address);
    const listing = listingKey(row);
    const zpid = listing?.startsWith("zpid:") ? listing.slice(5) : "";
    if (addr && seenApifyAddr.has(addr)) apifyAddressDupes.push({ address: row.address, listing_url: row.listing_url });
    if (addr) seenApifyAddr.set(addr, row);
    if (zpid && seenApifyZpid.has(zpid)) apifyZpidDupes.push({ zpid, addresses: [seenApifyZpid.get(zpid), row.address] });
    if (zpid) seenApifyZpid.set(zpid, row.address);
  }

  let importedCount = 0;
  let syncedCount = 0;
  if (args.importMissing && missingFromCombined.length) {
    console.log(`Importing ${missingFromCombined.length} missing properties to Sheets...`);
    importedCount = await appendProperties(sheets, spreadsheetId, missingFromCombined);
    if (args.syncDb && importedCount) {
      await syncSheetsToDatabase();
      syncedCount = importedCount;
    }
  }

  const report = {
    audit_at: new Date().toISOString(),
    actor: args.actor,
    since: args.since,
    apify: {
      successful_runs: runs.length,
      total_raw_items: totalRawItems,
      unique_properties: apifyUnion.size,
      unique_normalized_rows: apifyRows.length,
      cross_run_duplicate_addresses: apifyAddressDupes.length,
      cross_run_zpid_collisions: apifyZpidDupes.length,
      runs: runDetails,
    },
    sheets: {
      total_rows: sheetRows.length,
      address_duplicates: sheetsIndex.addressDupes.length,
      zpid_collisions: sheetsIndex.zpidCollisions.length,
    },
    neon: {
      total_rows: dbRows.length,
      address_duplicates: neonIndex.addressDupes.length,
      zpid_collisions: neonIndex.zpidCollisions.length,
    },
    csv_baseline: {
      path: args.existingCsv,
      rows: csvRows.length,
    },
    comparison: {
      missing_from_sheets: missingFromSheets.length,
      missing_from_neon: missingFromNeon.length,
      missing_from_combined: missingFromCombined.length,
      extra_in_sheets_not_in_apify: extraInSheets.length,
      extra_in_neon_not_in_apify: extraInNeon.length,
    },
    import_action: {
      import_missing_requested: args.importMissing,
      appended_to_sheets: importedCount,
      synced_to_neon: syncedCount,
    },
    missing_sample: missingFromCombined.slice(0, 25).map(compactRow),
    extra_in_sheets_sample: extraInSheets.slice(0, 10).map(compactRow),
    recommendation: "",
  };

  if (missingFromCombined.length === 0) {
    report.recommendation = runs.length > 100
      ? "All paid Apify properties are present in Sheets/Neon. Prior recovery used run-limit 100; this audit paginated all runs and found no gaps."
      : "All paid Apify properties are present in Sheets/Neon. No import needed.";
  } else {
    report.recommendation = `Found ${missingFromCombined.length} Apify properties not in combined index. Run with --import-missing --sync-db to recover.`;
  }

  const reportPath = path.resolve(process.cwd(), args.reportPath);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(JSON.stringify({
    apify_runs: runs.length,
    apify_raw_items: totalRawItems,
    apify_unique: apifyUnion.size,
    sheets_total: sheetRows.length,
    neon_total: dbRows.length,
    missing_from_combined: missingFromCombined.length,
    imported: importedCount,
    report: args.reportPath,
    recommendation: report.recommendation,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
