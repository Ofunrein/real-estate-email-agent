import { NextRequest, NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { cartesiaAudioEnabled, createCartesiaVoiceNote } from "@/lib/cartesiaAudio";
import { createFishVoiceNote } from "@/lib/fishAudio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await requireDashboardAuth();
  if (!session?.user?.email) return unauthorizedResponse();

  const input = (await request.json().catch(() => ({}))) as {
    text?: string;
    referenceId?: string;
    voiceId?: string;
  };
  try {
    if (cartesiaAudioEnabled() && (input.voiceId || process.env.CARTESIA_VOICE_ID || process.env.CARTESIA_REFERENCE_ID || process.env.CARTESIA_DEFAULT_VOICE_ID)) {
      const result = await createCartesiaVoiceNote({
        text: input.text || "",
        voiceId: input.voiceId,
      });
      return NextResponse.json({ ok: true, provider: "cartesia", ...result });
    }
    const result = await createFishVoiceNote({
      text: input.text || "",
      referenceId: input.referenceId,
    });
    return NextResponse.json({ ok: true, provider: "fish-audio", ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "voice_note_failed";
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
}
