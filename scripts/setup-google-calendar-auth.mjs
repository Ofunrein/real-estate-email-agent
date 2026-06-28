#!/usr/bin/env node
// One-time OAuth flow to get a Google Calendar refresh token for martin@lumenosis.com.
// Uses localhost redirect (required for web client IDs).
// Run: node scripts/setup-google-calendar-auth.mjs
// Opens a local server on port 4242, navigates to Google, auto-captures the code.

import fs from "node:fs";
import http from "node:http";
import { google } from "googleapis";

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

const PORT = 4242;
const REDIRECT = `http://localhost:${PORT}/oauth2callback`;
const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in .env");
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(clientId, clientSecret, REDIRECT);
const authUrl = oauth2.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: ["https://www.googleapis.com/auth/calendar"],
});

console.log("\n=== Google Calendar OAuth Setup ===");
console.log(`Listening on ${REDIRECT}`);
console.log("\nOpen this URL in your browser and sign in as martin@lumenosis.com:\n");
console.log(authUrl);
console.log("\nWaiting for Google to redirect back...\n");

const server = http.createServer(async (req, res) => {
  if (!req.url?.startsWith("/oauth2callback")) {
    res.end("Not found");
    return;
  }
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<h2>Error: ${error}</h2><p>Close this tab.</p>`);
    server.close();
    console.error("OAuth error:", error);
    process.exit(1);
  }

  if (!code) {
    res.end("No code received.");
    return;
  }

  try {
    const { tokens } = await oauth2.getToken(code);
    const refreshToken = tokens.refresh_token;

    if (!refreshToken) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<h2>No refresh token — revoke access at myaccount.google.com/permissions and try again.</h2>");
      server.close();
      process.exit(1);
    }

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<h2>✓ Google Calendar connected! Close this tab and check your terminal.</h2>");
    server.close();

    const envPath = ".env";
    const existing = fs.readFileSync(envPath, "utf8");
    const lines = [
      existing.includes("CALENDAR_PROVIDER=") ? null : "CALENDAR_PROVIDER=google",
      existing.includes("GOOGLE_REFRESH_TOKEN=") ? null : `GOOGLE_REFRESH_TOKEN=${refreshToken}`,
      existing.includes("GOOGLE_CALENDAR_ID=") ? null : "GOOGLE_CALENDAR_ID=martin@lumenosis.com",
    ].filter(Boolean);

    if (lines.length) {
      fs.appendFileSync(envPath, "\n" + lines.join("\n") + "\n");
      console.log("✓ Written to .env:");
      lines.forEach((l) => console.log(" ", l));
    } else {
      console.log("✓ Refresh token obtained. Update GOOGLE_REFRESH_TOKEN in .env manually:");
      console.log(`GOOGLE_REFRESH_TOKEN=${refreshToken}`);
    }

    console.log("\nNext: npm run aria:provision to activate Google Calendar for Iris.\n");
    process.exit(0);
  } catch (e) {
    res.end("Token exchange failed: " + e.message);
    server.close();
    console.error("Token exchange failed:", e.message);
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log(`Server ready on http://localhost:${PORT}`);
});
