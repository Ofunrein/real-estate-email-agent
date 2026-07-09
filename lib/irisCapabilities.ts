/**
 * Channel-agnostic capability layer shared by every entry point into Iris
 * (email, SMS, voice, web chat — the channel-specific names Theo/Aria/Olivia
 * are routing labels only, not separate agents; see CLAUDE.md). Any channel
 * that has confirmed enough detail from the person it's talking to can call
 * these functions directly: they do not know or care which channel invoked
 * them.
 *
 * Every function here is an IRREVERSIBLE action (sends an email/SMS, places
 * a real phone call, or books a slot on a shared calendar). Callers are
 * responsible for confirming details with the person *before* calling these
 * — this module does not re-confirm, it executes.
 */
import { createIrisGmailSession, sendGmailReplyWithOptions } from "@/lib/gmailConnection";
import { sendTheoSms } from "@/lib/twilioSms";
import { placeOutboundCall, type OutboundCallInput, type OutboundConfig } from "@/lib/outbound";
import { createAppointment, type AppointmentRecord } from "@/lib/appointmentStore";

export type SendEmailInput = {
  to: string;
  subject: string;
  body: string;
  channelOrigin: string;
};

export type SendEmailResult = {
  ok: boolean;
  messageId?: string;
  threadId?: string;
  error?: string;
};

/** Sends a brand-new (non-reply) email through the same Iris Gmail mailbox
 * used for lead replies. Works for any content, not just real-estate leads —
 * scope enforcement (should this be sent at all) is the caller's job via
 * confirmation, not this function's. */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  try {
    const session = await createIrisGmailSession();
    const result = await sendGmailReplyWithOptions(
      session.gmail,
      { to: input.to, subject: input.subject, body: input.body },
      { mailboxEmail: session.accountEmail, fallbackUnthreadedOnMissingThread: true },
    );
    return { ok: true, messageId: result.messageId, threadId: result.threadId };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export type SendSmsInput = {
  to: string;
  body: string;
  channelOrigin: string;
  mediaUrls?: string[];
};

/** Generalization of the voice channel's existing sendPropertyDetailsSms —
 * same Twilio path (lib/twilioSms.ts), arbitrary body text instead of only
 * property details. */
export async function sendSms(input: SendSmsInput) {
  return sendTheoSms(input.to, input.body, input.mediaUrls || []);
}

export type ScheduleCallbackInput = {
  callerPhone: string;
  callerName?: string;
  callerEmail?: string;
  scheduledAt: string;
  scheduledAtLocal?: string;
  topic: string;
  notes?: string;
  channelOrigin: string;
  callId?: string;
};

/** Books a generic (non-property) callback using the existing shared
 * `appointments` table — same table Aria/Theo/Iris/Olivia already write
 * showings/consultations/follow-ups to. No schema change was needed: the
 * table already has no property/appointment_type constraints at the DB
 * layer, only a TS union that this adds "callback" to. */
export async function scheduleCallback(input: ScheduleCallbackInput): Promise<AppointmentRecord> {
  return createAppointment({
    caller_phone: input.callerPhone,
    caller_name: input.callerName,
    caller_email: input.callerEmail,
    appointment_type: "callback",
    scheduled_at: input.scheduledAt,
    scheduled_at_local: input.scheduledAtLocal,
    booked_via_channel: input.channelOrigin,
    call_id: input.callId,
    notes: input.topic + (input.notes ? ` — ${input.notes}` : ""),
  });
}

export type TriggerOutboundCallInput = OutboundCallInput;

function defaultOutboundConfig(): OutboundConfig {
  return {
    apiKey: process.env.VAPI_API_KEY || "",
    assistantId: process.env.VAPI_ASSISTANT_ID || "",
    phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID || "",
  };
}

/** Thin wrapper over the existing placeOutboundCall so every channel calls
 * outbound-calling through this same module instead of importing
 * lib/outbound.ts directly — keeps one place to add rate-limiting/consent
 * checks later (Phase 3) without touching every call site. */
export async function triggerOutboundCall(input: TriggerOutboundCallInput) {
  return placeOutboundCall(defaultOutboundConfig(), input);
}
