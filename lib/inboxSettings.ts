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
  /** Opt-in. Off means Iris applies only the two managed system labels and sorts nothing. */
  categorization_enabled: boolean;
  /** On by default: never sort mail that already carries the user's own labels/categories. */
  respect_existing_labels: boolean;
  /** Opt-in. Off means Iris never moves a thread out of the inbox after replying. */
  archive_after_send: boolean;
  /** Only meaningful when categorization is on. Never a default behavior. */
  marketing_strictness: "off" | "obvious_sales" | "cold_and_unknown" | "cold_unknown_newsletters" | "not_useful_to_work";
  /** Optional deterministic routing rules. Organizational only; cannot authorize a send. */
  category_rules: Array<{
    category_slug: string;
    sender?: string;
    domain?: string;
    exact_subject?: string;
  }>;
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

// Exactly TWO Iris-managed user-facing labels ship by default. They record what Iris DID, not a
// taxonomy of the user's inbox, which is why they survive when categorization is off. Clean title
// case, no `Iris/` prefix.
//
// `Auto Replied` is written only after a reply is actually and successfully sent, and is never read
// to decide behavior. `Needs Human` marks a stop for human review and never triggers a send.
// Neither label authorizes anything: sending is gated solely by decideIrisEmailExecution's Tier A
// allowlist. Internal machine states stay in the database and must not leak into the mailbox.
//
// Everything else — To Respond, FYI, Notification, Marketing, Real Estate/* — is OPT-IN only, via
// `categorization_enabled`. Do not reintroduce them as defaults.
// TARGET (direction 2026-08-22): exactly TWO Iris-managed user-facing labels, `Auto Replied` and
// `Needs Human`, clean title case, no `Iris/` prefix. Everything below is OPT-IN only.
//
// NOT YET SWITCHED OVER, deliberately. The status-tier rows below double as INTERNAL machine state:
// inferCategorySlug and the review-resolution logic derive thread state from these same slugs. So
// deleting them to leave only the two managed labels breaks 5 tests covering stale-needs-human
// clearing and proactive review drafts. Internal state has to be decoupled from the user-facing
// label set first — that is the next slice, and it is a real refactor, not a rename.
//
// Until then these remain internal-facing. `MANAGED_SYSTEM_CATEGORY_SLUGS` records the two labels
// that may ever be written to a mailbox; anything else must not leak there.
export const MANAGED_SYSTEM_CATEGORY_SLUGS = ["auto_replied", "needs_human"] as const;

/** The only two labels Iris may create in a user's mailbox by default. */
export const MANAGED_SYSTEM_CATEGORIES: InboxCategory[] = [
  { slug: "auto_replied", name: "Auto Replied", color: "#0f766e", sort_order: 10, enabled: true, gmail_label_id: "", gmail_label_name: "Auto Replied", auto_rules: { tier: "system", managed: true, auto_send: "off", applies_after_send: true } },
  { slug: "needs_human", name: "Needs Human", color: "#be123c", sort_order: 20, enabled: true, gmail_label_id: "", gmail_label_name: "Needs Human", auto_rules: { tier: "system", managed: true, auto_send: "off", status: ["needs_human"] } },
];

export const DEFAULT_INBOX_CATEGORIES: InboxCategory[] = [
  // Status tier. Internal workflow state, not a mailbox taxonomy. Do not write these as labels.
  { slug: "needs_human", name: "Needs Human", color: "#be123c", sort_order: 10, enabled: true, gmail_label_id: "", gmail_label_name: "Needs Human", auto_rules: { tier: "status", auto_send: "off", status: ["needs_human"] } },
  { slug: "needs_reply", name: "Needs Reply", color: "#7c3aed", sort_order: 20, enabled: true, gmail_label_id: "", gmail_label_name: "Needs Reply", auto_rules: { tier: "status", auto_send: "off", status: ["received", "awaiting_response"] } },
  { slug: "waiting_lead", name: "Waiting on Reply", color: "#a16207", sort_order: 30, enabled: true, gmail_label_id: "", gmail_label_name: "Waiting on Reply", auto_rules: { tier: "status", auto_send: "off", status: ["awaiting_lead", "replied"] } },
  { slug: "nurture", name: "Nurture", color: "#57534e", sort_order: 40, enabled: true, gmail_label_id: "", gmail_label_name: "Nurture", auto_rules: { tier: "status", auto_send: "off", words: ["later", "just looking", "not ready"] } },
  { slug: "closed_no_reply", name: "Closed / No Reply", color: "#334155", sort_order: 50, enabled: true, gmail_label_id: "", gmail_label_name: "Closed No Reply", auto_rules: { tier: "status", auto_send: "off", status: ["closed", "do_not_contact"] } },
  // Topic tier. Stackable. Organizational only: auto_send is "off" on every one of them now, so no
  // label can authorize a send. Sending is decided solely by decideIrisEmailExecution's Tier A gate.
  { slug: "hot_lead", name: "Hot Lead", color: "#dc2626", sort_order: 60, enabled: true, gmail_label_id: "", gmail_label_name: "Hot Lead", auto_rules: { tier: "topic", auto_send: "off", words: ["tour", "showing", "today", "available"] } },
  { slug: "showing", name: "Showing", color: "#c2410c", sort_order: 70, enabled: true, gmail_label_id: "", gmail_label_name: "Showing", auto_rules: { tier: "topic", auto_send: "off", words: ["tour", "showing", "schedule", "appointment"] } },
  { slug: "seller_valuation", name: "Seller / Valuation", color: "#0f766e", sort_order: 80, enabled: true, gmail_label_id: "", gmail_label_name: "Seller Valuation", auto_rules: { tier: "topic", auto_send: "off", words: ["sell", "valuation", "home value", "list my"] } },
  { slug: "financing", name: "Financing", color: "#2563eb", sort_order: 90, enabled: true, gmail_label_id: "", gmail_label_name: "Financing", auto_rules: { tier: "topic", auto_send: "off", words: ["preapproved", "mortgage", "loan", "down payment"] } },
];

/**
 * Opt-in presets for the Categorization settings area. NOT applied unless the user turns
 * categorization on and picks them. None of them can authorize a send.
 */
export const OPTIONAL_CATEGORY_PRESETS: InboxCategory[] = [
  { slug: "to_respond", name: "To Respond", color: "#7c3aed", sort_order: 100, enabled: false, gmail_label_id: "", gmail_label_name: "To Respond", auto_rules: { tier: "topic", auto_send: "off", keep_in_inbox: true } },
  { slug: "fyi", name: "FYI", color: "#0e7490", sort_order: 110, enabled: false, gmail_label_id: "", gmail_label_name: "FYI", auto_rules: { tier: "topic", auto_send: "off", keep_in_inbox: true } },
  { slug: "notification", name: "Notification", color: "#15803d", sort_order: 120, enabled: false, gmail_label_id: "", gmail_label_name: "Notification", auto_rules: { tier: "topic", auto_send: "off", keep_in_inbox: false } },
  { slug: "to_follow_up", name: "To Follow Up", color: "#a16207", sort_order: 130, enabled: false, gmail_label_id: "", gmail_label_name: "To Follow Up", auto_rules: { tier: "topic", auto_send: "off", keep_in_inbox: false } },
  { slug: "marketing", name: "Marketing", color: "#475569", sort_order: 140, enabled: false, gmail_label_id: "", gmail_label_name: "Marketing", auto_rules: { tier: "topic", auto_send: "off", keep_in_inbox: false } },
];

// Email is draft-first by default: auto_send.email starts false, so an email reply needs both an
// explicit per-client opt-in AND every Tier A gate in decideIrisEmailExecution. Shipping
// auto_send.email:true is what let cold outbound sales mail receive a real auto-reply with a
// property card and a valuation CTA attached.
//
// draft_first stays false because it is a GLOBAL kill switch across every channel — flipping it
// would silently disable SMS, WhatsApp and social auto-send too, which is not the intent here.
export const DEFAULT_INBOX_SETTINGS: InboxSettings = {
  draft_first: false,
  auto_send: {
    email: false,
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
  // Respect the user's inbox. Categorization off, existing labels untouched, nothing archived.
  categorization_enabled: false,
  respect_existing_labels: true,
  archive_after_send: false,
  marketing_strictness: "off",
  category_rules: [],
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
    categorization_enabled: input.categorization_enabled == null
      ? DEFAULT_INBOX_SETTINGS.categorization_enabled
      : Boolean(input.categorization_enabled),
    // Defaults to ON. An absent value must never be read as permission to re-sort the user's mail.
    respect_existing_labels: input.respect_existing_labels == null
      ? DEFAULT_INBOX_SETTINGS.respect_existing_labels
      : Boolean(input.respect_existing_labels),
    archive_after_send: input.archive_after_send == null
      ? DEFAULT_INBOX_SETTINGS.archive_after_send
      : Boolean(input.archive_after_send),
    marketing_strictness: (["off", "obvious_sales", "cold_and_unknown", "cold_unknown_newsletters", "not_useful_to_work"] as const)
      .includes(input.marketing_strictness as never)
      ? input.marketing_strictness as InboxSettings["marketing_strictness"]
      : DEFAULT_INBOX_SETTINGS.marketing_strictness,
    category_rules: Array.isArray(input.category_rules)
      ? input.category_rules.filter((rule) => rule && typeof rule.category_slug === "string" && rule.category_slug.trim().length > 0).slice(0, 200)
      : [],
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
  if (latestOutboundAfterInbound) slug = "waiting_lead";
  else if (
    latestInboundIsSocial &&
    inboundAfterReviewResolved &&
    !latestOutboundAfterInbound &&
    /\b(interested|property|home|house|listing|tour|showing|available|buy|sell|rent|smoking)\b/i.test(latestInboundText)
  ) slug = "needs_human";
  else if (!latestOutboundAfterInbound && (latest.status === "needs_human" || /\b(needs_human|handoff|fair housing|human review)\b/i.test(text))) slug = "needs_human";
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
