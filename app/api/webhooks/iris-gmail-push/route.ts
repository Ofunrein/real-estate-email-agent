import { NextRequest, NextResponse } from "next/server";

import { databaseEnabled, readInboxSettingsFromDatabase } from "@/lib/database";
import { createIrisGmailSession } from "@/lib/gmailConnection";
import { processIrisEmailPoll, type IrisEmailPollOptions } from "@/lib/irisEmail";
import { channelEnabled, shouldAutoSendForChannel } from "@/lib/inboxSettings";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Gmail Pub/Sub push webhook — receives real-time notifications when new messages arrive.
// Google posts a JSON body: { "message": { "data": "<base64>", "messageId": "..." }, "subscription": "..." }
// The base64 data decodes to: { "emailAddress": "user@example.com", "historyId": "12345" }
//
// Setup: run `npm run setup:gmail-push` to register the Gmail watch.
// Env: GMAIL_PUBSUB_TOKEN (must match what you configured in Google Cloud Pub/Sub subscription push config)
//
// This replaces polling (ENABLE_LEGACY_IRIS_EMAIL_POLLING). It fires within ~10s of message arrival.

function authorized(request: NextRequest): boolean {
  const token = process.env.GMAIL_PUBSUB_TOKEN || process.env.CHANNEL_WEBHOOK_SECRET || "";
  if (!token) return false;
  // Google sends the token as a query param in the push endpoint URL you configured
  return request.nextUrl.searchParams.get("token") === token;
}

type PubSubMessage = {
  data?: string;
  messageId?: string;
  publishTime?: string;
};

type PubSubPayload = {
  message?: PubSubMessage;
  subscription?: string;
};

type GmailHistoryData = {
  emailAddress?: string;
  historyId?: string | number;
};

function decodePubSubData(data: string): GmailHistoryData {
  try {
    return JSON.parse(Buffer.from(data, "base64").toString("utf-8")) as GmailHistoryData;
  } catch {
    return {};
  }
}

async function getNewMessageIdsSinceHistory(historyId: string): Promise<string[]> {
  const session = await createIrisGmailSession();
  const response = await session.gmail.users.history.list({
    userId: "me",
    startHistoryId: historyId,
    historyTypes: ["messageAdded"],
    labelId: "INBOX",
  });
  const history = response.data.history || [];
  const ids: string[] = [];
  for (const record of history) {
    for (const added of record.messagesAdded || []) {
      if (added.message?.id && !ids.includes(added.message.id)) {
        ids.push(added.message.id);
      }
    }
  }
  return ids;
}

export async function POST(request: NextRequest) {
  // Always return 200 to Pub/Sub — non-200 triggers retries
  const ack = () => NextResponse.json({ ok: true });

  if (!authorized(request)) {
    // Log but ACK — returning 4xx causes Pub/Sub to retry indefinitely
    console.warn("iris_gmail_push: unauthorized request, acking to suppress retries");
    return ack();
  }

  let payload: PubSubPayload;
  try {
    payload = await request.json() as PubSubPayload;
  } catch {
    return ack();
  }

  const messageData = payload.message?.data;
  if (!messageData) return ack();

  const historyData = decodePubSubData(messageData);
  const historyId = String(historyData.historyId || "").trim();

  console.info("iris_gmail_push_received", JSON.stringify({
    historyId,
    emailAddress: historyData.emailAddress,
    pubSubMessageId: payload.message?.messageId,
  }));

  if (!historyId) return ack();

  // Fire-and-forget processing so we ACK Pub/Sub immediately (must respond within 10s)
  setImmediate(async () => {
    try {
      const settings = databaseEnabled() ? await readInboxSettingsFromDatabase() : undefined;
      if (settings && !channelEnabled(settings, "email")) {
        console.info("iris_gmail_push: email channel disabled, skipping");
        return;
      }
      const sendReplies = !settings || shouldAutoSendForChannel(settings, "email");
      const emailLive = process.env.IRIS_EMAIL_LIVE === "true";
      const sendRepliesEnabled = process.env.IRIS_EMAIL_SEND_REPLIES === "true" && emailLive && sendReplies;

      // Find new message IDs from Gmail history API
      let messageIds: string[] = [];
      try {
        messageIds = await getNewMessageIdsSinceHistory(historyId);
      } catch (err) {
        // History may have expired or historyId is too old — fall back to poll
        console.warn("iris_gmail_push: history fetch failed, falling back to poll", err instanceof Error ? err.message : err);
      }

      const pollOptions: IrisEmailPollOptions = {
        dryRun: !emailLive,
        sendReplies: sendRepliesEnabled,
        limit: messageIds.length > 0 ? messageIds.length : 5,
      };

      const result = await processIrisEmailPoll(pollOptions);
      console.info("iris_gmail_push_processed", JSON.stringify({
        historyId,
        processed: result.processed,
        sent: result.sent,
        dryRun: pollOptions.dryRun,
      }));
    } catch (err) {
      console.error("iris_gmail_push_error", err instanceof Error ? err.message : err);
    }
  });

  return ack();
}

// GET: health check for Pub/Sub subscription verification
export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, channel: "iris_gmail_push", status: "listening" });
}
