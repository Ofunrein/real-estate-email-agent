#!/usr/bin/env node
import fs from "node:fs";

function loadEnv(path = ".env") {
  if (!fs.existsSync(path)) return;
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function toolPayload(name, args, phone = "") {
  return {
    message: {
      type: "tool-calls",
      call: { id: `verify_${name}`, customer: phone ? { number: phone } : {} },
      toolCallList: [{
        id: `tool_${name}`,
        function: { name, arguments: JSON.stringify(args) },
      }],
    },
  };
}

async function postTool(base, name, args, phone = "") {
  const secret = process.env.CHANNEL_WEBHOOK_SECRET || "";
  const url = `${base}/api/webhooks/aria-tools/${name}${secret ? `?secret=${encodeURIComponent(secret)}` : ""}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(toolPayload(name, args, phone)),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${name} webhook failed ${response.status}: ${JSON.stringify(data)}`);
  const result = data?.results?.[0]?.result || "";
  assert(result, `${name} webhook returned no result`);
  return result;
}

loadEnv();

const apiKey = requireEnv("VAPI_API_KEY");
const assistantId = requireEnv("VAPI_ASSISTANT_ID");
const publicBase = requireEnv("PUBLIC_BASE_URL").replace(/\/$/, "");
const expectedModel = process.env.ARIA_RESPOND_MODEL || "gpt-4.1-mini";

const assistantResponse = await fetch(`https://api.vapi.ai/assistant/${assistantId}`, {
  headers: { Authorization: `Bearer ${apiKey}` },
});
const assistant = await assistantResponse.json().catch(() => ({}));
if (!assistantResponse.ok) throw new Error(`Vapi assistant fetch failed: ${JSON.stringify(assistant)}`);

const tools = assistant.model?.tools || [];
const names = tools.filter((tool) => tool.type === "function").map((tool) => tool.function?.name).sort();
const requiredTools = ["getCallerContext", "lookupProperty", "qualifyLead", "scheduleShowing", "searchProperties", "syncToCrm"].sort();

assert(assistant.model?.model === expectedModel, `Expected model ${expectedModel}, got ${assistant.model?.model}`);
assert(assistant.voice?.voiceId === (process.env.ARIA_VOICE_ID || assistant.voice?.voiceId), "Voice id mismatch");
assert(requiredTools.every((name) => names.includes(name)), `Missing function tools: ${requiredTools.filter((name) => !names.includes(name)).join(", ")}`);
assert(String(assistant.server?.url || "").startsWith(publicBase), "Assistant server URL does not use PUBLIC_BASE_URL");
for (const tool of tools.filter((entry) => entry.type === "function")) {
  assert(String(tool.server?.url || "").startsWith(publicBase), `Tool ${tool.function?.name} URL does not use PUBLIC_BASE_URL`);
}

const lookup = await postTool(publicBase, "lookupProperty", {
  address: "4309 Fairway Path",
  message: "caller asked for listing details",
});
assert(/4309 Fairway Path/i.test(lookup), `Lookup did not mention 4309 Fairway Path: ${lookup}`);
assert(/\$407,800|407,800|4 bed/i.test(lookup), `Lookup did not return expected listing facts: ${lookup}`);
assert(!/Fairwood Avenue caller asked/i.test(lookup), `Lookup returned polluted address: ${lookup}`);

const search = await postTool(publicBase, "searchProperties", {
  area: "Austin",
  query: "4 bed homes around Greater Austin",
  beds: 4,
});
assert(/I found|option/i.test(search), `Search did not return options: ${search}`);

console.log(JSON.stringify({
  ok: true,
  assistant: {
    id: assistant.id,
    name: assistant.name,
    model: assistant.model?.model,
    voice: assistant.voice,
    functionTools: names,
  },
  liveChecks: {
    lookup,
    search,
  },
}, null, 2));
