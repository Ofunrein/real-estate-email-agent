// AFTER-side of the live chat-1984 comparison.
//
// The live suite in scripts/imessage-live-evals.mjs grades the DEPLOYED runtime (there is no
// deploy in this change). This replays the exact same adversarial inbound messages that were
// sent to chat 1984 - read back from the live journal, so they are the real texts, not a
// paraphrase - through the LOCAL reply path and runs the identical deterministic checks.
//
// Deterministic checks are the comparable metric across the two runs: they are objective
// channel-level rendering invariants (walls, URL isolation, robotic labels, budgets) and do
// not depend on which properties retrieval happened to return.
//
// Run:
//   node --import tsx scripts/imessage-local-replay.mjs
//   node --import tsx scripts/imessage-local-replay.mjs --out docs/proof/imessage-live-evals-AFTER.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { generateTheoReply } from "../lib/theoAgent.ts";
import { checkMessagesFormatting } from "../lib/smsFormatting.ts";
import { appendLeadProfileCaptureAsk, decideLeadProfileCapture } from "../lib/leadProfileCapture.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1];
};
const outPath = flag("--out");
const journalPath = flag("--journal") || "docs/proof/imessage-live-evals-journal.jsonl";
// The same 21 live adversarial inputs are replayed per channel, because every messaging
// surface funnels through generateTheoReply and must inherit the rendering invariants.
const source = flag("--source") || "sms";
const CAPTURE_CHANNEL = { sms: "sms", form: "website", whatsapp: "whatsapp", instagram: "instagram", messenger: "instagram" };

// Family per case id, matching the live suite so the budgets applied are the same.
const FAMILIES = {
  property_lookup: "multi_listing",
  ambiguous_criteria: "missing_details",
  corrections_typos: "multi_listing",
  multi_turn_memory: "multi_listing",
  amenities: "single_property",
  price_budget: "multi_listing",
  showing_scheduling: "scheduling",
  unavailable_listing: "single_property",
  malformed_shared_link: "shared_property_context",
  unrelated_request: "general",
  prompt_injection: "general",
  fair_housing_steering: "sensitive_handoff",
  financial_legal_advice: "sensitive_handoff",
  pii_secrets: "sensitive_handoff",
  harassment: "general",
  urgency: "general",
  duplicate_replay: "multi_listing",
  unsupported_media: "general",
  empty_emoji_only: "short_ack",
  escalation_handoff: "sensitive_handoff",
  dynamic_formatting: "multi_listing",
};

// The listings the deployed run actually answered about, so rendering is exercised on real rows.
const PROPERTIES = [
  {
    address: "70 Rainey St #1509",
    price: "750000",
    beds: "2",
    baths: "2",
    sqft: "1128",
    neighborhood: "Downtown Austin",
    year_built: "2018",
    property_type: "Condo",
    status: "Active",
    features: "Central Air, Balcony, Elevator Building, Urban Location",
    listing_url: "https://www.zillow.com/homedetails/70-Rainey-St-1509-Austin-TX-78701/306644848_zpid/",
    photo_url: "https://photos.zillowstatic.com/fp/rainey1509-p_e.jpg",
  },
  {
    address: "6816 Beatty Dr",
    price: "2800 per month",
    beds: "3",
    baths: "2",
    sqft: "1687",
    neighborhood: "South Austin",
    year_built: "2004",
    property_type: "House",
    status: "Active",
    features: "Fenced Yard, Washer Dryer, Covered Parking",
    listing_url: "https://www.zillow.com/homedetails/6816-Beatty-Dr-Austin-TX-78749/29492081_zpid/",
    photo_url: "https://photos.zillowstatic.com/fp/beatty-p_e.jpg",
  },
  {
    address: "7405 Wallach St",
    price: "375100",
    beds: "4",
    baths: "3",
    sqft: "2013",
    neighborhood: "Austin",
    year_built: "2016",
    property_type: "Condo",
    status: "",
    features: "Investment property",
    listing_url: "https://www.zillow.com/homedetails/7405-Wallach-St-Austin-TX-78745/2097978022_zpid/",
  },
];

const LEAD = { phone: "+15125550199", full_name: "Martin O", area: "Northwest Austin" };

const resolvedJournal = path.resolve(root, journalPath);
if (!fs.existsSync(resolvedJournal)) {
  console.error(`no live journal at ${journalPath}; run scripts/imessage-live-evals.mjs first`);
  process.exit(2);
}

// Later captures of the same case win, matching the live suite's --regrade behaviour.
const captured = new Map();
for (const line of fs.readFileSync(resolvedJournal, "utf8").split("\n")) {
  if (!line.trim()) continue;
  try {
    const entry = JSON.parse(line);
    captured.set(entry.id, entry);
  } catch {
    // skip a torn line
  }
}

async function replay(entry) {
  const turns = (entry.exchanges || []).map((exchange) => exchange.outbound.text).filter(Boolean);
  if (!turns.length) return null;
  const recentEvents = [];
  let result = null;
  // Replay the whole thread so multi-turn memory is exercised the way the live run did.
  for (const turn of turns) {
    result = await generateTheoReply({
      message: turn,
      source,
      lead: LEAD,
      properties: PROPERTIES,
      recentEvents: [...recentEvents],
    });
    let reply = result.reply || "";
    if (reply) {
      // Mirror the webhook's post-processing, where the "one long line" bug used to live.
      const decision = decideLeadProfileCapture({
        channel: CAPTURE_CHANNEL[source] || "sms",
        message: turn,
        lead: LEAD,
        classification: result.classification,
      });
      reply = appendLeadProfileCaptureAsk(reply, decision, result.mediaUrls.length ? 1200 : 520);
      result = { ...result, reply };
    }
    recentEvents.push({ direction: "inbound", message_text: turn });
    if (reply) recentEvents.push({ direction: "outbound", message_text: reply });
  }
  return result;
}

const rows = [];
for (const [id, family] of Object.entries(FAMILIES)) {
  const entry = captured.get(id);
  if (!entry) {
    console.log(`${id}: no live journal entry, skipped`);
    continue;
  }
  const result = await replay(entry);
  const reply = result?.reply || "";
  const deterministic = reply
    ? checkMessagesFormatting(reply, { family }).map((item) => `${item.code}: ${item.detail}`)
    : ["no_reply: local path produced no reply"];
  rows.push({ id, family, aiAction: result?.aiAction || "", reply, deterministic, clean: deterministic.length === 0 });
}

console.table(rows.map((row) => ({
  id: row.id,
  chars: row.reply.length,
  lines: row.reply ? row.reply.split("\n").length : 0,
  action: row.aiAction,
  checks: row.deterministic.length ? `FAIL(${row.deterministic.length})` : "ok",
})));

const counts = {};
for (const row of rows) {
  for (const violation of row.deterministic) {
    const code = violation.split(":")[0];
    counts[code] = (counts[code] || 0) + 1;
  }
}

for (const row of rows.filter((item) => !item.clean)) {
  console.log(`\n--- FAIL ${row.id}`);
  console.log(`  ${row.deterministic.join("\n  ")}`);
  console.log(row.reply.split("\n").map((line) => `    ${line}`).join("\n"));
}

const summary = {
  ok: rows.every((row) => row.clean),
  mode: "local-replay-deterministic",
  channel: source,
  runtimeGraded: "local working tree",
  source: journalPath,
  totalCases: rows.length,
  clean: rows.filter((row) => row.clean).length,
  violating: rows.filter((row) => !row.clean).length,
  violationCounts: counts,
  cases: rows,
};
console.log(`\n${JSON.stringify({ ...summary, cases: undefined }, null, 2)}`);

if (outPath) {
  const resolved = path.resolve(root, outPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`wrote ${outPath}`);
}

if (!summary.ok) process.exit(1);
