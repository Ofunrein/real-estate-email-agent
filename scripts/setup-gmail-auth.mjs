#!/usr/bin/env node
// Opens the app-native Gmail OAuth flow. The production callback stores the token in Neon.
// Run: npm run setup:gmail-auth

import fs from "node:fs";

function loadEnv(path = ".env") {
  if (!fs.existsSync(path)) return;
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const idx = trimmed.indexOf("=");
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
    process.env[key] ??= value;
  }
}

loadEnv();

const publicUrl = (process.env.PUBLIC_BASE_URL || process.env.AUTH_URL || "https://app.lumenosis.com").replace(/\/$/, "");
const url = `${publicUrl}/api/settings/email-account/connect?mode=autosend`;

console.log("\n=== Gmail OAuth Setup ===");
console.log("Open this URL while logged into the Lumenosis dashboard:");
console.log(url);
console.log("");
console.log("After Google redirects back to the dashboard and shows emailConnected, run:");
console.log("  npm run setup:gmail-push");
