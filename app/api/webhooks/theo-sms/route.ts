import { NextRequest, NextResponse } from "next/server";

import { recordChannelInteraction, smsControlAction, twilioSmsIngestInput, type ChannelIngestInput } from "@/lib/channelIngest";
import { findCandidatePropertiesFromDatabase, findLeadInDatabase } from "@/lib/database";
import { generateTheoReply } from "@/lib/theoAgent";
import { sendTheoHandoffAlert, sendTheoSms } from "@/lib/twilioSms";
import { assertWebhookSecret, parseWebhookPayload } from "@/lib/webhookRequest";

export const dynamic = "force-dynamic";

function stringPayload(payload: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, value == null ? "" : String(value)]));
}

type TheoOutboundInput = Omit<ChannelIngestInput, "channel" | "direction" | "agentName" | "source" | "preferredChannel">;

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
  try {
    assertWebhookSecret(request);
    const payload = stringPayload(await parseWebhookPayload(request));
    const inboundInput = twilioSmsIngestInput(payload);
    const result = await recordChannelInteraction(inboundInput);
    const controlAction = smsControlAction(payload.Body || "");

    if (controlAction === "stop") {
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
      const sendResult = await sendTheoSms(payload.From || "", body);
      let handoffAlertSent = false;
      let handoffAlertError = "";
      if (controlAction === "help") {
        const alertResult = await sendTheoHandoffAlert({
          leadPhone: payload.From || "",
          leadName: payload.ProfileName || "",
          reason: "Lead asked for SMS help",
          summary: payload.Body || "HELP",
          threadRef: result.event.thread_ref,
        });
        handoffAlertSent = alertResult.sent;
        handoffAlertError = alertResult.error;
      }
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

    const lead = await findLeadInDatabase({ phone: payload.From || "", full_name: payload.ProfileName || "" });
    const propertyQuery = [payload.Body || "", lead?.property_interest || ""].filter(Boolean).join(" ");
    const properties = await findCandidatePropertiesFromDatabase(propertyQuery, 5);
    const reply = generateTheoReply({
      message: payload.Body || "",
      lead: lead || result.lead,
      properties,
      propertyInterest: lead?.property_interest || result.lead.property_interest || "",
      source: "sms",
    });

    if (!reply.shouldSend) {
      return NextResponse.json({
        ok: true,
        channel: result.event.channel,
        status: reply.status,
        action: reply.aiAction,
        reply_sent: false,
      });
    }

    const sendResult = await sendTheoSms(payload.From || "", reply.reply);
    let handoffAlertSent = false;
    let handoffAlertError = "";
    if (reply.status === "needs_human") {
      const alertResult = await sendTheoHandoffAlert({
        leadPhone: payload.From || "",
        leadName: payload.ProfileName || "",
        reason: reply.handoffReason,
        summary: payload.Body || reply.reply,
        threadRef: result.event.thread_ref,
      });
      handoffAlertSent = alertResult.sent;
      handoffAlertError = alertResult.error;
    }
    await recordTheoOutbound({
      phone: payload.From || "",
      fullName: payload.ProfileName || "",
      sourceDetail: payload.To ? `to ${payload.To}` : "",
      threadRef: result.event.thread_ref,
      eventType: reply.status === "needs_human" ? "sms_handoff_reply" : "sms_ai_reply",
      messageText: reply.reply,
      summary: `Theo ${sendResult.sent ? "sent" : "prepared"} SMS reply for ${reply.classification.intent}.`,
      aiAction: sendResult.sent ? "reply_sent" : "reply_generated",
      handoffReason: reply.handoffReason || sendResult.error,
      status: sendResult.sent ? "sent" : sendResult.skipped ? "skipped" : "send_failed",
      leadRole: reply.classification.leadRole,
      intent: reply.classification.intent,
      smsConsent: "inbound_text",
      handoffStatus: reply.status === "needs_human" ? "needs_human" : "",
      nextAction: reply.status === "needs_human" ? "human_follow_up" : "await_response",
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
    const status = message.includes("secret") ? 401 : message.includes("DATABASE_URL") ? 503 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
