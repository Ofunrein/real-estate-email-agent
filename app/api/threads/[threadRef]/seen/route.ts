import { NextRequest, NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { databaseEnabled, markThreadSeenInDatabase } from "@/lib/database";
import { createRequestAudit } from "@/lib/requestAudit";

export const dynamic = "force-dynamic";

const ALLOWED_CHANNELS = new Set(["sms", "email", "instagram", "messenger", "whatsapp", "website"]);

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ threadRef: string }> },
) {
  const session = await requireDashboardAuth();
  if (!session) return unauthorizedResponse();
  if (!databaseEnabled()) return NextResponse.json({ ok: false, error: "DATABASE_URL is required" }, { status: 503 });

  const { threadRef: encodedThreadRef } = await context.params;
  const threadRef = decodeURIComponent(encodedThreadRef || "").trim();
  const audit = createRequestAudit({
    headers: request.headers,
    route: "/api/threads/[threadRef]/seen",
    method: "POST",
    provider: "dashboard",
    threadRef,
  });
  await audit.write("received", "received");
  const body = await request.json().catch(() => ({})) as { channel?: string; seenEventAt?: string };
  const channel = String(body.channel || "").trim().toLowerCase();

  if (!threadRef) {
    await audit.write("validate", "failed", { channel, statusCode: 400, errorMessage: "threadRef is required" });
    return NextResponse.json({ ok: false, error: "threadRef is required" }, { status: 400 });
  }
  if (!ALLOWED_CHANNELS.has(channel)) {
    await audit.write("validate", "failed", { channel, statusCode: 400, errorMessage: "channel is required" });
    return NextResponse.json({ ok: false, error: "channel is required" }, { status: 400 });
  }

  const state = await markThreadSeenInDatabase({
    threadRef,
    channel,
    seenBy: session.user?.email || "owner",
    seenEventAt: body.seenEventAt || "",
  });
  await audit.write("mark_seen", "sent", {
    channel,
    statusCode: 200,
    metadata: { seenEventAt: body.seenEventAt || "", seenBy: session.user?.email || "owner" },
  });
  return NextResponse.json({ ok: true, state });
}
