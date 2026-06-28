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
// Env: GOOGLE_CLOUD_PROJECT_ID, GMAIL_PUBSUB_TOPIC, GMAIL_PUBSUB_TOKEN, GOOGLE_REFRESH_TOKEN etc.

import fs from "node:fs";
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

const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID || "code-496619";
const topicName = process.env.GMAIL_PUBSUB_TOPIC || `projects/${projectId}/topics/gmail-iris-push`;
const pubSubToken = process.env.GMAIL_PUBSUB_TOKEN || process.env.CHANNEL_WEBHOOK_SECRET || "";
const publicUrl = process.env.PUBLIC_BASE_URL || "https://app.lumenosis.com";
const pushEndpoint = `${publicUrl}/api/webhooks/iris-gmail-push?token=${pubSubToken}`;

// Build Gmail auth from stored token
function buildAuth() {
  const clientId = process.env.GOOGLE_CLIENT_ID || "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN || "";
  if (!clientId || !clientSecret || !refreshToken) {
    // Try GMAIL_TOKEN_JSON
    const tokenJson = process.env.GMAIL_TOKEN_JSON || "";
    if (tokenJson) {
      try {
        const parsed = JSON.parse(tokenJson);
        const oauth2 = new google.auth.OAuth2(parsed.client_id, parsed.client_secret);
        oauth2.setCredentials({ refresh_token: parsed.refresh_token });
        return oauth2;
      } catch { /* fall through */ }
    }
    throw new Error("Missing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN (or GMAIL_TOKEN_JSON)");
  }
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  return oauth2;
}

async function main() {
  console.log("=== Gmail Pub/Sub Watch Setup ===");
  console.log("Topic:", topicName);
  console.log("Push endpoint:", pushEndpoint);
  console.log("");

  const auth = buildAuth();
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
