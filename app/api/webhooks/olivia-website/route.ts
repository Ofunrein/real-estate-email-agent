import { NextRequest, NextResponse } from "next/server";

import { bookAppointment } from "@/lib/ariaCalendar";
import { notifySlackOnHotLead } from "@/lib/ariaSlack";
import { oliviaWebsiteIngestInput, recordChannelInteraction, type ChannelIngestInput } from "@/lib/channelIngest";
import { findCandidatePropertiesFromDatabase, findLeadInDatabase, readEventsForThreadFromDatabase } from "@/lib/database";
import { generateTheoReply, smsOptIn } from "@/lib/theoAgent";
import { enrichTheoData, extractTheoPropertySearchQuery } from "@/lib/theoData";
import { sendTheoSms, smsMessageWithMediaLog } from "@/lib/twilioSms";
import { assertWebhookSecret, parseWebhookPayload } from "@/lib/webhookRequest";
import { IRIS_AGENT_NAME } from "@/lib/agentIdentity";

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
    agentName: IRIS_AGENT_NAME,
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
      const propertyQuery = extractTheoPropertySearchQuery(propertyInterest, message, lead?.property_interest || "");
      const [properties, recentEvents] = await Promise.all([
        findCandidatePropertiesFromDatabase(propertyQuery, 5),
        readEventsForThreadFromDatabase(`sms:${phone}`, 12),
      ]);
      const enriched = await enrichTheoData({
        message: message || propertyInterest || "website inquiry",
        lead: lead || result.lead,
        properties,
        propertyInterest,
      });
      const reply = await generateTheoReply({
        message: message || propertyInterest || "website inquiry",
        lead: lead || result.lead,
        properties: enriched.properties,
        recentEvents,
        propertyInterest,
        source: "form",
        dataContext: enriched.context,
      });
      const showingDatePreference = stringValue(payload, "preferred_date", "showing_date", "appointment_date");
      const propertyForShowing = propertyInterest || stringValue(payload, "address");
      if (
        process.env.ENABLE_CROSS_CHANNEL_BOOKING === "true"
        && showingDatePreference
        && propertyForShowing
      ) {
        const lower = showingDatePreference.toLowerCase();
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const date = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
        const time = /afternoon/.test(lower) ? "2:00 PM" : /evening/.test(lower) ? "5:00 PM" : "10:00 AM";
        const booking = await bookAppointment({
          date,
          time,
          caller_phone: phone,
          caller_name: fullName,
          caller_email: email,
          property_address: propertyForShowing,
          appointment_type: "showing",
          notes: `Booked via website form. Preference: ${showingDatePreference}`,
          booked_via_channel: "web",
        }).catch(() => null);
        if (booking?.success && reply.shouldSend) {
          reply.reply = `You're set for ${booking.confirmed_time} at ${propertyForShowing}. ${reply.reply}`;
        }
      }

      const hotTimeline = (result.lead?.timeline || lead?.timeline || "").toLowerCase();
      const hotBudget = result.lead?.budget || lead?.budget || "";
      const hotArea = result.lead?.area || lead?.area || "";
      const hotRole = result.lead?.lead_role || lead?.lead_role || "";
      if (hotRole && hotBudget && hotArea && /\b([0-3]\s*(?:month|mo)|asap|immediately|soon)\b/.test(hotTimeline)) {
        await notifySlackOnHotLead({
          outcome: "HOT_LEAD",
          caller_phone: phone,
          caller_name: fullName,
          timeline: hotTimeline,
          property_address: propertyForShowing,
          notes: `Web form submission. Budget: ${hotBudget}, Area: ${hotArea}`,
          channel: "web",
        }).catch(() => null);
      }

      if (reply.shouldSend) {
        const sendResult = await sendTheoSms(phone, reply.reply, reply.mediaUrls);
        smsReplySent = sendResult.sent;
        smsStatus = sendResult.sent ? "sent" : sendResult.skipped ? "skipped" : "send_failed";
        smsAction = sendResult.sent ? "reply_sent" : "reply_generated";
        smsError = sendResult.error;
        await recordTheoFormSms({
          phone,
          email,
          fullName,
          threadRef: `sms:${phone}`,
          messageText: smsMessageWithMediaLog(reply.reply, reply.mediaUrls),
          summary: `Iris ${sendResult.sent ? "sent" : "prepared"} first SMS reply from website opt-in${sendResult.mediaCount ? ` with ${sendResult.mediaCount} image(s)` : ""}.`,
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
    const message = error instanceof Error ? error.message : "Unable to process Iris website webhook.";
    const status = message.includes("secret") ? 401 : message.includes("DATABASE_URL") ? 503 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
