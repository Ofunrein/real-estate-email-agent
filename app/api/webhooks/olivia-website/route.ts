import { NextRequest, NextResponse } from "next/server";

import { oliviaWebsiteIngestInput, recordChannelInteraction, type ChannelIngestInput } from "@/lib/channelIngest";
import { findCandidatePropertiesFromDatabase, findLeadInDatabase, readEventsForThreadFromDatabase } from "@/lib/database";
import { generateTheoReply, smsOptIn } from "@/lib/theoAgent";
import { sendTheoSms } from "@/lib/twilioSms";
import { assertWebhookSecret, parseWebhookPayload } from "@/lib/webhookRequest";

export const dynamic = "force-dynamic";

function stringValue(payload: Record<string, unknown>, ...keys: string[]): string {
  const key = keys.find((candidate) => payload[candidate] != null && String(payload[candidate]).trim());
  return key ? String(payload[key]).trim() : "";
}

type TheoFormSmsInput = Omit<
  ChannelIngestInput,
  "channel" | "direction" | "agentName" | "source" | "sourceDetail" | "preferredChannel" | "eventType"
>;

async function recordTheoFormSms(input: TheoFormSmsInput) {
  return recordChannelInteraction({
    ...input,
    channel: "sms",
    direction: "outbound",
    agentName: "Theo",
    source: "website",
    sourceDetail: "form opt-in",
    preferredChannel: "sms",
    eventType: "sms_form_opt_in_reply",
  });
}

export async function POST(request: NextRequest) {
  try {
    assertWebhookSecret(request);
    const payload = await parseWebhookPayload(request);
    const result = await recordChannelInteraction(oliviaWebsiteIngestInput(payload));
    const phone = stringValue(payload, "phone");
    const email = stringValue(payload, "email");
    const fullName = stringValue(payload, "full_name", "fullName", "name");
    const message = stringValue(payload, "message", "message_text", "question");
    const propertyInterest = stringValue(payload, "property_interest", "propertyInterest", "address");
    const hasSmsConsent = smsOptIn(payload.sms_consent ?? payload.smsConsent);
    let smsReplySent = false;
    let smsStatus = "not_requested";
    let smsAction = "no_sms_consent";
    let smsError = "";

    if (phone && hasSmsConsent) {
      const lead = await findLeadInDatabase({ phone, email, full_name: fullName });
      const [properties, recentEvents] = await Promise.all([
        findCandidatePropertiesFromDatabase(`${propertyInterest} ${message}`, 5),
        readEventsForThreadFromDatabase(`sms:${phone}`, 12),
      ]);
      const reply = await generateTheoReply({
        message: message || propertyInterest || "website inquiry",
        lead: lead || result.lead,
        properties,
        recentEvents,
        propertyInterest,
        source: "form",
      });

      if (reply.shouldSend) {
        const sendResult = await sendTheoSms(phone, reply.reply);
        smsReplySent = sendResult.sent;
        smsStatus = sendResult.sent ? "sent" : sendResult.skipped ? "skipped" : "send_failed";
        smsAction = sendResult.sent ? "reply_sent" : "reply_generated";
        smsError = sendResult.error;
        await recordTheoFormSms({
          phone,
          email,
          fullName,
          threadRef: `sms:${phone}`,
          messageText: reply.reply,
          summary: `Theo ${sendResult.sent ? "sent" : "prepared"} first SMS reply from website opt-in.`,
          aiAction: smsAction,
          handoffReason: reply.handoffReason || sendResult.error,
          status: smsStatus,
          leadRole: reply.classification.leadRole,
          intent: reply.classification.intent,
          propertyInterest,
          smsConsent: "yes",
          handoffStatus: reply.status === "needs_human" ? "needs_human" : "",
          nextAction: reply.status === "needs_human" ? "human_follow_up" : "await_response",
        });
      } else {
        smsStatus = reply.status;
        smsAction = reply.aiAction;
      }
    }

    return NextResponse.json({
      ok: true,
      channel: result.event.channel,
      thread_ref: result.event.thread_ref,
      status: result.event.status,
      action: result.event.ai_action,
      sms_reply_sent: smsReplySent,
      sms_status: smsStatus,
      sms_action: smsAction,
      sms_error: smsError || undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to process Olivia website webhook.";
    const status = message.includes("secret") ? 401 : message.includes("DATABASE_URL") ? 503 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
