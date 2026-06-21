import { NextRequest, NextResponse } from "next/server";

import { handleAriaEndOfCall, handleAriaToolCalls } from "@/lib/ariaWebhook";
import { recordChannelInteraction, vapiVoiceIngestInput } from "@/lib/channelIngest";
import { upsertVoiceCallToDatabase } from "@/lib/database";
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

    const ingest = vapiVoiceIngestInput(payload);
    const callId = ingest.threadRef?.replace(/^voice:/, "") || "";
    if ((!callId || callId === "unknown") && !ingest.phone && !ingest.messageText && !ingest.recordingUrl) {
      return NextResponse.json({ ok: true, status: "ignored", reason: "empty voice lifecycle payload" });
    }

    const hasDisplayableEvent = Boolean(
      ingest.messageText?.trim() ||
      ingest.recordingUrl?.trim() ||
      (ingest.summary?.trim() && ingest.summary !== "Voice call event received."),
    );

    if (callId && callId !== "unknown") {
      await upsertVoiceCallToDatabase({
        call_id: callId,
        thread_ref: ingest.threadRef,
        direction: ingest.direction,
        phone: ingest.phone,
        started_at: "",
        ended_at: "",
        duration_sec: 0,
        summary: ingest.summary,
        transcript: ingest.messageText,
        recording_url: ingest.recordingUrl,
      });
    }

    if (!hasDisplayableEvent) {
      return NextResponse.json({
        ok: true,
        status: callId && callId !== "unknown" ? "tracked" : "ignored",
        channel: "voice",
        threadRef: ingest.threadRef,
      });
    }

    const result = await recordChannelInteraction(ingest);
    return NextResponse.json({
      ok: true,
      channel: result.event.channel,
      thread_ref: result.event.thread_ref,
      status: result.event.status,
      action: result.event.ai_action,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to process Iris voice webhook.";
    const status = message.includes("secret") ? 401 : message.includes("DATABASE_URL") ? 503 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
