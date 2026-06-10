import { NextRequest, NextResponse } from "next/server";

import { handleAriaEndOfCall, handleAriaToolCalls } from "@/lib/ariaWebhook";
import { recordChannelInteraction, vapiVoiceIngestInput } from "@/lib/channelIngest";
import { messageType, parseToolCalls } from "@/lib/vapi";
import { assertWebhookSecret, parseWebhookPayload } from "@/lib/webhookRequest";

export const dynamic = "force-dynamic";

// Vapi lifecycle webhook for Aria. Routes by message type:
//  - end-of-call-report → persist voice_calls + conversation event
//  - tool-calls (catch-all if a tool lacks its own server url) → dispatch
//  - everything else (status-update, etc.) → log via the existing ingest
export async function POST(request: NextRequest) {
  try {
    assertWebhookSecret(request);
    const payload = await parseWebhookPayload(request);
    const type = messageType(payload);

    if (type === "end-of-call-report" || type === "end-of-call") {
      const call = await handleAriaEndOfCall(payload);
      return NextResponse.json({ ok: true, call_id: call.call_id, status: "logged" });
    }

    if (type === "tool-calls" || type === "function-call" || parseToolCalls(payload).length) {
      const body = await handleAriaToolCalls(payload);
      return NextResponse.json(body);
    }

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
