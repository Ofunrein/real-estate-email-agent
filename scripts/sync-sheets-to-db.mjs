import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import pg from "pg";
import { google } from "googleapis";

const { Pool } = pg;

const PROPERTIES_TAB = "properties";
const LEAD_MEMORY_TAB = "lead_memory";
const CONVERSATION_EVENTS_TAB = "conversation_events";

const PROPERTIES_HEADERS = [
  "address", "price", "beds", "baths", "city", "state", "zip", "description",
  "neighborhood", "property_type", "features", "days_on_market", "photo_url",
  "sqft", "year_built", "status", "listing_url", "agent_name", "agent_email",
];

const LEAD_MEMORY_HEADERS = [
  "email", "phone", "full_name", "lead_source", "source_detail", "lead_role",
  "intent", "property_interest", "budget", "area", "timeline",
  "preferred_channel", "sms_consent", "call_consent", "last_channel",
  "last_ai_touch_at", "assigned_owner", "handoff_status", "handoff_reason",
  "next_action", "summary",
];

const CONVERSATION_EVENTS_HEADERS = [
  "event_at", "channel", "direction", "email", "phone", "full_name", "source",
  "thread_ref", "agent_name", "human_owner", "event_type", "message_text",
  "summary", "transcript_url", "recording_url", "ai_action",
  "handoff_reason", "status",
];

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

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

async function readSheet(sheets, spreadsheetId, tab) {
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tab}!A:ZZ`,
  });
  const rows = result.data.values || [];
  if (!rows.length) {
    return [];
  }
  return rows.slice(1).map((row) => rowToObject(rows[0], row));
}

async function upsertClient(pool, clientId, clientName, sheetId) {
  await pool.query(
    `insert into clients (id, name, google_sheet_id)
     values ($1, $2, $3)
     on conflict (id) do update set
       name = excluded.name,
       google_sheet_id = excluded.google_sheet_id,
       updated_at = now()`,
    [clientId, clientName, sheetId],
  );
}

async function upsertProperties(pool, clientId, rows) {
  for (const row of rows) {
    if (!row.address) {
      continue;
    }
    const values = PROPERTIES_HEADERS.map((header) => row[header] || "");
    await pool.query(
      `insert into properties (client_id, ${PROPERTIES_HEADERS.join(", ")}, source)
       values ($1, ${PROPERTIES_HEADERS.map((_, index) => `$${index + 2}`).join(", ")}, 'sheets')
       on conflict (client_id, address) do update set
         ${PROPERTIES_HEADERS.filter((header) => header !== "address").map((header) => `${header} = excluded.${header}`).join(", ")},
         source = 'sheets',
         updated_at = now()`,
      [clientId, ...values],
    );
  }
}

async function upsertLeads(pool, clientId, rows) {
  for (const row of rows) {
    const values = LEAD_MEMORY_HEADERS.map((header) => row[header] || "");
    await pool.query(
      `insert into lead_memory (client_id, ${LEAD_MEMORY_HEADERS.join(", ")})
       values ($1, ${LEAD_MEMORY_HEADERS.map((_, index) => `$${index + 2}`).join(", ")})
       on conflict (client_id, email, phone, full_name) do update set
         ${LEAD_MEMORY_HEADERS.filter((header) => !["email", "phone", "full_name"].includes(header)).map((header) => `${header} = excluded.${header}`).join(", ")},
         updated_at = now()`,
      [clientId, ...values],
    );
  }
}

async function appendEvents(pool, clientId, rows) {
  if (!rows.length) {
    return;
  }
  await pool.query("delete from conversation_events where client_id = $1 and source = 'sheets'", [clientId]);
  for (const row of rows) {
    const values = CONVERSATION_EVENTS_HEADERS.map((header) => row[header] || "");
    await pool.query(
      `insert into conversation_events (client_id, ${CONVERSATION_EVENTS_HEADERS.join(", ")})
       values ($1, ${CONVERSATION_EVENTS_HEADERS.map((_, index) => `$${index + 2}`).join(", ")})`,
      [clientId, ...values],
    );
  }
}

async function main() {
  loadDotenv();
  const spreadsheetId = requiredEnv("GOOGLE_SHEET_ID");
  const clientId = process.env.CLIENT_ID || "default";
  const clientName = process.env.CLIENT_NAME || "Default Client";
  const pool = new Pool({
    connectionString: requiredEnv("DATABASE_URL"),
    ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
  });
  const sheets = await sheetsClient();

  const [properties, leads, events] = await Promise.all([
    readSheet(sheets, spreadsheetId, PROPERTIES_TAB),
    readSheet(sheets, spreadsheetId, LEAD_MEMORY_TAB),
    readSheet(sheets, spreadsheetId, CONVERSATION_EVENTS_TAB),
  ]);

  await upsertClient(pool, clientId, clientName, spreadsheetId);
  await upsertProperties(pool, clientId, properties);
  await upsertLeads(pool, clientId, leads);
  await appendEvents(pool, clientId, events);
  await pool.end();

  console.log(`Synced ${properties.length} properties, ${leads.length} leads, ${events.length} events for ${clientId}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
