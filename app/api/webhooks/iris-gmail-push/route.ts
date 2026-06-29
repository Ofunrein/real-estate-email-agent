import { NextRequest, NextResponse } from "next/server";

import { inngest } from "@/lib/inngest/client";
import { createRequestAudit } from "@/lib/requestAudit";

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
// The webhook only validates and queues durable Inngest work; it does not run
// Gmail processing after the HTTP response because Vercel can freeze the lambda.

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

export async function POST(request: NextRequest) {
  // ACK unauthorized/bad payloads to avoid retry storms. For valid Gmail events,
  // return non-200 if durable queueing fails so Pub/Sub retries.
  const ack = () => NextResponse.json({ ok: true });
  const audit = createRequestAudit({
    headers: request.headers,
    route: "/api/webhooks/iris-gmail-push",
    method: "POST",
    channel: "email",
    provider: "gmail_pubsub",
  });

  if (!authorized(request)) {
    // Log but ACK — returning 4xx causes Pub/Sub to retry indefinitely
    console.warn("iris_gmail_push: unauthorized request, acking to suppress retries");
    await audit.write("auth", "blocked", { statusCode: 200, errorCode: "unauthorized_pubsub_push" });
    return ack();
  }

  let payload: PubSubPayload;
  try {
    payload = await request.json() as PubSubPayload;
  } catch {
    await audit.write("parse", "skipped", { statusCode: 200, errorCode: "invalid_pubsub_json" });
    return ack();
  }

  const messageData = payload.message?.data;
  if (!messageData) {
    await audit.write("parse", "skipped", { statusCode: 200, errorCode: "missing_pubsub_data" });
    return ack();
  }

  const historyData = decodePubSubData(messageData);
  const historyId = String(historyData.historyId || "").trim();
  const pubSubMessageId = payload.message?.messageId || "";

  console.info("iris_gmail_push_received", JSON.stringify({
    historyId,
    emailAddress: historyData.emailAddress,
    pubSubMessageId,
  }));
  await audit.write("received", "received", {
    contactRef: historyData.emailAddress || "",
    providerMessageId: pubSubMessageId || historyId,
    metadata: {
      historyId,
      emailAddress: historyData.emailAddress || "",
      pubSubMessageId,
      subscription: payload.subscription || "",
    },
  });

  if (!historyId) {
    await audit.write("validate", "skipped", {
      contactRef: historyData.emailAddress || "",
      providerMessageId: pubSubMessageId,
      statusCode: 200,
      errorCode: "missing_history_id",
    });
    return ack();
  }

  try {
    await inngest.send({
      name: "gmail.push.received",
      data: {
        historyId,
        emailAddress: historyData.emailAddress || "",
        pubSubMessageId,
        receivedAt: new Date().toISOString(),
      },
    });
    console.info("iris_gmail_push_queued", JSON.stringify({
      historyId,
      emailAddress: historyData.emailAddress,
      pubSubMessageId,
    }));
    await audit.write("queued", "sent", {
      contactRef: historyData.emailAddress || "",
      providerMessageId: pubSubMessageId || historyId,
      statusCode: 200,
      metadata: { historyId },
    });
    return ack();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("iris_gmail_push_queue_error", message);
    await audit.write("queued", "failed", {
      contactRef: historyData.emailAddress || "",
      providerMessageId: pubSubMessageId || historyId,
      statusCode: 503,
      errorCode: "inngest_queue_failed",
      errorMessage: message,
      metadata: { historyId },
    });
    return NextResponse.json({ ok: false, error: "Unable to queue Gmail push" }, { status: 503 });
  }
}

// GET: health check for Pub/Sub subscription verification
export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, channel: "iris_gmail_push", status: "listening" });
}
