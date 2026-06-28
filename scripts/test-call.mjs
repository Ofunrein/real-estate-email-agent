#!/usr/bin/env node
// Place a live test outbound call via Vapi to verify Iris end-to-end.
// Usage:
//   node scripts/test-call.mjs                      # calls default TEST_PHONE (+15125712595)
//   node scripts/test-call.mjs +15125559999         # calls specified number
//   node scripts/test-call.mjs --dry-run            # prints call body, no network
//
// Env: VAPI_API_KEY, VAPI_ASSISTANT_ID, VAPI_PHONE_NUMBER_ID (from .env)
import fs from "node:fs";

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

loadEnv();

const dryRun = process.argv.includes("--dry-run");
const numberArg = process.argv.find((a) => a.startsWith("+") || /^\d{10,}$/.test(a));
const targetPhone = numberArg
  ? numberArg.startsWith("+") ? numberArg : `+1${numberArg}`
  : process.env.TEST_PHONE || "+15125712595";

const apiKey = process.env.VAPI_API_KEY;
const assistantId = process.env.VAPI_ASSISTANT_ID;
const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;
const agentName = process.env.AGENT_NAME_VOICE || "Iris";
const companyName = process.env.ARIA_CLIENT_NAME || process.env.CLIENT_NAME || "Austin Realty";

if (!apiKey || !assistantId || !phoneNumberId) {
  console.error("Missing VAPI_API_KEY, VAPI_ASSISTANT_ID, or VAPI_PHONE_NUMBER_ID");
  process.exit(1);
}

const body = {
  assistantId,
  phoneNumberId,
  customer: { number: targetPhone },
  metadata: {
    direction: "outbound",
    trigger: "manual_test",
    clientId: process.env.CLIENT_ID || "austin-realty",
    leadPhone: targetPhone,
  },
  assistantOverrides: {
    firstMessageMode: "assistant-speaks-first",
    firstMessage: `Hi, this is ${agentName} with ${companyName}. I'm just calling to make sure everything's working on our end — this is a quick test call. You can hang up anytime. Thanks!`,
  },
};

if (dryRun) {
  console.log("Dry run — call body:");
  console.log(JSON.stringify(body, null, 2));
  process.exit(0);
}

console.log(`Placing test call to ${targetPhone} via Vapi assistant ${assistantId}...`);
const response = await fetch("https://api.vapi.ai/call", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
});

const payload = await response.json().catch(() => ({}));
if (!response.ok) {
  console.error(`Vapi call failed (${response.status}):`, JSON.stringify(payload, null, 2));
  process.exit(1);
}

console.log(`Call placed successfully.`);
console.log(`  Call ID:  ${payload.id}`);
console.log(`  Status:   ${payload.status}`);
console.log(`  Phone:    ${targetPhone}`);
console.log(`  Agent:    ${agentName} — ${companyName}`);
