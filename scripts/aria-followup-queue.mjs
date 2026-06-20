// Aria followup queue. Reads leads + their cross-channel events, runs the shared
// cadence, and dials the leads due for a VOICE touch (consent + call-window +
// pacing all enforced by nextTouch).
//
// Run: npm run aria:followup            (dry-run: prints who would be called + why)
//      npm run aria:followup -- --live  (actually places the calls via Vapi)
//      npm run aria:followup -- --limit 5
//
// Requires DATABASE_URL. For --live also VAPI_API_KEY, VAPI_ASSISTANT_ID,
// VAPI_PHONE_NUMBER_ID.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import pg from "pg";

import { resolveClientConfig } from "../lib/clientConfig.ts";
import { evaluateFollowups, selectVoiceFollowups, placeOutboundCall, sendOutboundAttemptSms } from "../lib/outbound.ts";

const { Pool } = pg;

function loadDotenv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

function intArg(name, fallback = 0) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? Number.parseInt(process.argv[i + 1], 10) || fallback : fallback;
}

async function main() {
  loadDotenv();
  const live = process.argv.includes("--live");
  const limit = intArg("--limit", 0);
  const config = resolveClientConfig(process.env);
  const clientId = config.clientId;
  const timezone = process.env.CALENDAR_TIMEZONE || "America/Chicago";
  const nowMs = Date.now();

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
  });

  const [leadRows, eventRows] = await Promise.all([
    pool.query("select * from lead_memory where client_id = $1", [clientId]),
    pool.query("select * from conversation_events where client_id = $1 order by id asc", [clientId]),
  ]);

  // group events by lead identity (phone or email)
  const eventsByPhone = new Map();
  const eventsByEmail = new Map();
  for (const event of eventRows.rows) {
    const phone = String(event.phone || "").replace(/\D/g, "");
    const email = String(event.email || "").toLowerCase();
    if (phone) (eventsByPhone.get(phone) || eventsByPhone.set(phone, []).get(phone)).push(event);
    if (email) (eventsByEmail.get(email) || eventsByEmail.set(email, []).get(email)).push(event);
  }

  const leads = leadRows.rows.map((lead) => {
    const phone = String(lead.phone || "").replace(/\D/g, "");
    const email = String(lead.email || "").toLowerCase();
    const events = [...(eventsByPhone.get(phone) || []), ...(eventsByEmail.get(email) || [])];
    return { lead, events };
  });

  const allDecisions = evaluateFollowups(leads, config.cadence, nowMs, timezone);
  let voiceDue = selectVoiceFollowups(leads, config.cadence, nowMs, timezone);
  if (limit > 0) voiceDue = voiceDue.slice(0, limit);

  console.log(`Cadence over ${leads.length} leads — ${voiceDue.length} due for a voice call now.`);
  for (const { lead, decision } of allDecisions) {
    const who = lead.full_name || lead.phone || lead.email || "lead";
    console.log(`  ${decision.action.padEnd(5)} ${decision.channel || "-"} ${decision.reason}  (${who}, touches=${decision.touchCount})`);
  }

  if (!live) {
    console.log("\nDry run. Re-run with --live to place calls.");
    await pool.end();
    return;
  }

  const outboundConfig = {
    apiKey: process.env.VAPI_API_KEY || "",
    assistantId: process.env.VAPI_ASSISTANT_ID || "",
    phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID || "",
  };

  let placed = 0;
  const voiceCompanyName = config.voiceClientName || config.clientName;
  for (const { lead } of voiceDue) {
    const callReason = lead.property_interest || lead.intent || lead.summary || "";
    const result = await placeOutboundCall(outboundConfig, {
      customerNumber: lead.phone,
      leadName: lead.full_name || "",
      leadEmail: lead.email || "",
      companyName: voiceCompanyName,
      agentName: config.agentNames.voice,
      callReason,
      leadContext: lead.summary || lead.property_interest || lead.intent || "",
      preferredChannel: lead.preferred_channel || "",
      clientId,
      trigger: "followup_queue",
    });
    if (result.ok) {
      placed += 1;
      console.log(`  called ${lead.phone} -> ${result.id}`);
      const sms = await sendOutboundAttemptSms(lead.phone, {
        agentName: config.agentNames.voice,
        companyName: voiceCompanyName,
        context: callReason,
      }).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      console.log(`    sms ${sms.ok ? "sent" : `skipped: ${sms.error || "unknown"}`}`);
    } else {
      console.error(`  failed ${lead.phone}: ${result.error}`);
    }
  }
  console.log(`\nPlaced ${placed}/${voiceDue.length} calls.`);
  await pool.end();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
