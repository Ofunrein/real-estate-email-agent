import { NextRequest, NextResponse } from "next/server";

import { activateTakeover, getTakeover, releaseTakeover } from "@/lib/humanTakeover";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ threadRef: string }> }) {
  const { threadRef } = await params;
  return NextResponse.json(await getTakeover(threadRef));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ threadRef: string }> }) {
  const { threadRef } = await params;
  const body = (await req.json()) as { action: "take" | "release"; channel?: string; takenBy?: string };

  if (body.action === "take") {
    if (!body.channel) return NextResponse.json({ ok: false, error: "channel required" }, { status: 400 });
    await activateTakeover(threadRef, body.channel, body.takenBy ?? "owner");
    return NextResponse.json({ ok: true, isActive: true });
  }
  if (body.action === "release") {
    await releaseTakeover(threadRef);
    return NextResponse.json({ ok: true, isActive: false });
  }
  return NextResponse.json({ ok: false, error: "action must be take|release" }, { status: 400 });
}
