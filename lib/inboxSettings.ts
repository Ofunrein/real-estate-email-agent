import type { Channel } from "@/lib/inboxData";
import type { SheetRow } from "@/lib/sheetSchema";

export type InboxCategory = {
  slug: string;
  name: string;
  color: string;
  sort_order: number;
  enabled: boolean;
  gmail_label_id: string;
  gmail_label_name: string;
  auto_rules: Record<string, unknown>;
};

export type InboxSettings = {
  draft_first: boolean;
  auto_send: Record<Exclude<Channel, "voice" | "unknown">, boolean>;
  channels_enabled: Record<Exclude<Channel, "voice" | "unknown">, boolean>;
  cache_status: Record<string, unknown>;
};

export type AiDraft = {
  thread_ref: string;
  channel: string;
  body: string;
  category_slug: string;
  confidence: number;
  reason: string;
  next_action: string;
  safe_to_auto_send: boolean;
  needs_human: boolean;
  model: string;
  status: string;
  fingerprint: string;
  gmail_draft_id?: string;
  gmail_message_id?: string;
  gmail_thread_id?: string;
  gmail_mailbox_email?: string;
  gmail_draft_synced_at?: string;
  updated_at: string;
};

export type EmailCapability = {
  scope: string;
  label: string;
  granted: boolean;
};

export const DEFAULT_INBOX_CATEGORIES: InboxCategory[] = [
  { slug: "needs_reply", name: "Needs Reply", color: "#7c3aed", sort_order: 10, enabled: true, gmail_label_id: "", gmail_label_name: "Iris/Needs Reply", auto_rules: { status: ["received", "awaiting_response"] } },
  { slug: "hot_lead", name: "Hot Lead", color: "#dc2626", sort_order: 20, enabled: true, gmail_label_id: "", gmail_label_name: "Iris/Hot Lead", auto_rules: { words: ["tour", "showing", "today", "available"] } },
  { slug: "showing", name: "Showing", color: "#ea580c", sort_order: 30, enabled: true, gmail_label_id: "", gmail_label_name: "Iris/Showing", auto_rules: { words: ["tour", "showing", "schedule", "appointment"] } },
  { slug: "seller_valuation", name: "Seller / Valuation", color: "#0f766e", sort_order: 40, enabled: true, gmail_label_id: "", gmail_label_name: "Iris/Seller Valuation", auto_rules: { words: ["sell", "valuation", "home value", "list my"] } },
  { slug: "financing", name: "Financing", color: "#2563eb", sort_order: 50, enabled: true, gmail_label_id: "", gmail_label_name: "Iris/Financing", auto_rules: { words: ["preapproved", "mortgage", "loan", "down payment"] } },
  { slug: "needs_human", name: "Needs Human", color: "#be123c", sort_order: 60, enabled: true, gmail_label_id: "", gmail_label_name: "Iris/Needs Human", auto_rules: { status: ["needs_human"] } },
  { slug: "nurture", name: "Nurture", color: "#64748b", sort_order: 70, enabled: true, gmail_label_id: "", gmail_label_name: "Iris/Nurture", auto_rules: { words: ["later", "just looking", "not ready"] } },
  { slug: "closed_no_reply", name: "Closed / No Reply", color: "#334155", sort_order: 80, enabled: true, gmail_label_id: "", gmail_label_name: "Iris/Closed No Reply", auto_rules: { status: ["closed", "do_not_contact"] } },
];

export const DEFAULT_INBOX_SETTINGS: InboxSettings = {
  draft_first: false,
  auto_send: {
    email: true,
    sms: true,
    whatsapp: true,
    messenger: true,
    instagram: true,
    website_chat: true,
  },
  channels_enabled: {
    email: true,
    sms: true,
    whatsapp: true,
    messenger: true,
    instagram: true,
    website_chat: true,
  },
  cache_status: {},
};

export function normalizeInboxCategory(input: Partial<InboxCategory>, fallback?: InboxCategory): InboxCategory {
  const base = fallback || DEFAULT_INBOX_CATEGORIES[0];
  return {
    slug: String(input.slug || base.slug).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""),
    name: String(input.name || base.name).trim().slice(0, 80),
    color: /^#[0-9a-f]{6}$/i.test(String(input.color || "")) ? String(input.color) : base.color,
    sort_order: Number.isFinite(Number(input.sort_order)) ? Number(input.sort_order) : base.sort_order,
    enabled: input.enabled == null ? base.enabled : Boolean(input.enabled),
    gmail_label_id: String(input.gmail_label_id || ""),
    gmail_label_name: String(input.gmail_label_name || input.name || base.gmail_label_name || base.name).trim().slice(0, 120),
    auto_rules: input.auto_rules && typeof input.auto_rules === "object" ? input.auto_rules : base.auto_rules,
  };
}

export function normalizeInboxSettings(input: Partial<InboxSettings> = {}): InboxSettings {
  return {
    draft_first: input.draft_first == null ? DEFAULT_INBOX_SETTINGS.draft_first : Boolean(input.draft_first),
    auto_send: { ...DEFAULT_INBOX_SETTINGS.auto_send, ...(input.auto_send || {}) },
    channels_enabled: { ...DEFAULT_INBOX_SETTINGS.channels_enabled, ...(input.channels_enabled || {}) },
    cache_status: input.cache_status && typeof input.cache_status === "object" ? input.cache_status : {},
  };
}

export function shouldAutoSendForChannel(settings: InboxSettings, channel: Exclude<Channel, "voice" | "unknown">): boolean {
  return !settings.draft_first && settings.auto_send[channel] !== false;
}

export function channelEnabled(settings: InboxSettings, channel: Exclude<Channel, "voice" | "unknown">): boolean {
  return settings.channels_enabled[channel] !== false;
}

export function inferCategorySlug(events: SheetRow[], categories: InboxCategory[] = DEFAULT_INBOX_CATEGORIES): string {
  const latest = events[events.length - 1] || {};
  const latestReviewResolvedAt = Math.max(
    0,
    ...events
      .filter((event) => event.status === "review_resolved" || event.ai_action === "resume_ai" || /\breview_resolved\b/i.test(event.event_type || ""))
      .map((event) => Date.parse(event.event_at || event.created_at || ""))
      .filter(Number.isFinite),
  );
  const latestInboundIndex = [...events].reverse().findIndex((event) => event.direction === "inbound");
  const latestInbound = latestInboundIndex >= 0 ? events[events.length - 1 - latestInboundIndex] : {};
  const latestInboundAt = Date.parse(latestInbound.event_at || latestInbound.created_at || "");
  const inboundAfterReviewResolved = Number.isFinite(latestInboundAt) && latestInboundAt > latestReviewResolvedAt;
  const latestOutboundAfterInbound = Number.isFinite(latestInboundAt)
    ? events.some((event) => {
      if (event.direction === "inbound") return false;
      const eventAt = Date.parse(event.event_at || event.created_at || "");
      return Number.isFinite(eventAt) && eventAt > latestInboundAt;
    })
    : false;
  const categoryEvents = latestReviewResolvedAt
    ? events.filter((event) => {
      const eventAt = Date.parse(event.event_at || event.created_at || "");
      return Number.isFinite(eventAt) ? eventAt > latestReviewResolvedAt : true;
    })
    : events;
  const text = categoryEvents
    .slice(-6)
    .map((event) => `${event.status} ${event.event_type} ${event.ai_action} ${event.handoff_reason} ${event.summary} ${event.message_text}`)
    .join(" ")
    .toLowerCase();
  const latestInboundText = `${latestInbound.status || ""} ${latestInbound.summary || ""} ${latestInbound.message_text || ""}`.toLowerCase();
  const latestInboundIsSocial = ["instagram", "messenger"].includes(String(latestInbound.channel || "").toLowerCase());
  let slug = "needs_reply";
  if (
    latestInboundIsSocial &&
    inboundAfterReviewResolved &&
    !latestOutboundAfterInbound &&
    /\b(interested|property|home|house|listing|tour|showing|available|buy|sell|rent|smoking)\b/i.test(latestInboundText)
  ) slug = "needs_human";
  else if (latest.status === "needs_human" || /\b(needs_human|handoff|fair housing|human review)\b/i.test(text)) slug = "needs_human";
  else if (/\b(tour|showing|schedule|appointment|book)\b/i.test(text)) slug = "showing";
  else if (/\b(sell|seller|valuation|home value|list my)\b/i.test(text)) slug = "seller_valuation";
  else if (/\b(mortgage|loan|pre.?approved|down payment|credit score)\b/i.test(text)) slug = "financing";
  else if (/\b(hot lead|today|asap|right now|available)\b/i.test(text)) slug = "hot_lead";
  else if (/\b(later|not ready|just looking|nurture)\b/i.test(text)) slug = "nurture";
  else if (/\b(closed|do_not_contact|stop)\b/i.test(text)) slug = "closed_no_reply";
  return categories.some((category) => category.slug === slug && category.enabled) ? slug : "needs_reply";
}

export function categoryBySlug(categories: InboxCategory[], slug: string): InboxCategory {
  return categories.find((category) => category.slug === slug) || DEFAULT_INBOX_CATEGORIES[0];
}
