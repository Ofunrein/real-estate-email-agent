import { NextRequest, NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { createFishVoiceNote } from "@/lib/fishAudio";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await requireDashboardAuth();
  if (!session?.user?.email) return unauthorizedResponse();

  const input = (await request.json().catch(() => ({}))) as {
    text?: string;
    referenceId?: string;
  };
  try {
    const result = await createFishVoiceNote({
      text: input.text || "",
      referenceId: input.referenceId,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "voice_note_failed";
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
}
