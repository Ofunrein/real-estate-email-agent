#!/usr/bin/env node

const API_BASE = (process.env.MANYCHAT_API_BASE || "https://api.manychat.com").replace(/\/$/, "");
const API_KEY = process.env.MANYCHAT_API_KEY || "";
const APPLY = process.argv.includes("--apply");

const REQUIRED_TAGS = [
  "theo:routed",
  "theo:auto-sent",
  "theo:needs-human",
  "theo:media",
];

const REQUIRED_FIELDS = [
  "lumenosis_channel",
  "lumenosis_thread_ref",
  "lumenosis_route_reason",
  "lumenosis_theo_status",
  "lumenosis_theo_reply",
  "lumenosis_theo_media_urls",
  "lumenosis_theo_intent",
];

async function request(path, init = {}) {
  if (!API_KEY) throw new Error("MANYCHAT_API_KEY is required");
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.message || response.statusText;
    throw new Error(`ManyChat ${response.status} ${path}: ${message}`);
  }
  return payload;
}

function listFrom(payload, keys) {
  if (Array.isArray(payload)) return payload;
  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return payload[key];
    if (Array.isArray(payload?.data?.[key])) return payload.data[key];
  }
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function names(items) {
  return items.map((item) => String(item.name || item.title || "")).filter(Boolean);
}

function missing(required, existing) {
  const existingNames = new Set(names(existing).map((name) => name.toLowerCase()));
  return required.filter((name) => !existingNames.has(name.toLowerCase()));
}

async function optional(label, fn, fallback) {
  try {
    return await fn();
  } catch (error) {
    console.warn(`${label}: ${error.message}`);
    return fallback;
  }
}

const page = await optional("page", () => request("/fb/page/getInfo"), {});
const tags = await optional("tags", async () => listFrom(await request("/fb/page/getTags"), ["tags"]), []);
const fields = await optional("custom fields", async () => listFrom(await request("/fb/page/getCustomFields"), ["custom_fields", "fields"]), []);
const flows = await optional("flows", async () => listFrom(await request("/fb/page/getFlows"), ["flows"]), []);

const missingTags = missing(REQUIRED_TAGS, tags);
const missingFields = missing(REQUIRED_FIELDS, fields);

console.log(JSON.stringify({
  mode: APPLY ? "apply" : "dry-run",
  page,
  tags: names(tags),
  custom_fields: names(fields),
  flows: names(flows),
  missing_tags: missingTags,
  missing_custom_fields: missingFields,
}, null, 2));

if (!APPLY) {
  console.log("Dry run only. Re-run with --apply to create missing tags/custom fields when the ManyChat API supports the endpoint.");
  process.exit(0);
}

for (const name of missingTags) {
  await optional(`create tag ${name}`, () => request("/fb/page/createTag", { method: "POST", body: JSON.stringify({ name }) }), null);
}

for (const name of missingFields) {
  await optional(`create field ${name}`, () => request("/fb/page/createCustomField", { method: "POST", body: JSON.stringify({ name, type: "text" }) }), null);
}

console.log("Apply pass complete. Configure the Dynamic Block flow in ManyChat UI; this script does not create/edit flows.");
