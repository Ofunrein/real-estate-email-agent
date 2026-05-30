import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import pg from "pg";
import { google } from "googleapis";

const { Pool } = pg;

const LEAD_MEMORY_TAB = "lead_memory";
const CONVERSATION_EVENTS_TAB = "conversation_events";
const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2023-02-21";

function parseArgs(argv) {
  const flags = new Set(argv.slice(2));
  return {
    live: flags.has("--live"),
    force: flags.has("--force"),
    unsafeExternalSend: flags.has("--unsafe-external-send"),
    limit: readIntArg(argv, "--limit"),
    messageType: readStringArg(argv, "--message-type") || process.env.GHL_MESSAGE_TYPE || "InternalComment",
  };
}

function readIntArg(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1 || index + 1 >= argv.length) {
    return 0;
  }
  return Number.parseInt(argv[index + 1], 10) || 0;
}

function readStringArg(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1 || index + 1 >= argv.length) {
    return "";
  }
  return argv[index + 1];
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

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function requiredAnyEnv(...names) {
  for (const name of names) {
    if (process.env[name]) {
      return process.env[name];
    }
  }
  throw new Error(`${names.join(" or ")} is required`);
}

function optionalEnv(name, fallback = "") {
  return process.env[name] || fallback;
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

function databaseEnabled() {
  return Boolean(process.env.DATABASE_URL);
}

function getPool() {
  return new Pool({
    connectionString: requiredEnv("DATABASE_URL"),
    ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
  });
}

async function ensureSyncTable(pool) {
  await pool.query(`
    create table if not exists ghl_message_sync (
      id bigserial primary key,
      client_id text not null,
      event_hash text not null,
      ghl_contact_id text default '',
      ghl_message_id text default '',
      ghl_conversation_id text default '',
      sync_mode text not null default 'dry-run',
      synced_at timestamptz not null default now(),
      unique (client_id, event_hash)
    )
  `);
}

async function loadFromDatabase(pool, clientId) {
  const [leadResult, eventResult] = await Promise.all([
    pool.query(
      `select *
         from lead_memory
        where client_id = $1
        order by updated_at desc`,
      [clientId],
    ),
    pool.query(
      `select *
         from conversation_events
        where client_id = $1
        order by id asc`,
      [clientId],
    ),
  ]);
  return {
    leads: leadResult.rows,
    events: eventResult.rows,
  };
}

async function loadFromSheets() {
  const sheets = await sheetsClient();
  const spreadsheetId = requiredEnv("GOOGLE_SHEET_ID");
  const [leads, events] = await Promise.all([
    readSheet(sheets, spreadsheetId, LEAD_MEMORY_TAB),
    readSheet(sheets, spreadsheetId, CONVERSATION_EVENTS_TAB),
  ]);
  return { leads, events };
}

function normalizePhone(value) {
  return String(value || "").replace(/[^\d+]/g, "");
}

function normalizeLower(value) {
  return String(value || "").trim().toLowerCase();
}

function indexLeads(leads) {
  const byEmail = new Map();
  const byPhone = new Map();
  const byName = new Map();
  for (const lead of leads) {
    const email = normalizeLower(lead.email);
    const phone = normalizePhone(lead.phone);
    const name = normalizeLower(lead.full_name);
    if (email && !byEmail.has(email)) byEmail.set(email, lead);
    if (phone && !byPhone.has(phone)) byPhone.set(phone, lead);
    if (name && !byName.has(name)) byName.set(name, lead);
  }
  return { byEmail, byPhone, byName };
}

function leadForEvent(indexes, event) {
  const email = normalizeLower(event.email);
  const phone = normalizePhone(event.phone);
  const name = normalizeLower(event.full_name);
  return indexes.byEmail.get(email) || indexes.byPhone.get(phone) || indexes.byName.get(name) || null;
}

function eventHash(clientId, event) {
  return crypto
    .createHash("sha256")
    .update(
      [
        clientId,
        event.event_at || "",
        event.channel || "",
        event.direction || "",
        event.email || "",
        event.phone || "",
        event.thread_ref || "",
        event.event_type || "",
        event.message_text || "",
      ].join("|"),
    )
    .digest("hex");
}

function buildCommentBody(event) {
  const lines = [
    `Imported ${event.direction || "event"} ${event.channel || "message"} from Lumenosis Agent OS`,
    event.full_name ? `Lead: ${event.full_name}` : "",
    event.email ? `Email: ${event.email}` : "",
    event.phone ? `Phone: ${event.phone}` : "",
    event.thread_ref ? `Thread: ${event.thread_ref}` : "",
    event.event_at ? `Occurred at: ${event.event_at}` : "",
    event.agent_name ? `Agent: ${event.agent_name}` : "",
    event.summary ? `Summary: ${event.summary}` : "",
    event.message_text ? `Message: ${event.message_text}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

async function ghlRequest(token, pathname, method, body) {
  const response = await fetch(`${GHL_API_BASE}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Version: GHL_VERSION,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${method} ${pathname} failed: ${response.status} ${text}`);
  }
  return response.json();
}

async function upsertGhlContact(token, locationId, lead, event) {
  const fullName = event.full_name || lead?.full_name || "";
  const [firstName, ...rest] = fullName.split(/\s+/).filter(Boolean);
  const lastName = rest.join(" ");
  const payload = {
    locationId,
    firstName: firstName || undefined,
    lastName: lastName || undefined,
    name: fullName || undefined,
    email: event.email || lead?.email || undefined,
    phone: event.phone || lead?.phone || undefined,
    source: "lumenosis_agent_os",
    tags: [optionalEnv("GHL_CONTACT_TAG", "lumenosis-agent-os")],
  };
  const result = await ghlRequest(token, "/contacts/upsert", "POST", payload);
  return result.contact;
}

async function postGhlMessage(token, locationId, contactId, event, args) {
  const messageType = args.messageType;
  if (messageType !== "InternalComment" && !args.unsafeExternalSend) {
    throw new Error(
      `Refusing to send message type ${messageType} without --unsafe-external-send. Use InternalComment for safe thread mirroring.`,
    );
  }
  const payload = {
    locationId,
    contactId,
    type: messageType,
    message: buildCommentBody(event),
  };
  return ghlRequest(token, "/conversations/messages", "POST", payload);
}

async function readExistingSyncHashes(pool, clientId) {
  const result = await pool.query(
    `select event_hash
       from ghl_message_sync
      where client_id = $1`,
    [clientId],
  );
  return new Set(result.rows.map((row) => row.event_hash));
}

async function writeSyncRow(pool, clientId, hash, contactId, messageId, conversationId, syncMode) {
  await pool.query(
    `insert into ghl_message_sync (
       client_id, event_hash, ghl_contact_id, ghl_message_id, ghl_conversation_id, sync_mode
     )
     values ($1, $2, $3, $4, $5, $6)
     on conflict (client_id, event_hash) do nothing`,
    [clientId, hash, contactId || "", messageId || "", conversationId || "", syncMode],
  );
}

async function main() {
  loadDotenv();
  const args = parseArgs(process.argv);
  const live = args.live || optionalEnv("GHL_SYNC_MODE", "dry-run") === "live";
  const clientId = optionalEnv("CLIENT_ID", "default");
  const token = requiredAnyEnv("GHL_PRIVATE_INTEGRATION_TOKEN", "GHL_LOCATION_PIT");
  const locationId = requiredEnv("GHL_LOCATION_ID");

  let pool = null;
  let leads = [];
  let events = [];
  let existingHashes = new Set();

  if (databaseEnabled()) {
    pool = getPool();
    await ensureSyncTable(pool);
    ({ leads, events } = await loadFromDatabase(pool, clientId));
    existingHashes = await readExistingSyncHashes(pool, clientId);
  } else {
    ({ leads, events } = await loadFromSheets());
  }

  if (args.limit > 0) {
    events = events.slice(0, args.limit);
  }

  const indexes = indexLeads(leads);
  let considered = 0;
  let skipped = 0;
  let synced = 0;

  for (const event of events) {
    const hash = eventHash(clientId, event);
    if (!args.force && existingHashes.has(hash)) {
      skipped += 1;
      continue;
    }
    considered += 1;
    const lead = leadForEvent(indexes, event);
    const email = normalizeLower(event.email || lead?.email);
    const phone = normalizePhone(event.phone || lead?.phone);

    if (!email && !phone) {
      skipped += 1;
      continue;
    }

    const contact = await upsertGhlContact(token, locationId, lead, event);

    if (!live) {
      if (pool) {
        await writeSyncRow(pool, clientId, hash, contact?.id, "", "", "dry-run");
      }
      synced += 1;
      continue;
    }

    const result = await postGhlMessage(token, locationId, contact.id, event, args);
    if (pool) {
      await writeSyncRow(
        pool,
        clientId,
        hash,
        contact?.id,
        result.messageId || "",
        result.conversationId || "",
        args.messageType,
      );
    }
    synced += 1;
  }

  if (pool) {
    await pool.end();
  }

  console.log(
    JSON.stringify(
      {
        mode: live ? args.messageType : "dry-run",
        clientId,
        locationId,
        considered,
        skipped,
        synced,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
