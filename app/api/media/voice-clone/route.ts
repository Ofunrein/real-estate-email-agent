import { NextRequest, NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { cloneCartesiaVoice } from "@/lib/cartesiaAudio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await requireDashboardAuth();
  if (!session?.user?.email) return unauthorizedResponse();

  const form = await request.formData();
  const title = String(form.get("title") || `${session.user.email} voice`);
  const files = form.getAll("file").filter((item): item is File => item instanceof File);
  const texts = form.getAll("text").map((item) => String(item || ""));

  if (!files.length) {
    return NextResponse.json({ ok: false, error: "Upload at least one voice sample" }, { status: 400 });
  }
  if (files.some((file) => !file.type.startsWith("audio/") && file.type !== "video/webm")) {
    return NextResponse.json({ ok: false, error: "Voice clone samples must be audio files" }, { status: 415 });
  }

  try {
    const result = await cloneCartesiaVoice({
      title,
      files,
      description: texts.find((text) => text.trim()),
    });
    return NextResponse.json({ ok: true, provider: "cartesia", voiceId: result.id, title: result.title, state: result.state });
  } catch (error) {
    const message = error instanceof Error ? error.message : "voice_clone_failed";
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
}
