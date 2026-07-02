import type { SheetRow } from "@/lib/sheetSchema";
import { normalizeEmail, normalizePhone } from "@/lib/leadIdentity";

export type ConversationSummaryInput = {
  events: SheetRow[];
  contact?: {
    fullName?: string;
    email?: string;
    phone?: string;
    contactId?: string;
  };
  maxChars?: number;
};

export type ConversationSummary = {
  text: string;
  eventCount: number;
  channels: string[];
  contact: {
    fullName?: string;
    email?: string;
    phone?: string;
    contactId?: string;
  };
  intent?: string;
  appointmentStatus?: string;
  handoffStatus?: string;
  preferredChannel?: string;
  nextAction?: string;
  lastInbound?: string;
  lastOutbound?: string;
};

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function firstNonEmpty(...values: unknown[]): string {
  for (const value of values) {
    const text = clean(value);
    if (text) return text;
  }
  return "";
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => clean(value)).filter(Boolean))];
}

function message(event: SheetRow): string {
  return firstNonEmpty(event.summary, event.message_text, event.transcript_url, event.outcome_code);
}

function detectIntent(events: SheetRow[]): string {
  const text = events.map((event) => `${event.event_type} ${event.ai_action} ${event.message_text} ${event.summary}`).join(" \n").toLowerCase();
  if (/sell|seller|valuation|home value|worth|list my|listing appointment|cma/.test(text)) return "seller valuation/listing lead";
  if (/showing|tour|appointment|schedule|available|saturday|tomorrow|meet/.test(text)) return "showing or appointment request";
  if (/buy|buyer|beds?|baths?|budget|under \$|pre.?approved|looking for|similar|reel|photos|listing/.test(text)) return "buyer property search";
  if (/rent|lease/.test(text)) return "rental inquiry";
  return "general real estate inquiry";
}

function detectAppointmentStatus(events: SheetRow[]): string {
  const text = events.map((event) => `${event.event_type} ${event.ai_action} ${event.status} ${event.appointment_id} ${event.message_text}`).join(" \n").toLowerCase();
  if (/cancelled|canceled/.test(text)) return "cancelled";
  if (/rescheduled/.test(text)) return "rescheduled";
  if (events.some((event) => clean(event.appointment_id))) return "scheduled";
  if (/booked|confirmed|on calendar|scheduled/.test(text)) return "scheduled";
  if (/saturday|tomorrow|available|what time|schedule|tour|showing/.test(text)) return "requested, not confirmed";
  return "none found";
}

function detectHandoffStatus(events: SheetRow[]): string {
  const latest = [...events].reverse().find((event) => clean(event.handoff_reason) || clean(event.human_owner) || clean(event.status));
  if (!latest) return "AI active";
  const status = `${latest.status} ${latest.handoff_reason} ${latest.human_owner}`.toLowerCase();
  if (/human|manual|takeover|review|legal|broker|follow.?up/.test(status)) return `human follow-up: ${firstNonEmpty(latest.handoff_reason, latest.human_owner, latest.status)}`;
  return firstNonEmpty(latest.status, "AI active");
}

function detectNextAction(events: SheetRow[]): string {
  const latest = [...events].reverse();
  const explicit = latest.find((event) => /next/i.test(event.ai_action || "") || /follow/i.test(event.status || ""));
  if (explicit) return firstNonEmpty(explicit.ai_action, explicit.status);
  const lastInbound = latest.find((event) => event.direction === "inbound");
  const text = lastInbound ? message(lastInbound).toLowerCase() : "";
  if (/value|worth|sell|valuation|address|photo/.test(text)) return "confirm address/details, run valuation, offer listing call";
  if (/similar|reel|photo|video|listing|want this/.test(text)) return "send matching properties in same channel, ask must-haves";
  if (/available|showing|tour|saturday|tomorrow|schedule/.test(text)) return "offer exact showing slots and book if confirmed";
  if (/price|beds?|baths?|sqft|hoa|layout/.test(text)) return "answer listing details, then offer showing/photos";
  return lastInbound ? "reply with concise qualification question" : "wait for lead reply";
}

function findLast(events: SheetRow[], direction: string): string | undefined {
  const event = [...events].reverse().find((candidate) => candidate.direction === direction && message(candidate));
  return event ? message(event) : undefined;
}

function clipLine(label: string, value?: string): string | null {
  const text = clean(value);
  if (!text) return null;
  return `${label}: ${text.slice(0, 420)}`;
}

export function buildConversationSummary(input: ConversationSummaryInput): ConversationSummary {
  const events = input.events.filter(Boolean);
  const last = [...events].reverse();
  const fullName = firstNonEmpty(input.contact?.fullName, ...last.map((event) => event.full_name));
  const email = normalizeEmail(firstNonEmpty(input.contact?.email, ...last.map((event) => event.email)));
  const phone = normalizePhone(firstNonEmpty(input.contact?.phone, ...last.map((event) => event.phone)));
  const channels = unique(events.map((event) => event.channel));
  const preferredChannel = firstNonEmpty(last.find((event) => event.direction === "inbound")?.channel, channels[channels.length - 1]);
  const intent = detectIntent(events);
  const appointmentStatus = detectAppointmentStatus(events);
  const handoffStatus = detectHandoffStatus(events);
  const nextAction = detectNextAction(events);
  const lastInbound = findLast(events, "inbound");
  const lastOutbound = findLast(events, "outbound");

  const lines = [
    "Austin Realty conversation summary",
    clipLine("Contact", unique([fullName, email, phone]).join(" | ")),
    clipLine("Channels", channels.join(", ")),
    clipLine("Intent", intent),
    clipLine("Appointment", appointmentStatus),
    clipLine("Handoff", handoffStatus),
    clipLine("Preferred channel", preferredChannel),
    clipLine("Latest inbound", lastInbound),
    clipLine("Latest outbound", lastOutbound),
    clipLine("Next action", nextAction),
    `Events reviewed: ${events.length}`,
  ].filter(Boolean) as string[];

  let text = lines.join("\n");
  const maxChars = Math.max(300, input.maxChars || 1800);
  if (text.length > maxChars) text = `${text.slice(0, maxChars - 1)}…`;

  return {
    text,
    eventCount: events.length,
    channels,
    contact: {
      contactId: input.contact?.contactId,
      fullName: fullName || undefined,
      email: email || undefined,
      phone: phone || undefined,
    },
    intent,
    appointmentStatus,
    handoffStatus,
    preferredChannel: preferredChannel || undefined,
    nextAction,
    lastInbound,
    lastOutbound,
  };
}

export function customFieldFromConversationSummary(summary: ConversationSummary, input?: { fieldId?: string; fieldKey?: string }) {
  const fieldId = clean(input?.fieldId || process.env.GHL_CONVERSATION_SUMMARY_FIELD_ID);
  const fieldKey = clean(input?.fieldKey || process.env.GHL_CONVERSATION_SUMMARY_FIELD_KEY || "conversation_summary");
  return {
    ...(fieldId ? { id: fieldId } : { key: fieldKey }),
    fieldValue: summary.text,
  };
}
