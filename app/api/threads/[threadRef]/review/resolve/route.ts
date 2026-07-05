import { NextRequest, NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { recordChannelInteraction } from "@/lib/channelIngest";
import { databaseEnabled, updateAiDraftStatusInDatabase } from "@/lib/database";
import { releaseTakeover } from "@/lib/humanTakeover";
import { createRequestAudit } from "@/lib/requestAudit";
import type { Channel } from "@/lib/inboxData";

export const dynamic = "force-dynamic";

const ALLOWED_CHANNELS = new Set(["email", "sms", "whatsapp", "instagram", "messenger", "website_chat", "website"]);

function normalizeChannel(value: string): Exclude<Channel, "voice" | "unknown"> | "" {
  const channel = value.trim().toLowerCase();
  if (channel === "website") return "website_chat";
  if (ALLOWED_CHANNELS.has(channel)) return channel as Exclude<Channel, "voice" | "unknown">;
  return "";
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ threadRef: string }> }) {
  const session = await requireDashboardAuth();
  if (!session) return unauthorizedResponse();
  const { threadRef } = await params;
  const audit = createRequestAudit({
    headers: request.headers,
    route: "/api/threads/[threadRef]/review/resolve",
    method: "POST",
    provider: "dashboard",
    threadRef,
  });
  await audit.write("received", "received");

  const body = await request.json().catch(() => ({})) as {
    channel?: string;
    resolution?: "resume_ai";
    note?: string;
    releaseTakeover?: boolean;
  };
  const channel = normalizeChannel(String(body.channel || ""));
  if (body.resolution !== "resume_ai") {
    await audit.write("validate", "failed", { channel, statusCode: 400, errorMessage: "resolution must be resume_ai" });
    return NextResponse.json({ ok: false, error: "resolution must be resume_ai" }, { status: 400 });
  }
  if (!channel) {
    await audit.write("validate", "failed", { statusCode: 400, errorMessage: "channel is required" });
    return NextResponse.json({ ok: false, error: "channel is required" }, { status: 400 });
  }
  if (!databaseEnabled()) {
    await audit.write("validate", "failed", { channel, statusCode: 503, errorMessage: "DATABASE_URL is required" });
    return NextResponse.json({ ok: false, error: "DATABASE_URL is required" }, { status: 503 });
  }

  await updateAiDraftStatusInDatabase({ threadRef, channel, status: "dismissed" });
  if (body.releaseTakeover) await releaseTakeover(threadRef, channel);
  await recordChannelInteraction({
    channel,
    direction: "outbound",
    agentName: "Owner",
    source: "human_review",
    threadRef,
    eventType: `${channel}_review_resolved`,
    messageText: body.note?.trim() || "Human review cleared. AI can continue.",
    summary: body.note?.trim() || "Human review cleared from dashboard.",
    aiAction: "resume_ai",
    status: "review_resolved",
    nextAction: "ai_active",
    handoffReason: "",
  });
  await audit.write("review_resolve", "sent", {
    channel,
    statusCode: 200,
    metadata: { resolution: body.resolution, releaseTakeover: Boolean(body.releaseTakeover), notePreview: body.note?.slice(0, 160) || "" },
  });
  return NextResponse.json({ ok: true, status: "review_resolved" });
}
