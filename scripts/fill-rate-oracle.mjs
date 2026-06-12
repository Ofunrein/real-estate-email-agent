import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import pg from "pg";
import { google } from "googleapis";

const REQUIRED = [
  "address", "price", "beds", "baths", "state", "zip", "description",
  "neighborhood", "property_type", "features", "days_on_market", "photo_url",
  "sqft", "year_built", "status", "listing_url",
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
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8"));
}

function rowToObject(headers, row) {
  const padded = [...row, ...Array(Math.max(0, headers.length - row.length)).fill("")];
  return Object.fromEntries(headers.map((header, index) => [header, padded[index] || ""]));
}

function filled(value) {
  return Boolean(String(value || "").trim());
}

function fillRates(rows, label) {
  const total = rows.length;
  const rates = {};
  for (const field of REQUIRED) {
    const count = rows.filter((row) => filled(row[field])).length;
    rates[field] = { filled: count, total, pct: total ? Math.round((count / total) * 1000) / 10 : 0 };
  }
  return { label, total, rates };
}

loadDotenv();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
});
const clientId = process.env.CLIENT_ID || "austin-realty";
const countResult = await pool.query("select count(*)::int as total from properties where client_id = $1", [clientId]);
const total = countResult.rows[0]?.total || 0;
const neonRows = [];
for (let offset = 0; offset < total; offset += 100) {
  const neonRes = await pool.query(
    `select ${REQUIRED.join(", ")} from properties where client_id = $1 order by address asc limit $2 offset $3`,
    [clientId, 100, offset],
  );
  neonRows.push(...neonRes.rows.map((row) =>
    Object.fromEntries(REQUIRED.map((header) => [header, row[header] == null ? "" : String(row[header])])),
  ));
}
await pool.end();

const credentials = readJson(process.env.GMAIL_CREDENTIALS_PATH || "credentials.json");
const token = readJson(process.env.GMAIL_TOKEN_PATH || "token.json");
const app = credentials.installed || credentials.web;
const auth = new google.auth.OAuth2(app.client_id, app.client_secret, app.redirect_uris?.[0]);
auth.setCredentials(token);
const sheets = google.sheets({ version: "v4", auth });
const sheetRes = await sheets.spreadsheets.values.get({
  spreadsheetId: process.env.GOOGLE_SHEET_ID,
  range: "properties!A:ZZ",
});
const raw = sheetRes.data.values || [];
const sheetHeaders = raw[0] || [];
const sheetRows = raw.slice(1).map((row) => rowToObject(sheetHeaders.length ? sheetHeaders : REQUIRED, row));

const neonByAddr = new Map(neonRows.map((row) => [(row.address || "").trim().toLowerCase(), row]));
const sheetByAddr = new Map(sheetRows.map((row) => [(row.address || "").trim().toLowerCase(), row]));

const neonHasSheetEmpty = {};
for (const [addr, neon] of neonByAddr) {
  const sheet = sheetByAddr.get(addr);
  if (!sheet) continue;
  for (const field of REQUIRED) {
    if (filled(neon[field]) && !filled(sheet[field])) {
      neonHasSheetEmpty[field] = (neonHasSheetEmpty[field] || 0) + 1;
    }
  }
}

const neonHasSheetEmptyTotal = Object.values(neonHasSheetEmpty).reduce((sum, count) => sum + count, 0);

console.log(JSON.stringify({
  neon_count: neonRows.length,
  sheet_count: sheetRows.length,
  fill_rates: {
    neon: fillRates(neonRows, "neon"),
    properties: fillRates(sheetRows, "properties"),
  },
  neon_has_sheet_empty: neonHasSheetEmpty,
  neon_has_sheet_empty_total: neonHasSheetEmptyTotal,
  oracle_pass: neonHasSheetEmptyTotal === 0,
}, null, 2));
