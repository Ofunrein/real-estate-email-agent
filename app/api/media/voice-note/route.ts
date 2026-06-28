import { NextRequest, NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { cartesiaAudioEnabled, createCartesiaVoiceNote } from "@/lib/cartesiaAudio";
import { createRequestAudit } from "@/lib/requestAudit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await requireDashboardAuth();
  if (!session?.user?.email) return unauthorizedResponse();
  const audit = createRequestAudit({
    headers: request.headers,
    route: "/api/media/voice-note",
    method: "POST",
    provider: "cartesia",
  });
  await audit.write("received", "received");

  const input = (await request.json().catch(() => ({}))) as {
    text?: string;
    referenceId?: string;
    voiceId?: string;
    threadRef?: string;
  };
  try {
    if (!cartesiaAudioEnabled()) {
      await audit.write("voice_note", "failed", {
        threadRef: input.threadRef,
        statusCode: 503,
        errorCode: "cartesia_missing_key",
        errorMessage: "CARTESIA_API_KEY is required for voice notes.",
      });
      return NextResponse.json({ ok: false, error: "CARTESIA_API_KEY is required for voice notes." }, { status: 503 });
    }
    const result = await createCartesiaVoiceNote({
      text: input.text || "",
      voiceId: input.voiceId || input.referenceId,
      requestUrl: request.url,
      threadRef: input.threadRef,
    });
    await audit.write("voice_note", "sent", {
      threadRef: input.threadRef,
      statusCode: 200,
      metadata: { textPreview: input.text?.slice(0, 160) || "", voiceId: input.voiceId || input.referenceId || "" },
    });
    return NextResponse.json({ ok: true, provider: "cartesia", ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "voice_note_failed";
    await audit.write("voice_note", "failed", {
      threadRef: input.threadRef,
      statusCode: 503,
      errorCode: "voice_note_failed",
      errorMessage: message,
    });
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
}
