import { NextRequest, NextResponse } from "next/server";

import { recordChannelInteraction, smsControlAction, twilioSmsIngestInput, type ChannelIngestInput } from "@/lib/channelIngest";
import { findCandidatePropertiesFromDatabase, findLeadInDatabase, findPropertiesByAddressesFromDatabase, readEventsForThreadFromDatabase } from "@/lib/database";
import { generateTheoReply } from "@/lib/theoAgent";
import { enrichTheoData, extractTheoListedPropertyAddresses, extractTheoPropertySearchQuery } from "@/lib/theoData";
import { addTheoSessionCost, elapsedMs, formatUsd, nowMs, theoSessionCost, type TheoMetric } from "@/lib/theoTelemetry";
import { sendTheoHandoffAlert, sendTheoSms, smsMessageWithMediaLog } from "@/lib/twilioSms";
import { assertWebhookSecret, parseWebhookPayload } from "@/lib/webhookRequest";

export const dynamic = "force-dynamic";

function stringPayload(payload: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, value == null ? "" : String(value)]));
}

type TheoOutboundInput = Omit<ChannelIngestInput, "channel" | "direction" | "agentName" | "source" | "preferredChannel">;

function maskPhone(value = "") {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return value || "unknown";
  return `***${digits.slice(-4)}`;
}

function logTheo(message: string, details: Record<string, unknown> = {}) {
  const safeDetails = Object.fromEntries(
    Object.entries(details).map(([key, value]) => {
      if (key.toLowerCase().includes("phone") || key.toLowerCase() === "from" || key.toLowerCase() === "to") {
        return [key, maskPhone(String(value || ""))];
      }
      return [key, value];
    }),
  );
  console.info(`[Theo SMS] ${message}`, safeDetails);
}

function logTheoMetrics(metrics: TheoMetric[]) {
  for (const metric of metrics) {
    const sessionTotal = addTheoSessionCost(metric.costUsd || 0);
    logTheo("metric", {
      service: metric.service,
      label: metric.label,
      status: metric.status,
      elapsedMs: metric.elapsedMs,
      cost: formatUsd(metric.costUsd || 0),
      sessionCost: formatUsd(sessionTotal),
      detail: metric.detail || "",
    });
  }
}

function referencesPriorProperties(message = ""): boolean {
  return /\b(those|that|these|them|links?|urls?|photos?|pictures?)\b/i.test(message);
}

async function recordTheoOutbound(input: TheoOutboundInput) {
  return recordChannelInteraction({
    ...input,
    eventType: input.eventType || "sms_outbound",
    channel: "sms",
    direction: "outbound",
    agentName: "Theo",
    source: "twilio",
    preferredChannel: "sms",
  });
}

export async function POST(request: NextRequest) {
  const requestStarted = nowMs();
  try {
    assertWebhookSecret(request);
    const parseStarted = nowMs();
    const payload = stringPayload(await parseWebhookPayload(request));
    logTheo("inbound received", {
      from: payload.From,
      to: payload.To,
      messageSid: payload.MessageSid || "",
      bodyPreview: (payload.Body || "").slice(0, 120),
      parseMs: elapsedMs(parseStarted),
    });
    const inboundInput = twilioSmsIngestInput(payload);
    const inboundWriteStarted = nowMs();
    const result = await recordChannelInteraction(inboundInput);
    logTheo("inbound logged", {
      threadRef: result.event.thread_ref,
      eventType: result.event.event_type,
      elapsedMs: elapsedMs(inboundWriteStarted),
      totalMs: elapsedMs(requestStarted),
    });
    const controlAction = smsControlAction(payload.Body || "");

    if (controlAction === "stop") {
      logTheo("opt-out recorded", { from: payload.From, threadRef: result.event.thread_ref, totalMs: elapsedMs(requestStarted) });
      return NextResponse.json({
        ok: true,
        channel: result.event.channel,
        status: result.event.status,
        action: result.event.ai_action,
        reply_sent: false,
      });
    }

    if (controlAction === "start" || controlAction === "help") {
      const body = controlAction === "start"
        ? "You're opted back in. What home or area can I help with?"
        : "Theo with Austin Realty here. Reply with the home or area you're asking about, or STOP to opt out.";
      const controlSendStarted = nowMs();
      const sendResult = await sendTheoSms(payload.From || "", body);
      const controlSendMs = elapsedMs(controlSendStarted);
      let handoffAlertSent = false;
      let handoffAlertError = "";
      if (controlAction === "help") {
        const alertStarted = nowMs();
        const alertResult = await sendTheoHandoffAlert({
          leadPhone: payload.From || "",
          leadName: payload.ProfileName || "",
          reason: "Lead asked for SMS help",
          summary: payload.Body || "HELP",
          threadRef: result.event.thread_ref,
        });
        handoffAlertSent = alertResult.sent;
        handoffAlertError = alertResult.error;
        logTheo("handoff alert processed", {
          leadPhone: payload.From,
          sent: handoffAlertSent,
          elapsedMs: elapsedMs(alertStarted),
          error: handoffAlertError,
        });
      }
      logTheo("control reply processed", {
        action: controlAction,
        leadPhone: payload.From,
        replySent: sendResult.sent,
        replyStatus: sendResult.sent ? "sent" : sendResult.skipped ? "skipped" : "send_failed",
        elapsedMs: controlSendMs,
        sendError: sendResult.error || "",
        handoffAlertSent,
        handoffAlertError,
      });
      const outboundWriteStarted = nowMs();
      await recordTheoOutbound({
        phone: payload.From || "",
        fullName: payload.ProfileName || "",
        sourceDetail: payload.To ? `to ${payload.To}` : "",
        threadRef: result.event.thread_ref,
        messageText: body,
        summary: controlAction === "start" ? "Theo sent SMS opt-in confirmation." : "Theo sent SMS help response.",
        aiAction: sendResult.sent ? "control_reply_sent" : "control_reply_generated",
        status: sendResult.sent ? "sent" : sendResult.skipped ? "skipped" : "send_failed",
        handoffReason: sendResult.error,
        nextAction: controlAction === "help" ? "human_follow_up" : "await_response",
      });
      logTheo("outbound logged", {
        leadPhone: payload.From,
        elapsedMs: elapsedMs(outboundWriteStarted),
        totalMs: elapsedMs(requestStarted),
      });
      logTheo("webhook complete", {
        leadPhone: payload.From,
        action: sendResult.sent ? "control_reply_sent" : "control_reply_generated",
        totalMs: elapsedMs(requestStarted),
        sessionCost: formatUsd(theoSessionCost()),
      });
      return NextResponse.json({
        ok: true,
        channel: result.event.channel,
        status: sendResult.sent ? "sent" : sendResult.skipped ? "skipped" : "send_failed",
        action: sendResult.sent ? "control_reply_sent" : "control_reply_generated",
        reply_sent: sendResult.sent,
        handoff_alert_sent: handoffAlertSent,
        handoff_alert_error: handoffAlertError || undefined,
        send_error: sendResult.error || undefined,
      });
    }

    const lookupStarted = nowMs();
    const lead = await findLeadInDatabase({ phone: payload.From || "", full_name: payload.ProfileName || "" });
    const propertyQuery = extractTheoPropertySearchQuery(payload.Body || "", lead?.property_interest || "", result.lead.property_interest || "");
    logTheo("lead lookup complete", {
      leadPhone: payload.From,
      found: Boolean(lead),
      propertyQuery,
      elapsedMs: elapsedMs(lookupStarted),
      totalMs: elapsedMs(requestStarted),
    });
    const contextReadStarted = nowMs();
    const recentEvents = await readEventsForThreadFromDatabase(result.event.thread_ref, 12);
    const priorAddresses = referencesPriorProperties(payload.Body || "")
      ? extractTheoListedPropertyAddresses(...recentEvents.filter((event) => event.direction === "outbound").map((event) => event.message_text || ""))
      : [];
    const properties = priorAddresses.length
      ? await findPropertiesByAddressesFromDatabase(priorAddresses, 5)
      : await findCandidatePropertiesFromDatabase(propertyQuery, 5);
    logTheo("context read complete", {
      leadPhone: payload.From,
      propertyRows: properties.length,
      priorAddressRows: priorAddresses.length,
      threadEvents: recentEvents.length,
      elapsedMs: elapsedMs(contextReadStarted),
      totalMs: elapsedMs(requestStarted),
    });
    const enrichmentStarted = nowMs();
    const enriched = await enrichTheoData({
      message: payload.Body || "",
      lead: lead || result.lead,
      properties,
      propertyInterest: lead?.property_interest || result.lead.property_interest || "",
    });
    logTheoMetrics(enriched.metrics);
    logTheo("data enrichment complete", {
      leadPhone: payload.From,
      propertyRows: enriched.properties.length,
      contextChars: enriched.context.length,
      elapsedMs: elapsedMs(enrichmentStarted),
      reportedElapsedMs: enriched.elapsedMs,
      cost: formatUsd(enriched.costUsd),
      totalMs: elapsedMs(requestStarted),
    });
    const aiStarted = nowMs();
    const reply = await generateTheoReply({
      message: payload.Body || "",
      lead: lead || result.lead,
      properties: enriched.properties,
      recentEvents,
      propertyInterest: lead?.property_interest || result.lead.property_interest || "",
      source: "sms",
      dataContext: enriched.context,
    });
    logTheoMetrics(reply.metrics);
    const aiCost = reply.metrics.reduce((total, metric) => total + (metric.costUsd || 0), 0);
    logTheo("reply generated", {
      leadPhone: payload.From,
      intent: reply.classification.intent,
      leadRole: reply.classification.leadRole,
      opportunityTags: reply.classification.opportunityTags || [],
      toneState: reply.classification.toneState || "",
      nextBestQuestion: reply.classification.nextBestQuestion || "",
      status: reply.status,
      action: reply.aiAction,
      handoffReason: reply.handoffReason,
      elapsedMs: elapsedMs(aiStarted),
      cost: formatUsd(aiCost),
      sessionCost: formatUsd(theoSessionCost()),
      mediaCount: reply.mediaUrls.length,
      replyPreview: reply.reply.slice(0, 160),
    });

    if (!reply.shouldSend) {
      logTheo("reply blocked", {
        leadPhone: payload.From,
        status: reply.status,
        action: reply.aiAction,
        handoffReason: reply.handoffReason,
        totalMs: elapsedMs(requestStarted),
      });
      return NextResponse.json({
        ok: true,
        channel: result.event.channel,
        status: reply.status,
        action: reply.aiAction,
        reply_sent: false,
      });
    }

    const sendStarted = nowMs();
    const sendResult = await sendTheoSms(payload.From || "", reply.reply, reply.mediaUrls);
    const sendMs = elapsedMs(sendStarted);
    let handoffAlertSent = false;
    let handoffAlertError = "";
    if (reply.status === "needs_human") {
      const alertStarted = nowMs();
      const alertResult = await sendTheoHandoffAlert({
        leadPhone: payload.From || "",
        leadName: payload.ProfileName || "",
        reason: reply.handoffReason,
        summary: payload.Body || reply.reply,
        threadRef: result.event.thread_ref,
      });
      handoffAlertSent = alertResult.sent;
      handoffAlertError = alertResult.error;
      logTheo("handoff alert processed", {
        leadPhone: payload.From,
        sent: handoffAlertSent,
        elapsedMs: elapsedMs(alertStarted),
        error: handoffAlertError,
      });
    }
    logTheo("reply send processed", {
      leadPhone: payload.From,
      replySent: sendResult.sent,
      replyStatus: sendResult.sent ? "sent" : sendResult.skipped ? "skipped" : "send_failed",
      elapsedMs: sendMs,
      mediaCount: sendResult.mediaCount,
      sendError: sendResult.error || "",
      handoffAlertSent,
      handoffAlertError,
    });
    const outboundWriteStarted = nowMs();
    await recordTheoOutbound({
      phone: payload.From || "",
      fullName: payload.ProfileName || "",
      sourceDetail: payload.To ? `to ${payload.To}` : "",
      threadRef: result.event.thread_ref,
      eventType: reply.status === "needs_human" ? "sms_handoff_reply" : "sms_ai_reply",
      messageText: smsMessageWithMediaLog(reply.reply, reply.mediaUrls),
      summary: `Theo ${sendResult.sent ? "sent" : "prepared"} SMS reply for ${reply.classification.intent}${sendResult.mediaCount ? ` with ${sendResult.mediaCount} image(s)` : ""}.`,
      aiAction: sendResult.sent ? "reply_sent" : "reply_generated",
      handoffReason: reply.handoffReason || sendResult.error,
      status: sendResult.sent ? "sent" : sendResult.skipped ? "skipped" : "send_failed",
      leadRole: reply.classification.leadRole,
      intent: reply.classification.intent,
      smsConsent: "inbound_text",
      handoffStatus: reply.status === "needs_human" ? "needs_human" : "",
      nextAction: reply.status === "needs_human" ? "human_follow_up" : "await_response",
    });
    logTheo("outbound logged", {
      leadPhone: payload.From,
      elapsedMs: elapsedMs(outboundWriteStarted),
      totalMs: elapsedMs(requestStarted),
    });
    logTheo("webhook complete", {
      leadPhone: payload.From,
      action: sendResult.sent ? "reply_sent" : "reply_generated",
      replySent: sendResult.sent,
      totalMs: elapsedMs(requestStarted),
      sessionCost: formatUsd(theoSessionCost()),
    });

    return NextResponse.json({
      ok: true,
      channel: result.event.channel,
      status: sendResult.sent ? "sent" : sendResult.skipped ? "skipped" : "send_failed",
      action: sendResult.sent ? "reply_sent" : "reply_generated",
      reply_sent: sendResult.sent,
      handoff_alert_sent: handoffAlertSent,
      handoff_alert_error: handoffAlertError || undefined,
      send_error: sendResult.error || undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to process Theo SMS webhook.";
    logTheo("webhook error", { error: message, totalMs: elapsedMs(requestStarted), sessionCost: formatUsd(theoSessionCost()) });
    const status = message.includes("secret") ? 401 : message.includes("DATABASE_URL") ? 503 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
