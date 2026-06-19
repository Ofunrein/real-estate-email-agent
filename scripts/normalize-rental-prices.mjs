import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { google } from "googleapis";

const PROPERTIES_TAB = "properties";

function loadDotenv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
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

function columnLetter(index) {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const mod = (n - 1) % 26;
    out = String.fromCharCode(65 + mod) + out;
    n = Math.floor((n - mod) / 26);
  }
  return out;
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function hasMonthlySuffix(value) {
  return /\b(per\s*month|monthly)\b|\/\s*(mo|month)\b/i.test(clean(value));
}

function numericPrice(value) {
  const numeric = clean(value).replace(/[^\d.]/g, "");
  const parsed = Number(numeric);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isRentalLike(row, headers, price) {
  if (price >= 1000 && price < 10000) return true;
  if (price <= 0 || price >= 100000) return false;
  const type = clean(row[headers.indexOf("property_type")]).toLowerCase();
  const status = clean(row[headers.indexOf("status")]).toLowerCase();
  return /\b(apartment|condo|rental|lease|for rent)\b/.test(`${type} ${status}`);
}

function appendMonthly(value) {
  const raw = clean(value);
  if (!raw || hasMonthlySuffix(raw)) return raw;
  return `${raw} per month`;
}

async function main() {
  loadDotenv();
  const spreadsheetId = requiredEnv("GOOGLE_SHEET_ID");
  const sheets = await sheetsClient();
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${PROPERTIES_TAB}!A:ZZ`,
  });
  const values = result.data.values || [];
  if (!values.length) {
    console.log("No properties rows found.");
    return;
  }

  const headers = values[0].map(clean);
  const priceIndex = headers.indexOf("price");
  if (priceIndex < 0) throw new Error("properties sheet is missing price header");

  const updates = [];
  for (let rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex] || [];
    const priceValue = clean(row[priceIndex]);
    const price = numericPrice(priceValue);
    if (!priceValue || hasMonthlySuffix(priceValue) || !isRentalLike(row, headers, price)) continue;
    const next = appendMonthly(priceValue);
    updates.push({
      range: `${PROPERTIES_TAB}!${columnLetter(priceIndex)}${rowIndex + 1}`,
      values: [[next]],
    });
  }

  if (updates.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: "RAW",
        data: updates,
      },
    });
  }

  console.log(`Normalized ${updates.length} rental price cell${updates.length === 1 ? "" : "s"} in ${PROPERTIES_TAB}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
