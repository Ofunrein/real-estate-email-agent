#!/usr/bin/env node
import fs from "node:fs";
import pg from "pg";

const { Pool } = pg;

const EVENT_HEADERS = [
  "event_at",
  "channel",
  "direction",
  "email",
  "phone",
  "full_name",
  "source",
  "thread_ref",
  "agent_name",
  "human_owner",
  "event_type",
  "message_text",
  "summary",
  "transcript_url",
  "recording_url",
  "ai_action",
  "handoff_reason",
  "status",
];

function loadEnv(path = ".env") {
  if (!fs.existsSync(path)) return;
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    process.env[key] = value;
  }
}

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

function normalizePhone(value = "") {
  const cleaned = String(value).trim();
  return cleaned.replace(/^(sms|rcs|whatsapp):/i, "");
}

function isReservedTestPhone(value = "") {
  const digits = normalizePhone(value).replace(/\D/g, "");
  return digits.startsWith("1555123") || digits === "15555550123";
}

function shouldSkipMessage(message) {
  const body = String(message.body || "").trim();
  const status = String(message.status || "").toLowerCase();
  return (
    /^Theo handoff:/i.test(body) ||
    /^Iris handoff:/i.test(body) ||
    status === "failed" ||
    status === "undelivered" ||
    isReservedTestPhone(message.from || "") ||
    isReservedTestPhone(message.to || "")
  );
}

async function fetchMessages({ sid, token, pageSize }) {
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const url = new URL(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`);
  url.searchParams.set("PageSize", String(pageSize));
  const response = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Twilio messages failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  return payload.messages || [];
}

async function eventExists(pool, clientId, row) {
  const result = await pool.query(
    `select id
       from conversation_events
      where client_id = $1
        and event_at = $2
        and channel = $3
        and direction = $4
        and coalesce(phone, '') = $5
        and coalesce(source, '') = $6
        and coalesce(thread_ref, '') = $7
      limit 1`,
    [clientId, row.event_at, row.channel, row.direction, row.phone, row.source, row.thread_ref],
  );
  return Boolean(result.rowCount);
}

async function insertEvent(pool, clientId, row) {
  await pool.query(
    `insert into conversation_events (client_id, ${EVENT_HEADERS.join(", ")})
     values ($1, ${EVENT_HEADERS.map((_, index) => `$${index + 2}`).join(", ")})`,
    [clientId, ...EVENT_HEADERS.map((header) => row[header] || "")],
  );
}

loadEnv();

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioFrom = normalizePhone(process.env.TWILIO_FROM || "");
const clientId = process.env.CLIENT_ID || "default";
const pageSize = Number(argValue("--limit", "100"));
const dryRun = process.argv.includes("--dry-run");

if (!accountSid || !authToken) throw new Error("Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN");
if (!process.env.DATABASE_URL) throw new Error("Missing DATABASE_URL");

const messages = await fetchMessages({ sid: accountSid, token: authToken, pageSize });
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
});

let inserted = 0;
let skipped = 0;

try {
  for (const message of messages) {
    if (shouldSkipMessage(message)) {
      skipped += 1;
      continue;
    }

    const from = normalizePhone(message.from || "");
    const to = normalizePhone(message.to || "");
    const inbound = message.direction === "inbound";
    const leadPhone = inbound ? from : to === twilioFrom ? from : to;
    if (!leadPhone || leadPhone === twilioFrom) {
      skipped += 1;
      continue;
    }

    const row = {
      event_at: message.date_sent || message.date_created || "",
      channel: "sms",
      direction: inbound ? "inbound" : "outbound",
      phone: leadPhone,
      source: `twilio:${message.sid}`,
      thread_ref: `sms:${leadPhone}`,
      agent_name: inbound ? "" : "Iris",
      event_type: inbound ? "sms_received" : "sms_sent",
      message_text: message.body || "",
      summary: inbound ? "Inbound SMS received." : "Outbound SMS sent.",
      ai_action: inbound ? "sms_received" : "sms_sent",
      status: message.status || "",
    };

    if (dryRun) {
      console.log(JSON.stringify({ dry_run: true, phone: row.phone, direction: row.direction, status: row.status, preview: row.message_text.slice(0, 80) }));
      continue;
    }

    if (await eventExists(pool, clientId, row)) {
      skipped += 1;
      continue;
    }
    await insertEvent(pool, clientId, row);
    inserted += 1;
  }
} finally {
  await pool.end();
}

console.log(JSON.stringify({ ok: true, client_id: clientId, checked: messages.length, inserted, skipped, dry_run: dryRun }));
