import { type NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { allowRequest, clientAddress } from "@/lib/demo-rate-limit";
import { demoPostgresEnabled, reservePostgresVoiceSession } from "@/lib/demo-postgres";
import { demoRoomForToken } from "@/lib/demo-room";
import { demoVoiceOverrides } from "@/lib/demo-voice";
import { reserveTursoVoiceSession } from "@/lib/demo-voice-budget";
import { sql } from "@/lib/turso";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const admin = await isAdmin();
  const match = await demoRoomForToken(token, admin);
  if (!match) return NextResponse.json({ error: "Demo not found" }, { status: 404 });
  if (match.expired) return NextResponse.json({ error: "Demo expired" }, { status: 410 });

  // Per-IP burst guard. This stays in-process on purpose: it is cheap, and its only job is to
  // blunt one client hammering the endpoint. It is NOT the spend cap.
  const key = `${token}:${clientAddress(request.headers)}:voice`;
  if (!admin && !allowRequest(key, 10, 24 * 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Voice demo limit reached" }, { status: 429 });
  }

  // Persist reservations in the selected database, never just in serverless memory.
  // Admin previews do not burn the prospect's budget.
  let remainingCalls: number | null = null;
  if (!admin) {
    let remaining = -1;
    try {
      remaining = demoPostgresEnabled()
        ? await reservePostgresVoiceSession(token)
        : await reserveTursoVoiceSession(match.id, sql);
    } catch {
      // Fail closed. A database blip must not silently become unlimited paid voice minutes.
      return NextResponse.json({ error: "Voice demo is unavailable" }, { status: 503 });
    }
    if (remaining < 0) {
      return NextResponse.json({ error: "Voice demo limit reached" }, { status: 429 });
    }
    remainingCalls = remaining;
  }

  const publicKey = process.env.VAPI_PUBLIC_KEY;
  const assistantId = process.env.VAPI_DEMO_ASSISTANT_ID;
  if (!publicKey || !assistantId)
    return NextResponse.json({ error: "Voice demo is not configured" }, { status: 503 });

  return NextResponse.json(
    {
      publicKey,
      assistantId,
      assistantOverrides: demoVoiceOverrides(match.room),
      callLimit: admin ? null : 10,
      remainingCalls,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
