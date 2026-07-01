import { clientConfig } from "@/lib/clientConfig";
import { recordChannelInteraction, type ChannelIngestInput } from "@/lib/channelIngest";
import { DEFAULT_INBOX_SETTINGS, shouldAutoSendForChannel, type InboxSettings } from "@/lib/inboxSettings";
import { readInboxSettingsFromDatabase } from "@/lib/database";
import { bookAppointment as bookCalendarAppointment, type AppointmentInput, type AppointmentResult } from "@/lib/ariaCalendar";
import { sendManualReply, type ManualReplyInput, type ManualReplyResult } from "@/lib/manualReply";
import { placeOutboundCall, type OutboundCallInput, type OutboundConfig } from "@/lib/outbound";
import type { Channel } from "@/lib/inboxData";

export type AgentSendChannel = "sms" | "whatsapp" | "email" | "instagram" | "messenger";
export type AgentActionKind =
  | "send_text"
  | "send_email"
  | "send_social_dm"
  | "start_call"
  | "book_appointment"
  | "flag_human_followup";

export type AgentActionLead = {
  phone?: string;
  email?: string;
  fullName?: string;
  preferredChannel?: string;
  smsConsent?: string;
  callConsent?: string;
};

export type AgentActionContext = {
  trigger?: string;
  reason?: string;
  summary?: string;
  propertyInterest?: string;
  captured?: boolean;
};

export type AgentActionInput = {
  action: AgentActionKind;
  actorAgent: string;
  channel?: AgentSendChannel;
  to?: string;
  body?: string;
  subject?: string;
  mediaUrls?: string[];
  threadRef?: string;
  messageId?: string;
  references?: string;
  lead?: AgentActionLead;
  context?: AgentActionContext;
  source?: string;
  appointment?: Partial<AppointmentInput>;
};

export type AgentActionGuard = {
  allowed: boolean;
  code: string;
  reason: string;
  channel?: AgentSendChannel | "voice" | "calendar";
  safeFallback?: "draft" | "human_followup" | "capture_context";
};

export type AgentActionResult =
  | {
      ok: true;
      action: AgentActionKind;
      channel?: string;
      providerResult?: ManualReplyResult | { ok: true; id?: string } | AppointmentResult;
      auditError?: string;
    }
  | {
      ok: false;
      action: AgentActionKind;
      blocked: boolean;
      code: string;
      error: string;
      safeFallback?: AgentActionGuard["safeFallback"];
    };

export type AgentActionDeps = {
  readSettings: () => Promise<InboxSettings>;
  sendReply: (input: ManualReplyInput) => Promise<ManualReplyResult>;
  placeCall: (config: OutboundConfig, input: OutboundCallInput) => Promise<{ ok: boolean; id?: string; error?: string }>;
  bookAppointment: (input: AppointmentInput) => Promise<AppointmentResult>;
  recordInteraction: (input: ChannelIngestInput) => Promise<unknown>;
};

function clean(value?: string): string {
  return (value || "").replace(/\s+/g, " ").trim();
}

function consentYes(value?: string): boolean {
  return /^(yes|y|true|ok|okay|allowed|consented|opted_in)$/i.test(clean(value));
}

function consentNo(value?: string): boolean {
  return /^(no|n|false|stop|opted_out|do_not_contact)$/i.test(clean(value));
}

function bodyRequired(action: AgentActionKind): boolean {
  return action === "send_text" || action === "send_email" || action === "send_social_dm";
}

function hasCapturedTrigger(input: AgentActionInput): boolean {
  const context = input.context || {};
  return Boolean(
    context.captured
    || clean(context.trigger)
    || clean(context.reason)
    || clean(context.summary)
    || clean(input.threadRef)
    || clean(input.lead?.phone)
    || clean(input.lead?.email),
  );
}

function actionChannel(input: AgentActionInput): AgentActionGuard["channel"] | undefined {
  if (input.action === "start_call") return "voice";
  if (input.action === "book_appointment") return "calendar";
  if (input.action === "send_email") return "email";
  if (input.action === "send_social_dm") return input.channel === "messenger" ? "messenger" : "instagram";
  if (input.action === "send_text") return input.channel === "whatsapp" ? "whatsapp" : "sms";
  return input.channel;
}

function recipientFor(input: AgentActionInput): string {
  if (input.to) return clean(input.to);
  if (input.action === "send_email") return clean(input.lead?.email);
  if (input.action === "start_call" || input.action === "send_text") return clean(input.lead?.phone);
  return "";
}

function sendChannelFor(input: AgentActionInput): AgentSendChannel {
  if (input.action === "send_email") return "email";
  if (input.action === "send_social_dm") return input.channel === "messenger" ? "messenger" : "instagram";
  if (input.channel === "whatsapp") return "whatsapp";
  return "sms";
}

function channelEnabled(settings: InboxSettings, channel: AgentSendChannel): boolean {
  return settings.channels_enabled[channel] !== false;
}

export function planAgentAction(input: AgentActionInput, settings: InboxSettings = DEFAULT_INBOX_SETTINGS): AgentActionGuard {
  const channel = actionChannel(input);
  if (!input.action) {
    return { allowed: false, code: "missing_action", reason: "Action name required.", safeFallback: "human_followup" };
  }
  if (!clean(input.actorAgent)) {
    return { allowed: false, code: "missing_actor", reason: "Actor agent required.", channel, safeFallback: "human_followup" };
  }
  if (!hasCapturedTrigger(input)) {
    return {
      allowed: false,
      code: "missing_trigger_context",
      reason: "Shared trigger context must be captured before an agent takes action.",
      channel,
      safeFallback: "capture_context",
    };
  }
  if (bodyRequired(input.action) && !clean(input.body) && !(input.mediaUrls || []).length) {
    return { allowed: false, code: "missing_body", reason: "Body or media required for outbound message.", channel, safeFallback: "draft" };
  }

  if (input.action === "flag_human_followup") {
    return { allowed: true, code: "allowed", reason: "Human follow-up flag can be recorded.", channel };
  }

  if (input.action === "start_call") {
    if (!recipientFor(input)) return { allowed: false, code: "missing_phone", reason: "Phone required before starting a call.", channel, safeFallback: "capture_context" };
    if (!consentYes(input.lead?.callConsent)) {
      return { allowed: false, code: "missing_call_consent", reason: "Call consent must be captured before starting outbound call.", channel, safeFallback: "human_followup" };
    }
    return { allowed: true, code: "allowed", reason: "Call can be started.", channel };
  }

  if (input.action === "book_appointment") {
    if (!clean(input.appointment?.date) || !clean(input.appointment?.time)) {
      return { allowed: false, code: "missing_appointment_time", reason: "Appointment date and time required.", channel, safeFallback: "capture_context" };
    }
    if (!clean(input.appointment?.caller_phone) && !clean(input.lead?.phone)) {
      return { allowed: false, code: "missing_appointment_contact", reason: "Appointment needs a phone contact.", channel, safeFallback: "capture_context" };
    }
    return { allowed: true, code: "allowed", reason: "Appointment can be booked.", channel };
  }

  const sendChannel = sendChannelFor(input);
  if (!channelEnabled(settings, sendChannel)) {
    return { allowed: false, code: "channel_disabled", reason: `${sendChannel} is disabled for this client.`, channel: sendChannel, safeFallback: "human_followup" };
  }
  if (!shouldAutoSendForChannel(settings, sendChannel)) {
    return { allowed: false, code: "autosend_disabled", reason: `${sendChannel} auto-send is disabled for this client.`, channel: sendChannel, safeFallback: "draft" };
  }
  if (!recipientFor(input)) {
    return { allowed: false, code: "missing_recipient", reason: "Recipient required before sending.", channel: sendChannel, safeFallback: "capture_context" };
  }
  if ((sendChannel === "sms" || sendChannel === "whatsapp") && consentNo(input.lead?.smsConsent)) {
    return { allowed: false, code: "sms_opted_out", reason: "Lead opted out of text messages.", channel: sendChannel, safeFallback: "human_followup" };
  }
  return { allowed: true, code: "allowed", reason: "Agent action can run.", channel: sendChannel };
}

function outboundConfig(): OutboundConfig {
  return {
    apiKey: process.env.VAPI_API_KEY || "",
    assistantId: process.env.VAPI_ASSISTANT_ID || "",
    phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID || "",
  };
}

const defaultDeps: AgentActionDeps = {
  readSettings: readInboxSettingsFromDatabase,
  sendReply: sendManualReply,
  placeCall: placeOutboundCall,
  bookAppointment: bookCalendarAppointment,
  recordInteraction: recordChannelInteraction,
};

function recordInput(input: AgentActionInput, status: string, providerMessageId = ""): ChannelIngestInput {
  const channel = (actionChannel(input) === "voice" || actionChannel(input) === "calendar")
    ? (input.lead?.preferredChannel as Channel) || "sms"
    : (sendChannelFor(input) as Channel);
  return {
    channel,
    direction: input.action === "flag_human_followup" ? "inbound" : "outbound",
    agentName: input.actorAgent,
    email: input.action === "send_email" ? recipientFor(input) : input.lead?.email || "",
    phone: input.action === "send_email" ? input.lead?.phone || "" : input.lead?.phone || recipientFor(input),
    fullName: input.lead?.fullName || "",
    source: input.source || "agent_action_api",
    threadRef: input.threadRef || recipientFor(input) || `${channel}:unknown`,
    eventType: input.action,
    messageText: input.body || input.context?.summary || input.context?.reason || "",
    summary: input.context?.summary || input.context?.reason || input.body || "",
    aiAction: input.action,
    status,
    propertyInterest: input.context?.propertyInterest || input.appointment?.property_address || "",
    preferredChannel: input.lead?.preferredChannel || String(channel),
    providerMessageId,
    mediaJson: (input.mediaUrls || []).map((url) => ({ url, type: "file", providerMetadata: { source: "agent_action_api" } })),
    providerMetadata: {
      trigger: input.context?.trigger || "",
      reason: input.context?.reason || "",
      action: input.action,
    },
  };
}

async function safeRecord(deps: AgentActionDeps, input: AgentActionInput, status: string, providerMessageId = ""): Promise<string | undefined> {
  try {
    await deps.recordInteraction(recordInput(input, status, providerMessageId));
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export async function executeAgentAction(input: AgentActionInput, deps: Partial<AgentActionDeps> = {}): Promise<AgentActionResult> {
  const resolvedDeps = { ...defaultDeps, ...deps };
  const settings = await resolvedDeps.readSettings().catch(() => DEFAULT_INBOX_SETTINGS);
  const guard = planAgentAction(input, settings);
  if (!guard.allowed) {
    await safeRecord(resolvedDeps, input, `blocked:${guard.code}`);
    return { ok: false, action: input.action, blocked: true, code: guard.code, error: guard.reason, safeFallback: guard.safeFallback };
  }

  if (input.action === "flag_human_followup") {
    const auditError = await safeRecord(resolvedDeps, input, "needs_human");
    return { ok: true, action: input.action, channel: String(guard.channel || ""), auditError };
  }

  if (input.action === "start_call") {
    const config = clientConfig();
    const result = await resolvedDeps.placeCall(outboundConfig(), {
      customerNumber: recipientFor(input),
      leadName: input.lead?.fullName || "",
      leadEmail: input.lead?.email || "",
      companyName: config.voiceClientName || config.clientName,
      agentName: input.actorAgent,
      callReason: input.context?.reason || input.context?.trigger || "real estate request",
      leadContext: input.context?.summary || "",
      preferredChannel: input.lead?.preferredChannel || "",
      clientId: config.clientId,
      trigger: input.context?.trigger || input.source || "agent_action_api",
    });
    if (!result.ok) return { ok: false, action: input.action, blocked: false, code: "provider_failed", error: result.error || "Call failed" };
    const auditError = await safeRecord(resolvedDeps, input, "sent", result.id || "");
    return { ok: true, action: input.action, channel: "voice", providerResult: { ok: true, id: result.id }, auditError };
  }

  if (input.action === "book_appointment") {
    const appointment: AppointmentInput = {
      date: clean(input.appointment?.date),
      time: clean(input.appointment?.time),
      duration_minutes: input.appointment?.duration_minutes || 30,
      property_address: clean(input.appointment?.property_address || input.context?.propertyInterest),
      caller_name: clean(input.appointment?.caller_name || input.lead?.fullName || "Lead"),
      caller_phone: clean(input.appointment?.caller_phone || input.lead?.phone),
      caller_email: clean(input.appointment?.caller_email || input.lead?.email),
      notes: clean(input.appointment?.notes || input.context?.summary),
      appointment_type: input.appointment?.appointment_type || "consultation",
      booked_via_channel: input.appointment?.booked_via_channel || input.lead?.preferredChannel || input.channel || "agent_action_api",
      timezone: input.appointment?.timezone,
      call_id: input.appointment?.call_id,
    };
    const result = await resolvedDeps.bookAppointment(appointment);
    if (!result.success) return { ok: false, action: input.action, blocked: false, code: "provider_failed", error: result.error || "Appointment booking failed" };
    const auditError = await safeRecord(resolvedDeps, input, "booked", result.appointment_id || result.neon_id || "");
    return { ok: true, action: input.action, channel: "calendar", providerResult: result, auditError };
  }

  const sendChannel = sendChannelFor(input);
  const result = await resolvedDeps.sendReply({
    channel: sendChannel,
    to: recipientFor(input),
    body: input.body || "",
    mediaUrls: input.mediaUrls,
    subject: input.subject,
    threadId: input.threadRef,
    messageId: input.messageId,
    references: input.references,
  });
  if (!result.ok) return { ok: false, action: input.action, blocked: false, code: "provider_failed", error: result.error };
  const auditError = await safeRecord(resolvedDeps, input, "sent", result.messageIds?.[0] || result.gmailMessageId || "");
  return { ok: true, action: input.action, channel: sendChannel, providerResult: result, auditError };
}
