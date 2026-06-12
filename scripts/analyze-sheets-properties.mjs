import fs from "node:fs";
import path from "node:path";
import process from "node:process";
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
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8"));
}

loadDotenv();

const credentials = readJson(process.env.GMAIL_CREDENTIALS_PATH || "credentials.json");
const token = readJson(process.env.GMAIL_TOKEN_PATH || "token.json");
const app = credentials.installed || credentials.web;
const auth = new google.auth.OAuth2(app.client_id, app.client_secret, app.redirect_uris?.[0]);
auth.setCredentials(token);
const sheets = google.sheets({ version: "v4", auth });

const result = await sheets.spreadsheets.values.get({
  spreadsheetId: process.env.GOOGLE_SHEET_ID,
  range: "properties!A:ZZ",
});
const raw = result.data.values || [];
const headers = raw[0] || [];
const rows = raw.slice(1).map((row) =>
  Object.fromEntries((headers.length ? headers : PROPERTIES_HEADERS).map((header, index) => [header, String(row[index] || "").trim()])),
);

const missingCounts = Object.fromEntries(
  PROPERTIES_HEADERS.map((header) => [header, rows.filter((row) => !row[header]).length]),
);

console.log(JSON.stringify({
  sheet_rows: rows.length,
  headers,
  missing_headers_in_sheet: PROPERTIES_HEADERS.filter((header) => !headers.includes(header)),
  missingCounts,
  coreMissingRows: rows.filter((row) => CORE.some((field) => !row[field])).length,
  sampleMissingYearBuilt: rows.filter((row) => !row.year_built).slice(0, 5).map((row) => row.address),
}, null, 2));
