import { NextRequest, NextResponse } from "next/server";

import { recordChannelInteraction, vapiVoiceIngestInput } from "@/lib/channelIngest";
import { assertWebhookSecret, parseWebhookPayload } from "@/lib/webhookRequest";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    assertWebhookSecret(request);
    const payload = await parseWebhookPayload(request);
    const result = await recordChannelInteraction(vapiVoiceIngestInput(payload));
    return NextResponse.json({
      ok: true,
      channel: result.event.channel,
      thread_ref: result.event.thread_ref,
      status: result.event.status,
      action: result.event.ai_action,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to process Aria voice webhook.";
    const status = message.includes("secret") ? 401 : message.includes("DATABASE_URL") ? 503 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
