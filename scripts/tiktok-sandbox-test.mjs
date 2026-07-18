#!/usr/bin/env node
// TikTok Marketing API sandbox / live smoke test.
//
// Verifies your app credentials work end to end without touching real ad spend:
//   1. reads TIKTOK_APP_ID / TIKTOK_APP_SECRET (+ optional TIKTOK_ACCESS_TOKEN)
//   2. lists authorized advertiser accounts
//   3. pulls a basic account-level report for the first advertiser
//
// Get a sandbox access token: TikTok developer portal -> your app -> Sandbox Ad
// Account -> create -> copy the generated Access Token + Advertiser ID.
//
// Run:  node scripts/tiktok-sandbox-test.mjs
// Env:  TIKTOK_APP_ID, TIKTOK_APP_SECRET, TIKTOK_ACCESS_TOKEN, [TIKTOK_ADVERTISER_ID]
//       Values are read from process.env then .env / .env.local. Never printed.

import fs from "node:fs";
import path from "node:path";

let dotenvCache;
function dotenvValue(name) {
  if (!dotenvCache) {
    dotenvCache = new Map();
    for (const file of [".env", ".env.local"]) {
      const p = path.join(process.cwd(), file);
      if (!fs.existsSync(p)) continue;
      for (const line of fs.readFileSync(p, "utf8").split("\n")) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (!m) continue;
        let value = m[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (!dotenvCache.has(m[1])) dotenvCache.set(m[1], value);
      }
    }
  }
  return dotenvCache.get(name) || "";
}
function env(name) {
  return (process.env[name] || dotenvValue(name)).trim();
}

const API_BASE = env("TIKTOK_API_BASE") || "https://business-api.tiktok.com/open_api";
const API_VERSION = env("TIKTOK_API_VERSION") || "v1.3";
function apiUrl(p) {
  return `${API_BASE.replace(/\/$/, "")}/${API_VERSION}/${p.replace(/^\//, "")}`;
}

async function tiktokGet(p, accessToken, params = {}) {
  const url = new URL(apiUrl(p));
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, typeof v === "string" ? v : JSON.stringify(v));
  }
  const res = await fetch(url.toString(), { headers: { "Access-Token": accessToken } });
  return res.json().catch(() => ({}));
}

async function main() {
  const appId = env("TIKTOK_APP_ID");
  const secret = env("TIKTOK_APP_SECRET");
  const accessToken = env("TIKTOK_ACCESS_TOKEN");
  let advertiserId = env("TIKTOK_ADVERTISER_ID");

  console.log("TikTok Marketing API smoke test");
  console.log(`  TIKTOK_APP_ID:        ${appId ? "[SET]" : "[MISSING]"}`);
  console.log(`  TIKTOK_APP_SECRET:    ${secret ? "[SET]" : "[MISSING]"}`);
  console.log(`  TIKTOK_ACCESS_TOKEN:  ${accessToken ? "[SET]" : "[MISSING]"}`);
  console.log(`  API:                  ${API_BASE} ${API_VERSION}`);

  if (!accessToken) {
    console.error("\nNo TIKTOK_ACCESS_TOKEN. Create a Sandbox Ad Account in the developer portal, then set TIKTOK_ACCESS_TOKEN (+ TIKTOK_ADVERTISER_ID).");
    process.exit(1);
  }

  // 1. List advertisers (needs app_id + secret; sandbox tokens may skip this).
  if (appId && secret) {
    const url = new URL(apiUrl("oauth2/advertiser/get/"));
    url.searchParams.set("app_id", appId);
    url.searchParams.set("secret", secret);
    const res = await fetch(url.toString(), { headers: { "Access-Token": accessToken } });
    const json = await res.json().catch(() => ({}));
    if (json.code === 0) {
      const list = json.data?.list || [];
      console.log(`\nAuthorized advertisers: ${list.length}`);
      for (const a of list) console.log(`  - ${a.advertiser_id}  ${a.advertiser_name || ""}`);
      if (!advertiserId && list[0]) advertiserId = list[0].advertiser_id;
    } else {
      console.log(`\nAdvertiser list: code=${json.code} message=${json.message || ""} (sandbox tokens often can't call this; using TIKTOK_ADVERTISER_ID instead)`);
    }
  }

  if (!advertiserId) {
    console.error("\nNo advertiser_id resolved. Set TIKTOK_ADVERTISER_ID (from your sandbox ad account).");
    process.exit(1);
  }

  // 2. Basic account-level report for the last 7 days.
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fmt = (d) => d.toISOString().slice(0, 10);
  const report = await tiktokGet("report/integrated/get/", accessToken, {
    advertiser_id: advertiserId,
    report_type: "BASIC",
    data_level: "AUCTION_ADVERTISER",
    dimensions: ["advertiser_id"],
    metrics: ["spend", "impressions", "clicks"],
    start_date: fmt(start),
    end_date: fmt(end),
    page: 1,
    page_size: 10,
  });

  if (report.code === 0) {
    console.log(`\nReport OK for advertiser ${advertiserId} (last 7 days):`);
    console.log(JSON.stringify(report.data?.list || [], null, 2));
    console.log("\nCredentials and Marketing API access verified.");
  } else {
    console.log(`\nReport call: code=${report.code} message=${report.message || ""}`);
    console.log("A non-zero code here usually means the token lacks Reporting scope or the sandbox account has no data yet.");
  }
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
