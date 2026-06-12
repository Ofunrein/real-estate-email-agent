import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import pg from "pg";
import { google } from "googleapis";

const PROPERTIES_HEADERS = [
  "address", "price", "beds", "baths", "city", "state", "zip", "description",
  "neighborhood", "property_type", "features", "days_on_market", "photo_url",
  "sqft", "year_built", "status", "listing_url", "agent_name", "agent_email",
];
const CORE = [
  "year_built", "photo_url", "sqft", "description", "neighborhood",
  "property_type", "features", "days_on_market",
];

function loadDotenv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  }
  if (!process.env.DATABASE_URL && process.env.DATABASE_URL_NEON_DISABLED) {
    process.env.DATABASE_URL = process.env.DATABASE_URL_NEON_DISABLED;
  }
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

function rowToObject(headers, row) {
  const padded = [...row, ...Array(Math.max(0, headers.length - row.length)).fill("")];
  return Object.fromEntries(headers.map((header, index) => [header, padded[index] || ""]));
}

function missingCore(row) {
  return CORE.filter((field) => !String(row[field] || "").trim());
}

loadDotenv();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
});
const clientId = process.env.CLIENT_ID || "default";
const countResult = await pool.query(`select count(*)::int as total from properties where client_id = $1`, [clientId]);
const total = countResult.rows[0]?.total || 0;
const batchSize = 100;
const neonRows = [];
for (let offset = 0; offset < total; offset += batchSize) {
  const neonRes = await pool.query(
    `select ${PROPERTIES_HEADERS.join(", ")} from properties where client_id = $1 order by address asc limit $2 offset $3`,
    [clientId, batchSize, offset],
  );
  neonRows.push(...neonRes.rows.map((row) =>
    Object.fromEntries(PROPERTIES_HEADERS.map((header) => [header, row[header] == null ? "" : String(row[header])])),
  ));
}
await pool.end();

const sheets = await sheetsClient();
const sheetRes = await sheets.spreadsheets.values.get({
  spreadsheetId: process.env.GOOGLE_SHEET_ID,
  range: "properties!A:ZZ",
});
const raw = sheetRes.data.values || [];
const sheetHeaders = raw[0] || [];
const sheetRows = raw.slice(1).map((row) => rowToObject(sheetHeaders.length ? sheetHeaders : PROPERTIES_HEADERS, row));

const neonByAddr = new Map(neonRows.map((row) => [(row.address || "").trim().toLowerCase(), row]));
const sheetByAddr = new Map(sheetRows.map((row) => [(row.address || "").trim().toLowerCase(), row]));

const fieldGaps = {};
for (const [addr, neon] of neonByAddr) {
  const sheet = sheetByAddr.get(addr);
  if (!sheet) continue;
  for (const header of PROPERTIES_HEADERS) {
    const neonValue = String(neon[header] || "").trim();
    const sheetValue = String(sheet[header] || "").trim();
    if (neonValue && !sheetValue) {
      fieldGaps[header] = (fieldGaps[header] || 0) + 1;
    }
  }
}

console.log(JSON.stringify({
  neon_count: neonRows.length,
  sheet_count: sheetRows.length,
  sheet_headers: sheetHeaders,
  missing_headers_in_sheet: PROPERTIES_HEADERS.filter((header) => !sheetHeaders.includes(header)),
  extra_headers_in_sheet: sheetHeaders.filter((header) => !PROPERTIES_HEADERS.includes(header)),
  neon_only: [...neonByAddr.keys()].filter((addr) => !sheetByAddr.has(addr)).length,
  sheet_only: [...sheetByAddr.keys()].filter((addr) => !neonByAddr.has(addr)).length,
  neon_missing_core: neonRows.filter((row) => missingCore(row).length).length,
  sheet_missing_core: sheetRows.filter((row) => missingCore(row).length).length,
  neon_has_sheet_empty: fieldGaps,
  sample: [...neonByAddr.entries()].slice(0, 5).map(([, neon]) => {
    const sheet = sheetByAddr.get((neon.address || "").trim().toLowerCase()) || {};
    return {
      address: neon.address,
      neon_year_built: neon.year_built,
      sheet_year_built: sheet.year_built,
      neon_photo: Boolean(neon.photo_url),
      sheet_photo: Boolean(sheet.photo_url),
      neon_sqft: neon.sqft,
      sheet_sqft: sheet.sqft,
    };
  }),
}, null, 2));
