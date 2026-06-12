import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import pg from "pg";
import { google } from "googleapis";

const { Pool } = pg;

const PROPERTIES_TAB = "properties";
const PROPERTIES_HEADERS = [
  "address", "price", "beds", "baths", "city", "state", "zip", "description",
  "neighborhood", "property_type", "features", "days_on_market", "photo_url",
  "sqft", "year_built", "status", "listing_url", "agent_name", "agent_email",
];

function loadDotenv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
    if (!match || process.env[match[1]]) {
      continue;
    }
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
  if (!process.env.DATABASE_URL && process.env.DATABASE_URL_NEON_DISABLED) {
    process.env.DATABASE_URL = process.env.DATABASE_URL_NEON_DISABLED;
  }
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
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

function backupTabName(existingTabs) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "_");
  let candidate = `${PROPERTIES_TAB}_backup_${stamp}`;
  let suffix = 2;
  while (existingTabs.has(candidate)) {
    candidate = `${PROPERTIES_TAB}_backup_${stamp}_${suffix}`;
    suffix += 1;
  }
  return candidate;
}

async function readExistingPropertiesTab(sheets, spreadsheetId) {
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${PROPERTIES_TAB}!A:ZZ`,
  });
  return result.data.values || [];
}

async function writePropertiesTab(sheets, spreadsheetId, rows) {
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${PROPERTIES_TAB}!A:ZZ`,
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${PROPERTIES_TAB}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: rows },
  });
}

async function readPropertiesFromDatabase(pool, clientId) {
  const countResult = await pool.query(
    `select count(*)::int as total from properties where client_id = $1`,
    [clientId],
  );
  const total = countResult.rows[0]?.total || 0;
  const batchSize = Number(process.env.SYNC_DB_BATCH_SIZE || 100);
  const rows = [];

  for (let offset = 0; offset < total; offset += batchSize) {
    const result = await pool.query(
      `select ${PROPERTIES_HEADERS.join(", ")}
         from properties
        where client_id = $1
        order by address asc
        limit $2 offset $3`,
      [clientId, batchSize, offset],
    );
    rows.push(...result.rows.map((row) =>
      Object.fromEntries(PROPERTIES_HEADERS.map((header) => [header, row[header] == null ? "" : String(row[header])])),
    ));
    console.log(`read batch offset=${offset} size=${result.rows.length} total=${rows.length}/${total}`);
  }

  return rows;
}

async function main() {
  loadDotenv();
  const spreadsheetId = requiredEnv("GOOGLE_SHEET_ID");
  const clientId = process.env.CLIENT_ID || "default";
  const dryRun = process.argv.includes("--dry-run");
  const skipBackup = process.argv.includes("--no-backup");

  const pool = new Pool({
    connectionString: requiredEnv("DATABASE_URL"),
    ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
  });
  const sheets = await sheetsClient();

  const [dbRows, existingRows, meta] = await Promise.all([
    readPropertiesFromDatabase(pool, clientId),
    readExistingPropertiesTab(sheets, spreadsheetId),
    sheets.spreadsheets.get({ spreadsheetId }),
  ]);
  await pool.end();

  const existingTabs = new Set((meta.data.sheets || []).map((sheet) => sheet.properties?.title || ""));
  const sheetValues = [PROPERTIES_HEADERS, ...dbRows.map((row) => PROPERTIES_HEADERS.map((header) => row[header] || ""))];

  if (dryRun) {
    console.log(JSON.stringify({
      mode: "dry-run",
      neon_rows: dbRows.length,
      sheet_rows_before: Math.max(0, existingRows.length - 1),
      sheet_headers_before: existingRows[0] || [],
      would_write_rows: sheetValues.length - 1,
    }, null, 2));
    return;
  }

  let backupTab = null;
  if (!skipBackup && existingRows.length) {
    backupTab = backupTabName(existingTabs);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: backupTab } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${backupTab}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: existingRows },
    });
  }

  await writePropertiesTab(sheets, spreadsheetId, sheetValues);

  console.log(JSON.stringify({
    neon_rows: dbRows.length,
    sheet_rows_before: Math.max(0, existingRows.length - 1),
    sheet_rows_after: dbRows.length,
    backup_tab: backupTab,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
