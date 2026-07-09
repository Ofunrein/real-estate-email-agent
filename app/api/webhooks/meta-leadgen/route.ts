import { NextRequest, NextResponse } from "next/server";

import { recordChannelInteraction } from "@/lib/channelIngest";
import { claimEventDedupeInDatabase } from "@/lib/database";
import { createRequestAudit } from "@/lib/requestAudit";
import { sendTheoSms } from "@/lib/twilioSms";
import { triggerOutboundCall } from "@/lib/irisCapabilities";
import { autoCallEnabled } from "@/lib/metaLeadgenFlags";
import {
  extractLeadgenIds,
  fetchMetaLeadgenLead,
  initialLeadgenReply,
  metaLeadgenIngestInput,
  normalizeMetaLeadgenLead,
  type MetaLeadgenLead,
} from "@/lib/metaLeadgen";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function verifyToken(): string {
  return process.env.META_LEADGEN_VERIFY_TOKEN || process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || process.env.CHANNEL_WEBHOOK_SECRET || "";
}

function graphToken(): string {
  return process.env.META_LEADGEN_ACCESS_TOKEN || process.env.META_PAGE_ACCESS_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN || "";
}

function autoReplyEnabled(): boolean {
  return process.env.META_LEADGEN_AUTOREPLY !== "false";
}

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const token = request.nextUrl.searchParams.get("hub.verify_token");
  const challenge = request.nextUrl.searchParams.get("hub.challenge") || "";
  if (mode === "subscribe" && token && token === verifyToken()) return new NextResponse(challenge, { status: 200 });
  return NextResponse.json({ ok: false, error: "Verification failed" }, { status: 403 });
}

export async function POST(request: NextRequest) {
  const audit = createRequestAudit({ route: "webhooks/meta-leadgen", provider: "meta", channel: "facebook_lead_ad" });
  const payload = await request.json().catch(() => ({})) as Record<string, unknown>;
  const accessToken = graphToken();
  const leadgenIds = extractLeadgenIds(payload);
  if (!leadgenIds.length) {
    await audit.write("parse", "no_leadgen_ids", { statusCode: 200 });
    return NextResponse.json({ ok: true, processed: 0, skipped: "no_leadgen_ids" });
  }
  if (!accessToken && !Array.isArray(payload.leads)) {
    await audit.write("config", "missing_meta_leadgen_access_token", { statusCode: 503 });
    return NextResponse.json({ ok: false, error: "META_LEADGEN_ACCESS_TOKEN is required" }, { status: 503 });
  }

  const inlineLeads = Array.isArray(payload.leads) ? payload.leads.filter((lead): lead is MetaLeadgenLead => Boolean(lead && typeof lead === "object")) : [];
  const results: Record<string, unknown>[] = [];
  for (const leadgenId of leadgenIds) {
    const dedupeKey = `meta_leadgen:${leadgenId}`;
    const claim = await claimEventDedupeInDatabase({
      dedupeKey,
      channel: "facebook_lead_ad",
      provider: "meta_lead_ads",
      providerMessageId: leadgenId,
      threadRef: `meta_leadgen:${leadgenId}`,
      metadata: { object: payload.object || "page" },
    });
    if (!claim.inserted) {
      results.push({ leadgenId, duplicate: true, sent: false });
      continue;
    }

    const lead = inlineLeads.find((item) => item.id === leadgenId) || await fetchMetaLeadgenLead(leadgenId, accessToken, process.env.META_GRAPH_VERSION || "v20.0");
    const ingest = metaLeadgenIngestInput(lead);
    const normalized = normalizeMetaLeadgenLead(lead);
    await recordChannelInteraction(ingest);

    let sent = false;
    let sendStatus = "not_attempted";
    if (autoReplyEnabled() && normalized.phone && (normalized.preferredChannel === "sms" || normalized.preferredChannel === "voice" || !normalized.email)) {
      const body = initialLeadgenReply(normalized);
      const sendResult = await sendTheoSms(normalized.phone, body);
      sent = sendResult.sent;
      sendStatus = sendResult.sent ? "sent" : sendResult.error || "send_failed";
      await recordChannelInteraction({
        ...ingest,
        direction: "outbound",
        eventAt: new Date().toISOString(),
        eventType: "facebook_lead_form_speed_to_lead_sms",
        messageText: body,
        summary: `Speed-to-lead SMS: ${body}`,
        aiAction: sent ? "speed_to_lead_sent" : "speed_to_lead_failed",
        status: sent ? "sent" : "send_failed",
        outcomeCode: sendStatus,
      });
    }

    let called = false;
    let callStatus = "not_attempted";
    // Guarded by callConsent (not just preferredChannel) — TCPA/consent risk
    // is real for outbound calls, unlike a reply SMS. Dark-launched behind
    // autoCallEnabled() until Phase 3's rate-limiting/consent design lands.
    if (autoCallEnabled() && normalized.phone && normalized.callConsent && normalized.preferredChannel === "voice") {
      const callResult = await triggerOutboundCall({
        customerNumber: normalized.phone,
        leadName: normalized.fullName,
        leadEmail: normalized.email,
        callReason: "Facebook/Instagram Lead Ad speed-to-lead callback",
        trigger: "meta_leadgen",
      });
      called = callResult.ok;
      callStatus = callResult.ok ? "called" : callResult.error || "call_failed";
      await recordChannelInteraction({
        ...ingest,
        direction: "outbound",
        eventAt: new Date().toISOString(),
        eventType: "facebook_lead_form_speed_to_lead_call",
        summary: `Speed-to-lead outbound call ${called ? "placed" : "failed"} (Meta lead ad).`,
        aiAction: called ? "speed_to_lead_call_placed" : "speed_to_lead_call_failed",
        status: called ? "sent" : "send_failed",
        outcomeCode: callStatus,
      });
    }

    results.push({ leadgenId, duplicate: false, channel: normalized.preferredChannel, sent, sendStatus, called, callStatus });
  }


  await audit.write("complete", "processed", { statusCode: 200, metadata: { processed: results.length } });
  return NextResponse.json({ ok: true, processed: results.length, results });
}
