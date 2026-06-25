import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { google } from "googleapis";

let dotenvCache;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function dotenvValue(name) {
  if (!dotenvCache) {
    const filePath = path.resolve(process.cwd(), ".env");
    dotenvCache = new Map();
    if (fs.existsSync(filePath)) {
      for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const index = trimmed.indexOf("=");
        if (index < 0) continue;
        const key = trimmed.slice(0, index).trim();
        let value = trimmed.slice(index + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        dotenvCache.set(key, value);
      }
    }
  }
  return dotenvCache.get(name) || "";
}

function envValue(name) {
  return process.env[name] || dotenvValue(name);
}

function readJsonEnv(name) {
  const value = envValue(name);
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function credentialPaths() {
  return {
    credentialsPath: path.resolve(process.cwd(), process.env.GMAIL_CREDENTIALS_PATH || "credentials.json"),
    tokenPath: path.resolve(process.cwd(), process.env.GMAIL_TOKEN_PATH || "token.json"),
  };
}

function requiredEnv(name) {
  const value = envValue(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function webhookAddress() {
  const explicit = envValue("GOOGLE_SHEETS_DRIVE_WEBHOOK_URL");
  if (explicit) return explicit;
  const base = envValue("AUTH_URL") || envValue("NEXTAUTH_URL") || "https://app.lumenosis.com";
  return `${base.replace(/\/$/, "")}/api/webhooks/google-drive-sheets`;
}

async function driveClient() {
  const { credentialsPath, tokenPath } = credentialPaths();
  const credentials = readJsonEnv("GMAIL_CREDENTIALS_JSON") || readJson(credentialsPath);
  const token = readJsonEnv("GMAIL_TOKEN_JSON") || readJson(tokenPath);
  const app = credentials.installed || credentials.web;
  if (!app?.client_id || !app.client_secret) throw new Error("Gmail/Google credentials are missing OAuth client data");
  const auth = new google.auth.OAuth2(app.client_id, app.client_secret, app.redirect_uris?.[0]);
  auth.setCredentials(token);
  return google.drive({ version: "v3", auth });
}

const drive = await driveClient();
const fileId = requiredEnv("GOOGLE_SHEET_ID");
const token = requiredEnv("GOOGLE_DRIVE_WEBHOOK_TOKEN");
const id = envValue("GOOGLE_SHEETS_DRIVE_CHANNEL_ID") || randomUUID();

const response = await drive.files.watch({
  fileId,
  requestBody: {
    id,
    type: "web_hook",
    address: webhookAddress(),
    token,
  },
});

console.log(JSON.stringify({
  ok: true,
  fileId,
  channelId: response.data.id,
  resourceId: response.data.resourceId,
  expiration: response.data.expiration,
  webhook: webhookAddress(),
}, null, 2));
