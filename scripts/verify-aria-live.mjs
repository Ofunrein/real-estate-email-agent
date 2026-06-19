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

async function fetchVapi(path, apiKey) {
  const response = await fetch(`https://api.vapi.ai${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Vapi ${path} failed: ${JSON.stringify(payload)}`);
  return payload;
}

async function resolveAssistantTools(assistant, apiKey) {
  const inlineTools = assistant.model?.tools || [];
  const toolIds = assistant.model?.toolIds || [];
  const reusableTools = [];
  for (const id of toolIds) {
    reusableTools.push(await fetchVapi(`/tool/${id}`, apiKey));
  }
  return [...inlineTools, ...reusableTools];
}

loadEnv();

const apiKey = requireEnv("VAPI_API_KEY");
const assistantId = requireEnv("VAPI_ASSISTANT_ID");
const expectedModel = process.env.ARIA_RESPOND_MODEL || "gpt-4.1-mini";

const assistant = await fetchVapi(`/assistant/${assistantId}`, apiKey);

const tools = await resolveAssistantTools(assistant, apiKey);
const names = tools.map((tool) => tool.function?.name || tool.name || tool.type).sort();
const requiredTools = [
  "bookConsultation",
  "checkAvailability",
  "getCallerContext",
  "lookupProperty",
  "notifySlackLeadIssue",
  "searchProperties",
  "sendPropertyDetailsSms",
  "sendBookingSmsConfirmation",
].sort();
const allowedServerTools = new Set(["getCallerContext", "lookupProperty", "searchProperties", "sendPropertyDetailsSms"]);

assert(assistant.model?.model === expectedModel, `Expected model ${expectedModel}, got ${assistant.model?.model}`);
assert(assistant.voice?.voiceId === (process.env.ARIA_VOICE_ID || assistant.voice?.voiceId), "Voice id mismatch");
assert(Array.isArray(assistant.voice?.fallbackPlan?.voices), "Voice fallbackPlan.voices must be an array");
assert(
  assistant.voice.fallbackPlan.voices.every((voice) => voice?.voiceId),
  "Voice fallback entries must include voiceId",
);
assert(requiredTools.every((name) => names.includes(name)), `Missing function tools: ${requiredTools.filter((name) => !names.includes(name)).join(", ")}`);
for (const tool of tools) {
  const name = tool.function?.name || tool.name || tool.type;
  if (tool.server?.url) {
    assert(allowedServerTools.has(name), `Unexpected repo webhook tool attached: ${name}`);
    assert(String(tool.server.url).includes(`/api/webhooks/aria-tools/${name}`), `Property tool ${name} does not point at the Aria tool endpoint`);
  }
}

console.log(JSON.stringify({
  ok: true,
  assistant: {
    id: assistant.id,
    name: assistant.name,
    model: assistant.model?.model,
    voice: assistant.voice,
    functionTools: names,
    toolIds: assistant.model?.toolIds || [],
  },
}, null, 2));
