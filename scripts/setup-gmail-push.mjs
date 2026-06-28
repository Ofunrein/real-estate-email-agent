#!/usr/bin/env node
// Register a Gmail Pub/Sub watch so Google pushes notifications when new emails arrive.
// This replaces the polling cron job — events fire within ~10s of message delivery.
//
// Prerequisites:
// 1. Google Cloud project with Gmail API and Pub/Sub API enabled
// 2. A Pub/Sub topic (e.g. projects/YOUR_PROJECT/topics/gmail-iris-push)
// 3. The Gmail service account / user must have "Publish" rights on the topic
// 4. A push subscription pointed at: https://app.lumenosis.com/api/webhooks/iris-gmail-push?token=YOUR_TOKEN
//
// Run: npm run setup:gmail-push
// Env: EMAIL_ACCOUNT_CLIENT_ID, GOOGLE_CLOUD_PROJECT_ID, GMAIL_PUBSUB_TOPIC, GMAIL_PUBSUB_TOKEN.
// The Pub/Sub topic project must match the Google Cloud project that owns the Gmail OAuth client.
// Auth source: app-connected Gmail OAuth account in Neon. No env-token fallback.

import fs from "node:fs";
import crypto from "node:crypto";
import { google } from "googleapis";
import pg from "pg";

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

const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID || "";
if (!projectId) {
  throw new Error("GOOGLE_CLOUD_PROJECT_ID is required. Set it to the Google Cloud project that owns the Gmail OAuth client.");
}
const topicName = process.env.GMAIL_PUBSUB_TOPIC || `projects/${projectId}/topics/gmail-iris-push`;
const pubSubToken = process.env.GMAIL_PUBSUB_TOKEN || "";
if (!pubSubToken) {
  throw new Error("GMAIL_PUBSUB_TOKEN is required. Set it explicitly; setup will not fall back to a generic webhook secret.");
}
const publicUrl = process.env.PUBLIC_BASE_URL || "https://app.lumenosis.com";
const pushEndpoint = `${publicUrl}/api/webhooks/iris-gmail-push?token=${pubSubToken}`;
const EMAIL_ACCOUNT_CLIENT_ID = process.env.EMAIL_ACCOUNT_CLIENT_ID || process.env.CLIENT_ID || "default";

function configuredClientId() {
  return process.env.GMAIL_OAUTH_CLIENT_ID
    || process.env.AUTH_GOOGLE_ID
    || process.env.GOOGLE_CLIENT_ID
    || "";
}

function configuredClientSecret() {
  return process.env.GMAIL_OAUTH_CLIENT_SECRET
    || process.env.AUTH_GOOGLE_SECRET
    || process.env.GOOGLE_CLIENT_SECRET
    || "";
}

function oauthClientFromEnv(parsed = {}) {
  const configuredId = configuredClientId();
  const configuredSecret = configuredClientSecret();
  const clientId = configuredId || parsed.client_id || "";
  const clientSecret = configuredSecret || parsed.client_secret || "";
  if (!clientId || !clientSecret) return null;
  return new google.auth.OAuth2(clientId, clientSecret);
}

function databaseEnabled() {
  return Boolean(process.env.DATABASE_URL);
}

function encryptionSecret() {
  const secret = process.env.EMAIL_ACCOUNT_ENCRYPTION_KEY
    || process.env.AUTH_SECRET
    || process.env.CHANNEL_WEBHOOK_SECRET
    || "";
  if (!secret) throw new Error("EMAIL_ACCOUNT_ENCRYPTION_KEY or AUTH_SECRET is required to read connected Gmail accounts");
  return secret;
}

function decryptEmailAccountToken(value) {
  const [version, ivRaw, tagRaw, encryptedRaw] = String(value || "").split(":");
  if (version !== "v1" || !ivRaw || !tagRaw || !encryptedRaw) {
    throw new Error("Unsupported encrypted Gmail token format");
  }
  const key = crypto.createHash("sha256").update(encryptionSecret()).digest();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, "base64url")),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString("utf8"));
}

async function readConnectedGmailAccount() {
  if (!databaseEnabled()) return null;
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
  });
  try {
    const result = await pool.query(
      `select email, token_json_encrypted, scopes
         from email_accounts
        where client_id = $1
          and provider = 'gmail'
          and is_default = true
          and status = 'connected'
        order by updated_at desc
        limit 1`,
      [EMAIL_ACCOUNT_CLIENT_ID],
    );
    const row = result.rows[0];
    if (!row?.token_json_encrypted) return null;
    return {
      email: String(row.email || ""),
      token: decryptEmailAccountToken(row.token_json_encrypted),
      scopes: Array.isArray(row.scopes) ? row.scopes : [],
    };
  } finally {
    await pool.end();
  }
}

async function buildAuth() {
  const connectedAccount = await readConnectedGmailAccount();
  if (connectedAccount?.token?.refresh_token) {
    const oauth2 = oauthClientFromEnv(connectedAccount.token);
    if (oauth2) {
      console.log(`Using connected Gmail account from database: ${connectedAccount.email || "default account"}`);
      oauth2.setCredentials(connectedAccount.token);
      return oauth2;
    }
  }

  throw new Error(`No connected Gmail account found in database for client ${EMAIL_ACCOUNT_CLIENT_ID}. Run npm run setup:gmail-auth, complete dashboard OAuth, then rerun setup:gmail-push with EMAIL_ACCOUNT_CLIENT_ID set to the dashboard tenant.`);
}

async function main() {
  console.log("=== Gmail Pub/Sub Watch Setup ===");
  console.log("Topic:", topicName);
  console.log("Push endpoint:", pushEndpoint);
  console.log("Email account client:", EMAIL_ACCOUNT_CLIENT_ID);
  console.log("");

  const auth = await buildAuth();
  const gmail = google.gmail({ version: "v1", auth });

  // Register the watch — expires every 7 days, auto-renewal via cron or re-running this script
  const watch = await gmail.users.watch({
    userId: "me",
    requestBody: {
      topicName,
      labelIds: ["INBOX"],
      labelFilterBehavior: "INCLUDE",
    },
  });

  const expiry = watch.data.expiration
    ? new Date(Number(watch.data.expiration)).toISOString()
    : "unknown";

  console.log("✓ Gmail watch registered");
  console.log("  historyId:", watch.data.historyId);
  console.log("  Expires:", expiry);
  console.log("");
  console.log("Next steps:");
  console.log("1. If you haven't already, create the Pub/Sub topic:");
  console.log(`   gcloud pubsub topics create gmail-iris-push --project=${projectId}`);
  console.log("");
  console.log("2. Grant Gmail permission to publish to the topic:");
  console.log(`   gcloud pubsub topics add-iam-policy-binding gmail-iris-push \\`);
  console.log(`     --member="serviceAccount:gmail-api-push@system.gserviceaccount.com" \\`);
  console.log(`     --role="roles/pubsub.publisher" \\`);
  console.log(`     --project=${projectId}`);
  console.log("");
  console.log("3. Create a push subscription pointing to your webhook:");
  console.log(`   gcloud pubsub subscriptions create gmail-iris-push-sub \\`);
  console.log(`     --topic=gmail-iris-push \\`);
  console.log(`     --push-endpoint="${pushEndpoint}" \\`);
  console.log(`     --ack-deadline=30 \\`);
  console.log(`     --project=${projectId}`);
  console.log("");
  console.log("4. Add to .env:");
  console.log(`   EMAIL_ACCOUNT_CLIENT_ID=${EMAIL_ACCOUNT_CLIENT_ID}`);
  console.log(`   GMAIL_PUBSUB_TOKEN=${pubSubToken || "<set CHANNEL_WEBHOOK_SECRET>"}`);
  console.log(`   GOOGLE_CLOUD_PROJECT_ID=${projectId}`);
  console.log("");
  console.log("5. Watch expires every 7 days. Add a weekly cron to renew:");
  console.log(`   0 9 * * 1 node scripts/setup-gmail-push.mjs`);
  console.log("");
  console.log("Once active, disable legacy polling:");
  console.log("  Remove ENABLE_LEGACY_IRIS_EMAIL_POLLING=1 from .env");
}

main().catch((err) => {
  console.error("Setup failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
