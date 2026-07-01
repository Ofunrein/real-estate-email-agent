#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = new Map(process.argv.slice(2).filter((arg) => arg.startsWith("--") && arg.includes("=")).map((arg) => {
  const i = arg.indexOf("=");
  return [arg.slice(2, i), arg.slice(i + 1)];
}));

function clean(value) { return String(value ?? "").trim(); }
function cookieHeader() {
  const direct = clean(process.env.INSTAGRAM_BROWSER_COOKIE || process.env.IG_BROWSER_COOKIE);
  if (direct) return direct;
  const sessionid = clean(process.env.INSTAGRAM_SESSIONID || process.env.IG_SESSIONID);
  const csrftoken = clean(process.env.INSTAGRAM_CSRFTOKEN || process.env.IG_CSRFTOKEN);
  const dsUserId = clean(process.env.INSTAGRAM_DS_USER_ID || process.env.IG_DS_USER_ID);
  return [sessionid ? `sessionid=${sessionid}` : "", csrftoken ? `csrftoken=${csrftoken}` : "", dsUserId ? `ds_user_id=${dsUserId}` : ""].filter(Boolean).join("; ");
}
function csrf(cookies) {
  return clean(process.env.INSTAGRAM_CSRFTOKEN || process.env.IG_CSRFTOKEN) || cookies.match(/(?:^|;\s*)csrftoken=([^;]+)/)?.[1] || "";
}

const threadId = clean(args.get("thread-id") || args.get("thread"));
const recipient = clean(args.get("recipient"));
const username = clean(args.get("username")).replace(/^@/, "");
const limit = clean(args.get("limit") || "100");
if (!threadId) throw new Error("--thread-id=<instagram direct thread id> required");
if (!recipient) throw new Error("--recipient=<dashboard/browser recipient id> required");
if (!username) throw new Error("--username=<handle> required");
const cookies = cookieHeader();
const token = csrf(cookies);
if (!cookies || !token) throw new Error("Instagram browser cookies required. Set INSTAGRAM_BROWSER_COOKIE or IG_SESSIONID + IG_CSRFTOKEN.");

const url = `https://www.instagram.com/api/v1/direct_v2/threads/${encodeURIComponent(threadId)}/?limit=${encodeURIComponent(limit)}`;
const res = await fetch(url, {
  redirect: "manual",
  headers: {
    cookie: cookies,
    "x-csrftoken": token,
    "x-ig-app-id": clean(process.env.INSTAGRAM_WEB_APP_ID || "936619743392459"),
    "x-asbd-id": "129477",
    "x-requested-with": "XMLHttpRequest",
    referer: "https://www.instagram.com/direct/inbox/",
    "user-agent": clean(process.env.INSTAGRAM_BROWSER_USER_AGENT || "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"),
  },
});
if ([301, 302, 303, 307, 308].includes(res.status)) {
  const location = res.headers.get("location") || "";
  throw new Error(`Instagram thread fetch redirected instead of syncing. Browser cookie is stale or logged out. Redirect: ${location.replace(/([?&](?:sessionid|csrftoken|token|auth)[^=]*=)[^&]+/gi, "$1[redacted]")}`);
}
const payload = await res.json().catch(async () => ({ raw: await res.text().catch(() => "") }));
if (!res.ok) throw new Error(`Instagram thread fetch failed ${res.status}: ${clean(payload.message || payload.raw).slice(0, 300)}`);
const tmp = path.join(os.tmpdir(), `instagram-thread-${username}-${Date.now()}.json`);
fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
const child = spawnSync(process.execPath, ["scripts/import-instagram-direct-thread.mjs", `--input=${tmp}`, `--recipient=${recipient}`, `--username=${username}`, "--replace"], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
});
if (child.status !== 0) process.exit(child.status || 1);
console.log(JSON.stringify({ ok: true, threadId, recipient, username, input: tmp }, null, 2));
