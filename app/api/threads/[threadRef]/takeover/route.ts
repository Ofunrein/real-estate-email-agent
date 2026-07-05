import { NextRequest, NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { activateTakeover, getTakeover, releaseTakeover } from "@/lib/humanTakeover";
import { createRequestAudit } from "@/lib/requestAudit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ threadRef: string }> }) {
  const session = await requireDashboardAuth();
  if (!session) return unauthorizedResponse();
  const { threadRef } = await params;
  const channel = req.nextUrl.searchParams.get("channel") || undefined;
  return NextResponse.json(await getTakeover(threadRef, channel));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ threadRef: string }> }) {
  const session = await requireDashboardAuth();
  if (!session) return unauthorizedResponse();
  const { threadRef } = await params;
  const audit = createRequestAudit({
    headers: req.headers,
    route: "/api/threads/[threadRef]/takeover",
    method: "POST",
    provider: "dashboard",
    threadRef,
  });
  await audit.write("received", "received");
  const body = (await req.json()) as { action: "take" | "release"; channel?: string; takenBy?: string };

  if (body.action === "take") {
    if (!body.channel) {
      await audit.write("validate", "failed", { statusCode: 400, errorMessage: "channel required" });
      return NextResponse.json({ ok: false, error: "channel required" }, { status: 400 });
    }
    await activateTakeover(threadRef, body.channel, body.takenBy ?? session.user?.email ?? "owner");
    await audit.write("takeover", "sent", { channel: body.channel, statusCode: 200, metadata: { action: "take" } });
    return NextResponse.json({ ok: true, isActive: true });
  }
  if (body.action === "release") {
    await releaseTakeover(threadRef, body.channel);
    await audit.write("takeover", "sent", { channel: body.channel, statusCode: 200, metadata: { action: "release" } });
    return NextResponse.json({ ok: true, isActive: false });
  }
  await audit.write("validate", "failed", { channel: body.channel, statusCode: 400, errorMessage: "action must be take|release" });
  return NextResponse.json({ ok: false, error: "action must be take|release" }, { status: 400 });
}
