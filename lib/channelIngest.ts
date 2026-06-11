import { appendConversationEventToDatabase, databaseEnabled, upsertLeadMemoryToDatabase } from "@/lib/database";
import type { Channel } from "@/lib/inboxData";
import type { SheetRow } from "@/lib/sheetSchema";

export type ChannelIngestInput = {
  channel: Channel;
  direction?: "inbound" | "outbound";
  agentName: string;
  email?: string;
  phone?: string;
  fullName?: string;
  source?: string;
  sourceDetail?: string;
  threadRef?: string;
  eventType?: string;
  messageText?: string;
  summary?: string;
  transcriptUrl?: string;
  recordingUrl?: string;
  aiAction?: string;
  handoffReason?: string;
  status?: string;
  leadRole?: string;
  intent?: string;
  propertyInterest?: string;
  preferredChannel?: string;
  smsConsent?: string;
  callConsent?: string;
  assignedOwner?: string;
  handoffStatus?: string;
  nextAction?: string;
};

const STOP_WORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit"]);
const START_WORDS = new Set(["start", "unstop"]);
const HELP_WORDS = new Set(["help", "info"]);

export function isoNow(): string {
  return new Date().toISOString();
}

export function smsControlAction(message: string): "stop" | "start" | "help" | "" {
  const normalized = message.trim().toLowerCase();
  if (STOP_WORDS.has(normalized)) return "stop";
  if (START_WORDS.has(normalized)) return "start";
  if (HELP_WORDS.has(normalized)) return "help";
  return "";
}

export function normalizeTwilioContactAddress(value: string): string {
  return value.replace(/^(?:rcs|sms|whatsapp):/i, "").trim();
}

export function inferPreferredChannelFromText(message = "", fallback: Channel | "email" | "voice" | "sms" = "sms"): "email" | "sms" | "voice" | "whatsapp" | "website_chat" {
  if (/\b(email|e-mail).{0,24}\b(best|better|preferred|works|send|reply|details|me)\b|\b(best|better|preferred|works|send).{0,24}\b(email|e-mail)\b/i.test(message)) {
    return "email";
  }
  if (/\b(text|sms).{0,24}\b(best|better|preferred|works|send|reply|details|me|options?)\b|\b(best|better|preferred|works|send).{0,24}\b(text|sms)\b/i.test(message)) {
    return "sms";
  }
  if (/\b(call|phone).{0,24}\b(best|better|preferred|works|me|back)|\b(best|better|preferred|works).{0,24}\b(call|phone)\b/i.test(message)) {
    return "voice";
  }
  if (/\bwhatsapp\b/i.test(message)) return "whatsapp";
  return fallback as "email" | "sms" | "voice" | "whatsapp" | "website_chat";
}

export function requireDatabaseForChannelWrites(): void {
  if (!databaseEnabled()) {
    throw new Error("DATABASE_URL is required for hosted channel webhooks");
  }
}

export async function recordChannelInteraction(input: ChannelIngestInput): Promise<{ event: SheetRow; lead: SheetRow }> {
  requireDatabaseForChannelWrites();
  const eventAt = isoNow();
  const threadRef = input.threadRef || input.email || input.phone || `${input.channel}:unknown`;
  const hasLeadIdentity = Boolean(input.email || input.phone || input.fullName);

  const lead = hasLeadIdentity
    ? await upsertLeadMemoryToDatabase({
        email: input.email || "",
        phone: input.phone || "",
        full_name: input.fullName || "",
        lead_source: input.source || input.channel,
        source_detail: input.sourceDetail || "",
        lead_role: input.leadRole || "",
        intent: input.intent || input.eventType || "",
        property_interest: input.propertyInterest || "",
        preferred_channel: input.preferredChannel || input.channel,
        sms_consent: input.smsConsent || "",
        call_consent: input.callConsent || "",
        last_channel: input.channel,
        last_ai_touch_at: eventAt,
        assigned_owner: input.assignedOwner || "",
        handoff_status: input.handoffStatus || "",
        handoff_reason: input.handoffReason || "",
        next_action: input.nextAction || "",
        summary: input.summary || input.messageText || "",
      })
    : ({} as SheetRow);

  const event = await appendConversationEventToDatabase({
    event_at: eventAt,
    channel: input.channel,
    direction: input.direction || "inbound",
    email: input.email || "",
    phone: input.phone || "",
    full_name: input.fullName || "",
    source: input.source || input.channel,
    thread_ref: threadRef,
    agent_name: input.agentName,
    event_type: input.eventType || "message",
    message_text: input.messageText || "",
    summary: input.summary || "",
    transcript_url: input.transcriptUrl || "",
    recording_url: input.recordingUrl || "",
    ai_action: input.aiAction || "",
    handoff_reason: input.handoffReason || "",
    status: input.status || "received",
  });

  return { event, lead };
}

export function twilioSmsIngestInput(payload: Record<string, string>): ChannelIngestInput {
  return twilioTextIngestInput(payload, "sms");
}

export function twilioWhatsAppIngestInput(payload: Record<string, string>): ChannelIngestInput {
  return twilioTextIngestInput(payload, "whatsapp");
}

function twilioTextIngestInput(payload: Record<string, string>, channel: "sms" | "whatsapp"): ChannelIngestInput {
  const body = payload.Body || "";
  const action = smsControlAction(body);
  const from = normalizeTwilioContactAddress(payload.From || "");
  const threadRef = from ? `${channel}:${from}` : payload.MessageSid || `${channel}:unknown`;
  const channelLabel = channel === "whatsapp" ? "WhatsApp" : "SMS";
  const preferredChannel = inferPreferredChannelFromText(body, channel);
  const base: ChannelIngestInput = {
    channel,
    agentName: "Theo",
    phone: from,
    fullName: payload.ProfileName || "",
    source: "twilio",
    sourceDetail: payload.To ? `to ${payload.To}` : "",
    threadRef,
    eventType: action ? `${channel}_${action}` : `${channel}_inbound`,
    messageText: body,
    preferredChannel,
    status: action ? "processed" : "received",
  };

  if (action === "stop") {
    return {
      ...base,
      smsConsent: "no",
      aiAction: "opt_out_recorded",
      nextAction: "do_not_contact",
      handoffStatus: "human_review",
      handoffReason: `Lead opted out of ${channelLabel}`,
      summary: `Lead opted out of ${channelLabel}.`,
    };
  }

  if (action === "start") {
    return {
      ...base,
      smsConsent: "yes",
      aiAction: "opt_in_recorded",
      nextAction: `continue_${channel}`,
      summary: `Lead opted back into ${channelLabel}.`,
    };
  }

  if (action === "help") {
    return {
      ...base,
      aiAction: "help_requested",
      nextAction: "human_follow_up",
      handoffStatus: "needs_human",
      handoffReason: `Lead asked for ${channelLabel} help`,
      summary: `Lead asked for ${channelLabel} help.`,
    };
  }

  return {
    ...base,
    smsConsent: channel === "sms" ? "inbound_text" : "",
    nextAction: "review_or_reply",
    summary: body ? `Inbound ${channelLabel}: ${body}` : `Inbound ${channelLabel} received.`,
  };
}

export function vapiVoiceIngestInput(payload: Record<string, unknown>): ChannelIngestInput {
  const message = (payload.message && typeof payload.message === "object" ? payload.message : {}) as Record<string, unknown>;
  const source = Object.keys(message).length ? message : payload;
  const artifact = (source.artifact && typeof source.artifact === "object" ? source.artifact : {}) as Record<string, unknown>;
  const call = ((source.call || payload.call) && typeof (source.call || payload.call) === "object"
    ? (source.call || payload.call)
    : {}) as Record<string, unknown>;
  const customer = ((call.customer || source.customer || payload.customer) && typeof (call.customer || source.customer || payload.customer) === "object"
    ? (call.customer || source.customer || payload.customer)
    : {}) as Record<string, unknown>;
  const phone = String(customer.number || source.phoneNumber || payload.phone || payload.from || "");
  const transcriptValue = source.transcript || artifact.transcript || source.summary || artifact.summary || "";
  const transcript = typeof transcriptValue === "string" ? transcriptValue : JSON.stringify(transcriptValue);
  const summaryValue = source.summary || artifact.summary || transcript || "Voice call event received.";
  const summary = typeof summaryValue === "string" ? summaryValue : JSON.stringify(summaryValue);
  const recordingUrl = String(source.recordingUrl || artifact.recordingUrl || call.recordingUrl || "");
  const callId = String(call.id || source.callId || payload.callId || payload.id || phone || "unknown");

  return {
    channel: "voice",
    agentName: "Aria",
    phone,
    source: "vapi",
    sourceDetail: String(source.type || payload.type || payload.status || ""),
    threadRef: `voice:${callId}`,
    eventType: "voice_call",
    messageText: transcript,
    summary,
    recordingUrl,
    preferredChannel: inferPreferredChannelFromText(transcript, "voice"),
    callConsent: source.callRecordingConsent === false ? "no" : "",
    aiAction: "call_logged",
    nextAction: "review_call_summary",
    status: "received",
  };
}

export function oliviaWebsiteIngestInput(payload: Record<string, unknown>): ChannelIngestInput {
  const email = String(payload.email || "");
  const phone = String(payload.phone || "");
  const fullName = String(payload.full_name || payload.fullName || payload.name || "");
  const message = String(payload.message || payload.message_text || payload.question || "");
  const sessionId = String(payload.session_id || payload.sessionId || email || phone || "unknown");
  const propertyInterest = String(payload.property_interest || payload.propertyInterest || payload.address || "");
  const preferredChannel = inferPreferredChannelFromText(message, "website_chat");

  return {
    channel: "website_chat",
    agentName: "Olivia",
    email,
    phone,
    fullName,
    source: "website",
    sourceDetail: String(payload.page_url || payload.pageUrl || payload.referrer || ""),
    threadRef: `website:${sessionId}`,
    eventType: "website_chat_inbound",
    messageText: message,
    summary: message ? `Website chat: ${message}` : "Website chat event received.",
    propertyInterest,
    preferredChannel,
    intent: String(payload.intent || "website_chat"),
    leadRole: String(payload.lead_role || payload.leadRole || ""),
    aiAction: "chat_logged",
    nextAction: "review_or_reply",
    status: "received",
  };
}
