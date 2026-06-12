#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { normalizeAddressKey, normalizeApifyItem } from "./import-zillow-apify-properties.mjs";

function loadDotenv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

function unitlessAddressKey(address) {
  return normalizeAddressKey(address).replace(/\b(?:apt|unit|#)\s*[a-z0-9-]+\b/g, "").replace(/\s+/g, " ").trim();
}

async function fetchJson(url) {
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) throw new Error(`Apify read failed (${response.status}): ${text.slice(0, 300)}`);
  return JSON.parse(text || "{}");
}

async function main() {
  loadDotenv();
  const token = process.env.APIFY_TOKEN || "";
  if (!token) throw new Error("APIFY_TOKEN is required");

  const since = process.argv[2] || "2026-06-11T00:00:00.000Z";
  const runLimit = Number(process.argv[3] || 200);
  const outPath = process.argv[4] || "reports/apify-search-core-index.json";
  const actor = process.env.APIFY_ZILLOW_SEARCH_ACTOR || "truefetch~zillow-real-estate-listings";
  const sinceMs = Date.parse(since);
  if (!Number.isFinite(sinceMs)) throw new Error(`Invalid since timestamp: ${since}`);

  const runsUrl = `https://api.apify.com/v2/acts/${actor}/runs?token=${encodeURIComponent(token)}&limit=${runLimit}&desc=1`;
  const runsPayload = await fetchJson(runsUrl);
  const runs = (runsPayload.data?.items || [])
    .filter((run) => run.status === "SUCCEEDED" && run.defaultDatasetId && Date.parse(run.startedAt) >= sinceMs)
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));

  const index = {};
  const coreFields = ["zip", "sqft", "year_built", "photo_url", "listing_url", "beds", "baths", "price", "city", "state"];
  let itemsSeen = 0;

  for (const run of runs) {
    const itemsUrl = `https://api.apify.com/v2/datasets/${run.defaultDatasetId}/items?token=${encodeURIComponent(token)}&clean=true`;
    const items = await fetchJson(itemsUrl);
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      itemsSeen += 1;
      const row = normalizeApifyItem(item);
      if (!row.address) continue;
      const payload = Object.fromEntries(coreFields.map((field) => [field, row[field] || ""]));
      for (const key of new Set([normalizeAddressKey(row.address), unitlessAddressKey(row.address)])) {
        if (!key) continue;
        const existing = index[key] || {};
        index[key] = Object.fromEntries(coreFields.map((field) => [field, existing[field] || payload[field] || ""]));
      }
    }
    console.log(`Indexed ${Object.keys(index).length} keys from ${itemsSeen} items (${run.id})`);
  }

  const resolved = path.resolve(process.cwd(), outPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify({ since, run_count: runs.length, items_seen: itemsSeen, index }, null, 2)}\n`);
  console.log(`Wrote ${Object.keys(index).length} keys to ${resolved}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
