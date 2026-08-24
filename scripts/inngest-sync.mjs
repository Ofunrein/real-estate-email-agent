#!/usr/bin/env node
// Register this deployment's Inngest functions, or list what is registered.
//
//   node scripts/inngest-sync.mjs           sync this client's app
//   node scripts/inngest-sync.mjs --list    list its registered functions
//   node scripts/inngest-sync.mjs --dry-run print the command, run nothing
//
// Replaces two npm scripts that hardcoded `lumenosis-real-estate-agent` and
// `https://app.lumenosis.com`. With one deployment per client those constants
// are wrong for every client but the first, and running the old script from a
// second client's checkout would sync the FIRST client's app to whatever URL
// happened to be passed — which is the cross-wiring the tenant-derived app id
// exists to prevent.
//
// Env: CLIENT_ID (or INNGEST_APP_ID), PUBLIC_BASE_URL.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadDotEnv(file = path.join(ROOT, ".env")) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const raw = trimmed.slice(index + 1).trim();
    const value = /^['"]/.test(raw) ? raw.replace(/^['"]|['"]$/g, "") : raw.replace(/(?:^|\s+)#.*$/, "").trim();
    if (!process.env[key] && value) process.env[key] = value;
  }
}

// Mirrors inngestAppId() in lib/tenant.ts. Kept in sync by a test rather than
// imported, so this stays a plain node script with no TS loader.
const LEGACY_APP_ID = "lumenosis-real-estate-agent";

function appId() {
  const explicit = String(process.env.INNGEST_APP_ID || "").trim();
  if (explicit) return explicit;
  const clientId = String(process.env.CLIENT_ID || "").trim() || "default";
  return clientId === "default" ? LEGACY_APP_ID : `${LEGACY_APP_ID}-${clientId}`;
}

loadDotEnv();

const list = process.argv.includes("--list");
const dryRun = process.argv.includes("--dry-run");
const app = appId();
const baseUrl = String(process.env.PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");

if (!list && !baseUrl) {
  console.error("PUBLIC_BASE_URL is required so Inngest knows which deployment to register.");
  process.exit(1);
}

const args = list
  ? ["-y", "inngest-cli@latest", "api", "get-functions", "--prod", app, "--raw"]
  : ["-y", "inngest-cli@latest", "api", "sync-app", "--prod", app, "--url", `${baseUrl}/api/inngest`];

console.error(`inngest app: ${app}`);
if (!list) console.error(`inngest url: ${baseUrl}/api/inngest`);

if (dryRun) {
  console.log(JSON.stringify({ dry_run: true, command: `npx ${args.join(" ")}` }, null, 2));
  process.exit(0);
}

execFileSync("npx", args, { stdio: "inherit", cwd: ROOT });
