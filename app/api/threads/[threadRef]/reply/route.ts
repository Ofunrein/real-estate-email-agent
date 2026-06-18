import { NextRequest, NextResponse } from "next/server";

import { recordChannelInteraction } from "@/lib/channelIngest";
import { isTakeoverActive } from "@/lib/humanTakeover";
import { sendManualReply } from "@/lib/manualReply";

export const dynamic = "force-dynamic";

type ReplyBody = {
  channel: "sms" | "whatsapp" | "email";
  to: string;
  body: string;
  mediaUrls?: string[];
  subject?: string;
  threadId?: string;
  messageId?: string;
  references?: string;
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ threadRef: string }> }) {
  const { threadRef } = await params;
  const input = (await req.json()) as ReplyBody;

  if (!input.channel || !input.to || (!input.body?.trim() && !(input.mediaUrls?.length))) {
    return NextResponse.json({ ok: false, error: "channel, to, and body/media required" }, { status: 400 });
  }

  // Guard: only send when owner has explicitly taken over this thread.
  if (!(await isTakeoverActive(threadRef))) {
    return NextResponse.json({ ok: false, error: "No active takeover for this thread" }, { status: 403 });
  }

  const result = await sendManualReply(input);
  if (!result.ok) return NextResponse.json(result, { status: 502 });

  await recordChannelInteraction({
    channel: input.channel,
    direction: "outbound",
    agentName: "Owner",
    source: "human_takeover",
    phone: input.channel !== "email" ? input.to : undefined,
    email: input.channel === "email" ? input.to : undefined,
    threadRef,
    messageText: input.body,
  });

  return NextResponse.json({ ok: true });
}
