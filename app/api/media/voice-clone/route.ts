import { NextRequest, NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { normalizeVoiceCloneSample } from "@/lib/audioTranscode";
import { cloneCartesiaVoice } from "@/lib/cartesiaAudio";
import { createRequestAudit } from "@/lib/requestAudit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await requireDashboardAuth();
  if (!session?.user?.email) return unauthorizedResponse();
  const audit = createRequestAudit({
    headers: request.headers,
    route: "/api/media/voice-clone",
    method: "POST",
    provider: "cartesia",
  });
  await audit.write("received", "received");

  const form = await request.formData();
  const title = String(form.get("title") || `${session.user.email} voice`);
  const files = form.getAll("file").filter((item): item is File => item instanceof File);
  const texts = form.getAll("text").map((item) => String(item || ""));

  if (!files.length) {
    await audit.write("voice_clone", "failed", { statusCode: 400, errorMessage: "Upload at least one voice sample" });
    return NextResponse.json({ ok: false, error: "Upload at least one voice sample" }, { status: 400 });
  }
  if (files.some((file) => !file.type.startsWith("audio/") && file.type !== "video/webm")) {
    await audit.write("voice_clone", "failed", { statusCode: 415, errorMessage: "Voice clone samples must be audio files" });
    return NextResponse.json({ ok: false, error: "Voice clone samples must be audio files" }, { status: 415 });
  }

  try {
    const normalizedFiles = await Promise.all(files.map((file) => normalizeVoiceCloneSample(file)));
    const result = await cloneCartesiaVoice({
      title,
      files: normalizedFiles,
      description: texts.find((text) => text.trim()),
    });
    await audit.write("voice_clone", "sent", {
      statusCode: 200,
      metadata: { fileCount: files.length, voiceId: result.id, state: result.state },
    });
    return NextResponse.json({ ok: true, provider: "cartesia", voiceId: result.id, title: result.title, state: result.state });
  } catch (error) {
    const message = error instanceof Error ? error.message : "voice_clone_failed";
    await audit.write("voice_clone", "failed", {
      statusCode: 503,
      errorCode: "voice_clone_failed",
      errorMessage: message,
      metadata: { fileCount: files.length },
    });
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
}
