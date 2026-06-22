import { NextRequest, NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { transcribeFishAudio } from "@/lib/fishAudio";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await requireDashboardAuth();
  if (!session?.user?.email) return unauthorizedResponse();

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "No audio file uploaded" }, { status: 400 });
  }
  if (!file.type.startsWith("audio/") && file.type !== "video/webm") {
    return NextResponse.json({ ok: false, error: `Unsupported transcription file type: ${file.type}` }, { status: 415 });
  }

  try {
    const result = await transcribeFishAudio(file);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "transcription_failed";
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
}
