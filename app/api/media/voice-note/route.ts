import { NextRequest, NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { cartesiaAudioEnabled, createCartesiaVoiceNote } from "@/lib/cartesiaAudio";
import { createDeepgramVoiceNote, deepgramAudioEnabled } from "@/lib/deepgramAudio";
import { createRequestAudit } from "@/lib/requestAudit";
import { blockLoadTestMutation, providerDryRunEnabled } from "@/lib/loadTestGuard";
import { checkVoiceNoteRateLimit, getCachedVoiceNote, setCachedVoiceNote, voiceNoteCacheKey } from "@/lib/voiceNoteCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const loadTestBlock = blockLoadTestMutation(request);
  if (loadTestBlock) return loadTestBlock;

  const session = await requireDashboardAuth();
  if (!session?.user?.email) return unauthorizedResponse();
  const audit = createRequestAudit({
    headers: request.headers,
    route: "/api/media/voice-note",
    method: "POST",
    provider: "voice-note",
  });
  await audit.write("received", "received");

  const input = (await request.json().catch(() => ({}))) as {
    text?: string;
    referenceId?: string;
    voiceId?: string;
    model?: string;
    provider?: "deepgram" | "cartesia";
    threadRef?: string;
    channel?: string;
    smsCompatible?: boolean;
  };

  try {
    const provider = (input.provider || process.env.VOICE_GENERATION_PROVIDER || "deepgram") as "deepgram" | "cartesia";
    const text = input.text || "";
    const voiceId = input.voiceId || input.referenceId || "";
    const smsCompatible = Boolean(input.smsCompatible || ["sms", "whatsapp"].includes(String(input.channel || "").toLowerCase()));
    const cacheKey = voiceNoteCacheKey({ provider, text, voiceId, model: input.model, smsCompatible });
    const cached = getCachedVoiceNote(cacheKey);
    if (cached) {
      await audit.write("voice_note", "sent", { threadRef: input.threadRef, statusCode: 200, provider, metadata: { cache: "hit" } });
      return NextResponse.json({ ok: true, provider, cached: true, ...cached });
    }

    const limit = checkVoiceNoteRateLimit(session.user.email || "unknown");
    if (!limit.ok) {
      await audit.write("voice_note", "failed", {
        threadRef: input.threadRef,
        statusCode: 429,
        errorCode: "voice_note_rate_limited",
        errorMessage: "Voice note generation rate limit exceeded.",
      });
      return NextResponse.json({ ok: false, error: "Voice note generation rate limit exceeded." }, {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      });
    }

    if (providerDryRunEnabled()) {
      return NextResponse.json({ ok: true, provider, dryRun: true, url: "", filename: "", contentType: "audio/mpeg", storage: "dry-run" });
    }

    if (provider === "cartesia") {
      if (!cartesiaAudioEnabled()) {
        await audit.write("voice_note", "failed", {
          threadRef: input.threadRef,
          statusCode: 503,
          errorCode: "cartesia_missing_key",
          errorMessage: "CARTESIA_API_KEY is required for Cartesia voice notes.",
        });
        return NextResponse.json({ ok: false, error: "CARTESIA_API_KEY is required for Cartesia voice notes." }, { status: 503 });
      }
      const result = await createCartesiaVoiceNote({
        text,
        voiceId,
        requestUrl: request.url,
        threadRef: input.threadRef,
        smsCompatible,
      });
      setCachedVoiceNote(cacheKey, result);
      await audit.write("voice_note", "sent", {
        threadRef: input.threadRef,
        statusCode: 200,
        provider: "cartesia",
        metadata: { textPreview: text.slice(0, 160), voiceId, cache: "miss" },
      });
      return NextResponse.json({ ok: true, provider: "cartesia", ...result });
    }

    if (!deepgramAudioEnabled()) {
      await audit.write("voice_note", "failed", {
        threadRef: input.threadRef,
        statusCode: 503,
        errorCode: "deepgram_missing_key",
        errorMessage: "DEEPGRAM_API_KEY is required for Deepgram voice notes.",
      });
      return NextResponse.json({ ok: false, error: "DEEPGRAM_API_KEY is required for Deepgram voice notes." }, { status: 503 });
    }

    const result = await createDeepgramVoiceNote({
      text,
      model: input.model || voiceId,
      requestUrl: request.url,
      threadRef: input.threadRef,
      smsCompatible,
    });
    setCachedVoiceNote(cacheKey, result);
    await audit.write("voice_note", "sent", {
      threadRef: input.threadRef,
      statusCode: 200,
      provider: "deepgram",
      metadata: { textPreview: text.slice(0, 160), model: result.model, cache: "miss" },
    });
    return NextResponse.json({ ok: true, provider: "deepgram", ...result });
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
