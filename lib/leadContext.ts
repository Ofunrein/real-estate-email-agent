import crypto from "node:crypto";

import type { Channel } from "@/lib/inboxData";
import type { SheetRow } from "@/lib/sheetSchema";

export type LeadCapturePayload = {
  provider: string;
  source_type: "lead_ad" | "valuation" | "listing" | "qr" | "website_form" | "other";
  source_id?: string;
  campaign?: Record<string, unknown>;
  clicked_property?: Record<string, unknown>;
  lead: { name?: string; phone?: string; email?: string; role?: string; budget?: string; area?: string; timeline?: string; preferred_channel?: string };
  behavior?: Record<string, unknown>;
  message?: string;
  consent?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type LeadContextEnvelope = {
  identity: { name: string; phone: string; email: string; socialHandle: string };
  source: { provider: string; sourceType: string; sourceId: string; campaign: Record<string, unknown> };
  behavior: Record<string, unknown>;
  property: Record<string, unknown>;
  profile: { role: string; budget: string; area: string; timeline: string; bedrooms: string; bathrooms: string; sellBeforeBuy: string };
  conversation: { channel: Channel; threadRef: string; preferredChannel: string; recentEvents: SheetRow[] };
  consent: { sms: string; whatsapp: string; email: string; call: string; doNotContact: boolean };
  state: { handoffStatus: string; handoffReason: string; lastAiTouchAt: string };
  safety: { activeTakeover: boolean };
  fingerprint: string;
};

function text(value: unknown): string { return String(value || "").replace(/\s+/g, " ").trim(); }
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

export function leadCaptureDedupeKey(payload: LeadCapturePayload, supplied = ""): string {
  const explicit = text(supplied);
  if (explicit) return explicit;
  const stable = payload.source_id || [payload.provider, payload.source_type, payload.lead.email, payload.lead.phone, payload.message].map(text).join("|");
  return `lead-capture:${crypto.createHash("sha256").update(stable).digest("hex").slice(0, 32)}`;
}

export function buildLeadContextEnvelope(input: {
  channel: Channel; threadRef: string; lead?: Partial<SheetRow>; events?: SheetRow[]; provider?: string;
  providerMetadata?: Record<string, unknown>; activeTakeover?: boolean;
}): LeadContextEnvelope {
  const lead = input.lead || {};
  const events = input.events || [];
  const metadata = record(input.providerMetadata);
  const campaign = record(metadata.campaign);
  const behavior = record(metadata.behavior);
  const property = record(metadata.clicked_property || metadata.clickedProperty);
  const latest = events.at(-1) || {};
  const envelope = {
    identity: { name: text(lead.full_name || latest.full_name || metadata.senderName), phone: text(lead.phone || latest.phone), email: text(lead.email || latest.email), socialHandle: text(metadata.senderUsername || metadata.socialHandle) },
    source: { provider: text(input.provider || metadata.provider || latest.source), sourceType: text(metadata.source_type || metadata.sourceType), sourceId: text(metadata.source_id || metadata.sourceId), campaign },
    behavior,
    property,
    profile: { role: text(lead.lead_role), budget: text(lead.budget), area: text(lead.area), timeline: text(lead.timeline), bedrooms: text(lead.bedrooms), bathrooms: text(lead.bathrooms), sellBeforeBuy: text(lead.sell_before_buy) },
    conversation: { channel: input.channel, threadRef: input.threadRef, preferredChannel: text(lead.preferred_channel || input.channel), recentEvents: events.slice(-20) },
    consent: { sms: text(lead.sms_consent), whatsapp: text(lead.whatsapp_consent || lead.sms_consent), email: text(lead.email_consent), call: text(lead.call_consent), doNotContact: /^(no|true|1)$/i.test(text(lead.do_not_contact)) },
    state: { handoffStatus: text(lead.handoff_status), handoffReason: text(lead.handoff_reason), lastAiTouchAt: text(lead.last_ai_touch_at) },
    safety: { activeTakeover: Boolean(input.activeTakeover) },
  };
  return { ...envelope, fingerprint: crypto.createHash("sha256").update(JSON.stringify(envelope)).digest("hex") };
}

export function renderChannelReply(channel: Channel, draft: string): string {
  const clean = text(draft);
  if (!clean) return "";
  if (channel === "sms") return clean.length <= 320 ? clean : `${clean.slice(0, 317).trimEnd()}...`;
  if (["instagram", "messenger", "whatsapp", "website", "website_chat", "web"].includes(channel)) {
    return clean.length <= 500 ? clean : `${clean.slice(0, 497).trimEnd()}...`;
  }
  return clean;
}
