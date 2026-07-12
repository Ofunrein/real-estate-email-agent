import { NextRequest, NextResponse } from "next/server";

import { inngest } from "@/lib/inngest/client";
import { leadCaptureDedupeKey, type LeadCapturePayload } from "@/lib/leadContext";
import type { Channel } from "@/lib/inboxData";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorized(request: NextRequest): boolean {
  const expected = process.env.LEAD_CAPTURE_WEBHOOK_SECRET || process.env.CHANNEL_WEBHOOK_SECRET || "";
  if (!expected) return false;
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  return bearer === expected || request.headers.get("x-webhook-secret") === expected;
}

function channel(payload: LeadCapturePayload): Channel {
  const preferred = String(payload.lead?.preferred_channel || "").toLowerCase();
  if (["sms", "whatsapp", "instagram", "messenger", "email", "website_chat"].includes(preferred)) return preferred as Channel;
  if (payload.lead?.phone) return "sms";
  if (payload.lead?.email) return "email";
  return "website_chat";
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const payload = await request.json().catch(() => null) as LeadCapturePayload | null;
  if (!payload?.provider || !payload.source_type || !payload.lead || (!payload.lead.phone && !payload.lead.email && !payload.lead.name)) {
    return NextResponse.json({ ok: false, error: "invalid_lead_capture_payload" }, { status: 400 });
  }
  const dedupeKey = leadCaptureDedupeKey(payload, request.headers.get("idempotency-key") || "");
  const selectedChannel = channel(payload);
  const contactRef = selectedChannel === "email" ? payload.lead.email || "" : payload.lead.phone || payload.lead.email || "";
  const threadRef = `${payload.provider}:${payload.source_id || dedupeKey}`;
  await inngest.send({
    name: "message.received",
    data: {
      channel: selectedChannel,
      provider: payload.provider,
      providerMessageId: payload.source_id || dedupeKey,
      threadRef,
      contactRef,
      text: payload.message || "New lead captured",
      receivedAt: new Date().toISOString(),
      providerMetadata: {
        source_type: payload.source_type,
        source_id: payload.source_id || "",
        campaign: payload.campaign || {},
        clicked_property: payload.clicked_property || {},
        behavior: payload.behavior || {},
        consent: payload.consent || {},
        lead: payload.lead,
        raw: payload.metadata || {},
        captureDedupeKey: dedupeKey,
      },
    },
  });
  return NextResponse.json({ ok: true, accepted: true, dedupeKey, channel: selectedChannel }, { status: 202 });
}
