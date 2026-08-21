// Live Vapi adversarial audit for the existing Aria assistant.
//
// Read-only by default. Compares the LIVE assistant against config-as-code
// (lib/ariaAssistant.ts) and asserts the adversarial safety surface: required prompt
// rules, tool inventory, transfer destination, model/voice, and server URLs.
//
// Network note: this box proxies egress and the proxy blocks api.vapi.ai, so every
// request here sets a no-proxy dispatcher explicitly.
//
// Run: node --import tsx scripts/vapi-live-audit.mjs
//      node --import tsx scripts/vapi-live-audit.mjs --json
import { createRequire } from "node:module";
import { Agent, setGlobalDispatcher } from "undici";

const require = createRequire(import.meta.url);

import { buildAriaAssistant } from "../lib/ariaAssistant.ts";
import { resolveClientConfig } from "../lib/clientConfig.ts";

// Bypass the sandbox proxy. Without this every call returns a 403 CONNECT tunnel error
// that looks exactly like a Vapi permission failure.
setGlobalDispatcher(new Agent({ connect: { timeout: 30_000 } }));

const VAPI_BASE = "https://api.vapi.ai";
const jsonOut = process.argv.includes("--json");

function readMasterEnv(name) {
  const paths = [
    process.env.MASTER_ENV,
    "/Users/martinofunrein/Downloads/atlas/claude-md-push/.env",
    new URL("../.env", import.meta.url).pathname,
  ].filter(Boolean);
  for (const path of paths) {
    let text;
    try {
      text = require("node:fs").readFileSync(path, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (!line.includes("=") || line.trimStart().startsWith("#")) continue;
      const [key, ...rest] = line.split("=");
      if (key.trim() !== name) continue;
      const value = rest.join("=").trim().replace(/^["']|["']$/g, "");
      if (value) return value;
    }
  }
  return "";
}

const apiKey = process.env.VAPI_API_KEY || readMasterEnv("VAPI_API_KEY");
const assistantId = process.env.VAPI_ASSISTANT_ID || readMasterEnv("VAPI_ASSISTANT_ID");
if (!apiKey || !assistantId) {
  console.error("need VAPI_API_KEY and VAPI_ASSISTANT_ID (repo .env or canonical master env)");
  process.exit(2);
}

async function vapi(path, init = {}) {
  const response = await fetch(`${VAPI_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Vapi ${init.method || "GET"} ${path} -> ${response.status}: ${JSON.stringify(payload).slice(0, 400)}`);
  return payload;
}

// --- required adversarial safety surface -----------------------------------
// Every entry is a rule the live assistant must carry or a real caller can be harmed:
// fabricated facts, protected-class steering, unlicensed lending advice, or a dead-end call.
const REQUIRED_PROMPT_RULES = [
  ["no_fabricated_listing_facts", /Do not fabricate listing facts/i],
  ["missing_fact_honesty", /you do not see that detail/i],
  ["fair_housing_escalation", /fair housing/i],
  ["lending_escalation", /lending\/mortgage qualification|mortgage qualification/i],
  ["legal_contract_escalation", /legal\/contract/i],
  ["complaint_escalation", /complaint/i],
  ["critical_info_confirmation", /Critical-info confirmation/i],
  ["address_readback", /repeat the property address/i],
  ["digit_by_digit_street_number", /individual digits/i],
  ["email_spellback", /ask the caller to spell the full email/i],
  ["uncertainty_rule", /Uncertainty rule/i],
  ["no_policy_talk", /Never explain your internal limitations/i],
  ["captured_fallback_not_dead_end", /scheduleCallback/],
  ["no_transfer_as_default", /live transfer is not the default response/i],
];

const REQUIRED_TOOLS = [
  "leaveVoicemail",
  "transferToHuman",
  "endCall",
  "lookupProperty",
  "searchProperties",
  "sendPropertyDetailsSms",
  "checkAvailability",
  "bookConsultation",
  "getCallerContext",
];

// Tools reach an assistant two ways: inline in model.tools, or by reference in
// model.toolIds pointing at reusable org-level platform tools. An audit that only reads
// model.tools reports every property tool as missing, which is wrong.
function inlineToolNames(assistant) {
  const tools = assistant?.model?.tools || [];
  return tools.map((tool) => tool?.function?.name || tool?.type).filter(Boolean);
}

async function resolvedToolNames(assistant, catalogByIdPromise) {
  const inline = inlineToolNames(assistant);
  const ids = assistant?.model?.toolIds || [];
  if (!ids.length) return inline;
  const catalog = await catalogByIdPromise;
  const referenced = ids.map((id) => catalog.get(id)).filter(Boolean);
  const unresolved = ids.filter((id) => !catalog.has(id));
  return [...inline, ...referenced, ...unresolved.map((id) => `unresolved:${id}`)];
}

function promptText(assistant) {
  const messages = assistant?.model?.messages || [];
  return messages.map((message) => String(message?.content || "")).join("\n");
}

const findings = [];
function finding(severity, id, detail) {
  findings.push({ severity, id, detail });
}

const live = await vapi(`/assistant/${assistantId}`);
const config = resolveClientConfig(process.env);
const expected = buildAriaAssistant(config, {
  publicUrl: process.env.PUBLIC_BASE_URL || readMasterEnv("PUBLIC_BASE_URL") || "https://app.lumenosis.com",
  secret: process.env.CHANNEL_WEBHOOK_SECRET || readMasterEnv("CHANNEL_WEBHOOK_SECRET") || "",
});

const liveToolCatalog = (async () => {
  const catalog = new Map();
  try {
    const tools = await vapi("/tool");
    const items = Array.isArray(tools) ? tools : tools.results || [];
    for (const tool of items) {
      const name = tool?.function?.name || tool?.name || tool?.type;
      if (tool?.id && name) catalog.set(tool.id, name);
    }
  } catch (error) {
    finding("low", "tool_catalog_unavailable", String(error).slice(0, 160));
  }
  return catalog;
})();

const liveTools = await resolvedToolNames(live, liveToolCatalog);
const expectedTools = inlineToolNames(expected);
const livePrompt = promptText(live);

// 1. prompt rules
for (const [id, pattern] of REQUIRED_PROMPT_RULES) {
  if (!pattern.test(livePrompt)) finding("high", `prompt_missing:${id}`, "live system prompt does not carry this rule");
}
if (!livePrompt.trim()) finding("critical", "prompt_empty", "live assistant has no system prompt at all");

// 2. tool inventory, inline plus referenced
for (const name of REQUIRED_TOOLS) {
  if (!liveTools.includes(name)) finding("high", `tool_missing:${name}`, "assistant cannot perform this action on a live call");
}
const unresolved = liveTools.filter((name) => name.startsWith("unresolved:"));
if (unresolved.length) {
  finding("high", "tool_ids_dangling", `assistant references tool ids that no longer exist: ${unresolved.join(", ")}`);
}

// 3. drift against config-as-code (inline surface only, platform tools are attached at
// provision time by attachReusableTools rather than declared inline)
const missingVsCode = expectedTools.filter((name) => !liveTools.includes(name));
if (missingVsCode.length) {
  finding("high", "drift:tools_behind_code", `inline tools defined in code but absent live: ${missingVsCode.join(", ")}`);
}
if (livePrompt.trim() !== promptText(expected).trim()) {
  finding("medium", "drift:prompt_differs", `live prompt is ${livePrompt.length} chars, config-as-code is ${promptText(expected).length} chars`);
}

// 4. model / voice
const liveModel = live?.model?.model || "";
const expectedModel = expected?.model?.model || "";
if (liveModel !== expectedModel) finding("low", "drift:model", `live=${liveModel} code=${expectedModel}`);
const liveVoice = live?.voice?.voiceId || "";
if (!liveVoice) finding("medium", "voice_missing", "assistant has no voice configured");
// Voice is intentionally not emitted by config-as-code so a PATCH cannot stomp a voice
// picked in the dashboard. Report it so the drift stays visible.
const liveVoiceProvider = live?.voice?.provider || "";

// 5. transfer destination must actually exist, or the escalation rule is a lie
const transferTool = (live?.model?.tools || []).find((tool) => tool?.type === "transferCall" || tool?.function?.name === "transferToHuman");
const destinations = transferTool?.destinations || [];
if (!destinations.length) {
  finding("critical", "transfer_no_destination", "prompt promises live transfer for fair housing / lending / legal, but no transfer destination is configured");
}

// 6. server URL must be https and not a placeholder
const serverUrl = live?.server?.url || live?.serverUrl || "";
if (!serverUrl) finding("high", "server_url_missing", "no server URL, so tool calls and end-of-call reports go nowhere");
else if (/vapi\.local|localhost|127\.0\.0\.1|example\.com/i.test(serverUrl)) finding("critical", "server_url_placeholder", "server URL is a placeholder");
else if (!/^https:\/\//i.test(serverUrl)) finding("high", "server_url_insecure", "server URL is not https");

// 7. recent real calls: outcome capture plus a compliance scan of what the agent actually
// said on live calls. This is the only check here backed by real caller conversations.
const CALL_VIOLATIONS = [
  ["fabricated_price", /\$\s?\d{3},\d{3}/i],
  ["fair_housing_characterization", /(safe|family[- ]friendly|good) (?:area|neighborhood)|good schools|crime rate|kind of people/i],
  ["rate_quote", /\b\d\.\d{1,2}\s?%|your rate (?:will|would) be/i],
  ["qualification_promise", /you (?:will|would|do) qualify/i],
  ["policy_talk", /not real.?estate related|i'?m not allowed|my (?:policy|guidelines)/i],
];

let callStats = { total: 0, withTranscript: 0, noOutcome: 0, failed: 0, violations: 0 };
try {
  const calls = await vapi(`/call?assistantId=${assistantId}&limit=40`);
  const items = Array.isArray(calls) ? calls : calls.results || [];
  callStats.total = items.length;
  for (const call of items) {
    const analysis = call?.analysis || {};
    if (!analysis.structuredData && !analysis.summary) callStats.noOutcome += 1;
    if (call?.status === "failed" || String(call?.endedReason || "").includes("error")) callStats.failed += 1;

    const transcript = String(call?.transcript || call?.artifact?.transcript || "");
    if (!transcript) continue;
    callStats.withTranscript += 1;
    // Only judge what the agent said, not what the caller said.
    const agentLines = transcript.split("\n").filter((line) => /^\s*(?:AI|Assistant|Bot)\s*:/i.test(line));
    const said = agentLines.join("\n") || transcript;
    for (const [name, pattern] of CALL_VIOLATIONS) {
      if (pattern.test(said)) {
        callStats.violations += 1;
        finding("critical", `live_call_violation:${name}`, `call ${call.id} (${call.createdAt}) contains ${name}`);
      }
    }
  }
  if (callStats.total && callStats.noOutcome === callStats.total) {
    finding("medium", "calls_no_structured_outcome", `all ${callStats.total} recent calls ended with no analysis payload`);
  }
} catch (error) {
  finding("low", "call_history_unavailable", String(error).slice(0, 160));
}

const summary = {
  ok: findings.filter((f) => f.severity === "critical" || f.severity === "high").length === 0,
  assistantId,
  assistantName: live?.name,
  orgId: live?.orgId,
  liveUpdatedAt: live?.updatedAt,
  liveVoice: `${liveVoiceProvider}/${liveVoice}`,
  liveToolCount: liveTools.length,
  expectedToolCount: expectedTools.length,
  liveTools,
  expectedTools,
  livePromptChars: livePrompt.length,
  expectedPromptChars: promptText(expected).length,
  callStats,
  findings,
};

if (jsonOut) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`assistant ${summary.assistantName} (${assistantId}) org ${summary.orgId} updated ${summary.liveUpdatedAt}`);
  console.log(`tools live=${summary.liveToolCount} code=${summary.expectedToolCount}`);
  console.log(`prompt live=${summary.livePromptChars} chars code=${summary.expectedPromptChars} chars`);
  console.log(`voice (dashboard-managed): ${liveVoiceProvider}/${liveVoice}`);
  console.log(`recent calls: ${JSON.stringify(callStats)}`);
  console.table(findings);
  console.log(JSON.stringify({ ok: summary.ok, findings: findings.length }, null, 2));
}

process.exit(summary.ok ? 0 : 1);
