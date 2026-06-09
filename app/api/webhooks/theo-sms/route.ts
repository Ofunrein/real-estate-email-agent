import { NextRequest, NextResponse } from "next/server";

import { recordChannelInteraction, twilioSmsIngestInput } from "@/lib/channelIngest";
import { assertWebhookSecret, parseWebhookPayload } from "@/lib/webhookRequest";

export const dynamic = "force-dynamic";

function stringPayload(payload: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, value == null ? "" : String(value)]));
}

export async function POST(request: NextRequest) {
  try {
    assertWebhookSecret(request);
    const payload = stringPayload(await parseWebhookPayload(request));
    const result = await recordChannelInteraction(twilioSmsIngestInput(payload));
    return NextResponse.json({
      ok: true,
      channel: result.event.channel,
      status: result.event.status,
      action: result.event.ai_action,
      reply_sent: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to process Theo SMS webhook.";
    const status = message.includes("secret") ? 401 : message.includes("DATABASE_URL") ? 503 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
