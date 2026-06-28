import { NextRequest, NextResponse } from "next/server";

import { activateTakeover, getTakeover, releaseTakeover } from "@/lib/humanTakeover";
import { createRequestAudit } from "@/lib/requestAudit";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ threadRef: string }> }) {
  const { threadRef } = await params;
  return NextResponse.json(await getTakeover(threadRef));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ threadRef: string }> }) {
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
    await activateTakeover(threadRef, body.channel, body.takenBy ?? "owner");
    await audit.write("takeover", "sent", { channel: body.channel, statusCode: 200, metadata: { action: "take" } });
    return NextResponse.json({ ok: true, isActive: true });
  }
  if (body.action === "release") {
    await releaseTakeover(threadRef);
    await audit.write("takeover", "sent", { channel: body.channel, statusCode: 200, metadata: { action: "release" } });
    return NextResponse.json({ ok: true, isActive: false });
  }
  await audit.write("validate", "failed", { channel: body.channel, statusCode: 400, errorMessage: "action must be take|release" });
  return NextResponse.json({ ok: false, error: "action must be take|release" }, { status: 400 });
}
