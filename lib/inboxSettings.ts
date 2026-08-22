import type { Channel } from "@/lib/inboxData";
import type { SheetRow } from "@/lib/sheetSchema";

export type InboxCategory = {
  slug: string;
  name: string;
  /** Short human explanation shown next to the toggle. Never written to the mailbox. */
  description: string;
  color: string;
  sort_order: number;
  enabled: boolean;
  gmail_label_id: string;
  gmail_label_name: string;
  auto_rules: Record<string, unknown>;
};

/**
 * Which organization shape the user picked during onboarding. `""` means they were never asked,
 * which is treated exactly like `leave_unchanged`: touch nothing.
 */
export type InboxOnboardingChoice = "" | "leave_unchanged" | "attention_only" | "custom";

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
  /** Which onboarding shape the user chose. Recording a choice is not consent to start. */
  onboarding_choice: InboxOnboardingChoice;
  /**
   * ISO timestamp of the ONE explicit "start organizing" action. Empty means the user has not
   * pressed it, and categorization stays inert even if `categorization_enabled` is somehow true.
   * Two independent facts are required before Iris reorganizes a mailbox: the opt-in and the start.
   */
  labelling_started_at: string;
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
// THE DECOUPLING PRIMITIVE: `auto_rules.mailbox`. A category may be written to a real mailbox if
// and only if `auto_rules.mailbox === true`. That flag — not the tier, not the name, not whether a
// row happens to carry a `gmail_label_name` — is what `lib/inboxLabelPlan.ts` reads. The status-tier
// rows in DEFAULT_INBOX_CATEGORIES stay because inferCategorySlug and the review-resolution logic
// derive INTERNAL thread state from those same slugs; they are marked `mailbox: false` so that
// internal state can never leak into a user's label list again.
export const MANAGED_SYSTEM_CATEGORY_SLUGS = ["auto_replied", "needs_human"] as const;

/** The only two labels Iris may create in a user's mailbox by default. */
export const MANAGED_SYSTEM_CATEGORIES: InboxCategory[] = [
  { slug: "auto_replied", name: "Auto Replied", description: "Iris sent this reply for you", color: "#0f766e", sort_order: 10, enabled: true, gmail_label_id: "", gmail_label_name: "Auto Replied", auto_rules: { tier: "system", mailbox: true, managed: true, auto_send: "off", applies_after_send: true, keep_in_inbox: true } },
  { slug: "needs_human", name: "Needs Human", description: "Iris stopped and left you a draft", color: "#be123c", sort_order: 20, enabled: true, gmail_label_id: "", gmail_label_name: "Needs Human", auto_rules: { tier: "system", mailbox: true, managed: true, auto_send: "off", status: ["needs_human"], keep_in_inbox: true } },
];

// INTERNAL workflow state, never a mailbox taxonomy. Every row is `mailbox: false`, so none of
// these can be created as a label or removed from a user's thread. inferCategorySlug reads them.
export const DEFAULT_INBOX_CATEGORIES: InboxCategory[] = [
  // Status tier. Internal workflow state, not a mailbox taxonomy. Do not write these as labels.
  { slug: "needs_human", name: "Needs Human", description: "Stopped for human review", color: "#be123c", sort_order: 10, enabled: true, gmail_label_id: "", gmail_label_name: "Needs Human", auto_rules: { tier: "status", mailbox: false, auto_send: "off", status: ["needs_human"] } },
  { slug: "needs_reply", name: "Needs Reply", description: "Waiting on an answer from us", color: "#7c3aed", sort_order: 20, enabled: true, gmail_label_id: "", gmail_label_name: "Needs Reply", auto_rules: { tier: "status", mailbox: false, auto_send: "off", status: ["received", "awaiting_response"] } },
  { slug: "waiting_lead", name: "Waiting on Reply", description: "We answered, waiting on them", color: "#a16207", sort_order: 30, enabled: true, gmail_label_id: "", gmail_label_name: "Waiting on Reply", auto_rules: { tier: "status", mailbox: false, auto_send: "off", status: ["awaiting_lead", "replied"] } },
  { slug: "nurture", name: "Nurture", description: "Long-horizon lead", color: "#57534e", sort_order: 40, enabled: true, gmail_label_id: "", gmail_label_name: "Nurture", auto_rules: { tier: "status", mailbox: false, auto_send: "off", words: ["later", "just looking", "not ready"] } },
  { slug: "closed_no_reply", name: "Closed / No Reply", description: "Closed or opted out", color: "#334155", sort_order: 50, enabled: true, gmail_label_id: "", gmail_label_name: "Closed No Reply", auto_rules: { tier: "status", mailbox: false, auto_send: "off", status: ["closed", "do_not_contact"] } },
  // Topic tier. Stackable. Organizational only: auto_send is "off" on every one of them now, so no
  // label can authorize a send. Sending is decided solely by decideIrisEmailExecution's Tier A gate.
  { slug: "hot_lead", name: "Hot Lead", description: "Ready to move now", color: "#dc2626", sort_order: 60, enabled: true, gmail_label_id: "", gmail_label_name: "Hot Lead", auto_rules: { tier: "topic", mailbox: false, auto_send: "off", words: ["tour", "showing", "today", "available"] } },
  { slug: "showing", name: "Showing", description: "Tour or showing logistics", color: "#c2410c", sort_order: 70, enabled: true, gmail_label_id: "", gmail_label_name: "Showing", auto_rules: { tier: "topic", mailbox: false, auto_send: "off", words: ["tour", "showing", "schedule", "appointment"] } },
  { slug: "seller_valuation", name: "Seller / Valuation", description: "Listing or valuation interest", color: "#0f766e", sort_order: 80, enabled: true, gmail_label_id: "", gmail_label_name: "Seller Valuation", auto_rules: { tier: "topic", mailbox: false, auto_send: "off", words: ["sell", "valuation", "home value", "list my"] } },
  { slug: "financing", name: "Financing", description: "Lender or mortgage topic", color: "#2563eb", sort_order: 90, enabled: true, gmail_label_id: "", gmail_label_name: "Financing", auto_rules: { tier: "topic", mailbox: false, auto_send: "off", words: ["preapproved", "mortgage", "loan", "down payment"] } },
];

/**
 * Opt-in mailbox organization presets. NOT applied unless the user turns categorization on, picks
 * a shape, and presses start. Deliberately a brokerage-desk taxonomy rather than a generic office
 * one: these are the piles a realtor's mail actually falls into.
 *
 * `keep_in_inbox` drives the keep-versus-move split in the settings UI and in the label plan.
 * None of them can authorize a send.
 */
export const OPTIONAL_CATEGORY_PRESETS: InboxCategory[] = [
  { slug: "lead_waiting", name: "Lead Waiting", description: "A lead is waiting on a person", color: "#dc2626", sort_order: 100, enabled: false, gmail_label_id: "", gmail_label_name: "Lead Waiting", auto_rules: { tier: "topic", mailbox: true, auto_send: "off", keep_in_inbox: true } },
  { slug: "no_action", name: "No Action Needed", description: "Worth reading, nothing to do", color: "#0e7490", sort_order: 110, enabled: false, gmail_label_id: "", gmail_label_name: "No Action Needed", auto_rules: { tier: "topic", mailbox: true, auto_send: "off", keep_in_inbox: true } },
  { slug: "awaiting_reply", name: "Awaiting Their Reply", description: "We answered, ball is with them", color: "#a16207", sort_order: 120, enabled: false, gmail_label_id: "", gmail_label_name: "Awaiting Their Reply", auto_rules: { tier: "topic", mailbox: true, auto_send: "off", keep_in_inbox: false } },
  { slug: "transaction_admin", name: "Transaction Admin", description: "Title, lender, inspection, invoices", color: "#2563eb", sort_order: 130, enabled: false, gmail_label_id: "", gmail_label_name: "Transaction Admin", auto_rules: { tier: "topic", mailbox: true, auto_send: "off", keep_in_inbox: false } },
  { slug: "listing_alerts", name: "Listing Alerts", description: "Portal and MLS digests", color: "#15803d", sort_order: 140, enabled: false, gmail_label_id: "", gmail_label_name: "Listing Alerts", auto_rules: { tier: "topic", mailbox: true, auto_send: "off", keep_in_inbox: false } },
  { slug: "bulk_promotions", name: "Bulk Promotions", description: "Bulk sales mail and newsletters", color: "#475569", sort_order: 150, enabled: false, gmail_label_id: "", gmail_label_name: "Bulk Promotions", auto_rules: { tier: "topic", mailbox: true, auto_send: "off", keep_in_inbox: false } },
];

/**
 * The three onboarding shapes, offered as one exclusive choice followed by one explicit start.
 * `leave_unchanged` is the recommended default and enables nothing at all.
 */
export const INBOX_ONBOARDING_PRESETS: Array<{
  choice: Exclude<InboxOnboardingChoice, "">;
  title: string;
  detail: string;
  recommended: boolean;
  categorization_enabled: boolean;
  marketing_strictness: InboxSettings["marketing_strictness"];
  category_slugs: string[];
}> = [
  {
    choice: "leave_unchanged",
    title: "Leave my inbox organization alone",
    detail: "Iris still labels what it replied to and what it stopped on. Nothing is sorted or moved.",
    recommended: true,
    categorization_enabled: false,
    marketing_strictness: "off",
    category_slugs: [],
  },
  {
    choice: "attention_only",
    title: "Only flag what needs a person",
    detail: "Two labels stay in the inbox so a lead waiting on a human is obvious. Nothing is moved out.",
    recommended: false,
    categorization_enabled: true,
    marketing_strictness: "off",
    category_slugs: ["lead_waiting", "no_action"],
  },
  {
    choice: "custom",
    title: "Sort my mail into desk piles",
    detail: "Pick which piles Iris keeps in the inbox and which it files away. Every pile is editable.",
    recommended: false,
    categorization_enabled: true,
    marketing_strictness: "obvious_sales",
    category_slugs: ["lead_waiting", "no_action", "awaiting_reply", "transaction_admin", "listing_alerts", "bulk_promotions"],
  },
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
  onboarding_choice: "",
  labelling_started_at: "",
};

/**
 * Slugs that exist ONLY as internal workflow state. inferCategorySlug and the review-resolution
 * logic derive thread state from these, so they can never become a label however a caller asks.
 * A slug the shipped set does not claim is a user's own pile and may be a mailbox label.
 */
const INTERNAL_ONLY_SLUGS: ReadonlySet<string> = new Set(
  DEFAULT_INBOX_CATEGORIES
    .map((category) => category.slug)
    .filter((slug) => (
      !MANAGED_SYSTEM_CATEGORY_SLUGS.includes(slug as typeof MANAGED_SYSTEM_CATEGORY_SLUGS[number])
      && !OPTIONAL_CATEGORY_PRESETS.some((preset) => preset.slug === slug)
    )),
);

export function normalizeInboxCategory(input: Partial<InboxCategory>, fallback?: InboxCategory): InboxCategory {
  const base = fallback || DEFAULT_INBOX_CATEGORIES[0];
  const name = String(input.name || base.name).trim().slice(0, 80);
  const rules = input.auto_rules && typeof input.auto_rules === "object" ? input.auto_rules : base.auto_rules;
  const slug = String(input.slug || base.slug).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return {
    slug,
    name,
    description: String(input.description ?? base.description ?? "").trim().slice(0, 160),
    color: /^#[0-9a-f]{6}$/i.test(String(input.color || "")) ? String(input.color) : base.color,
    sort_order: Number.isFinite(Number(input.sort_order)) ? Number(input.sort_order) : base.sort_order,
    enabled: input.enabled == null ? base.enabled : Boolean(input.enabled),
    gmail_label_id: String(input.gmail_label_id || ""),
    gmail_label_name: String(input.gmail_label_name || input.name || base.gmail_label_name || base.name).trim().slice(0, 120),
    // A caller-supplied rule blob must never be able to promote an internal-only row into the
    // mailbox, nor to hand itself a send permission. Both are re-derived, never trusted.
    auto_rules: { ...rules, mailbox: rules.mailbox === true && !INTERNAL_ONLY_SLUGS.has(slug), auto_send: "off" },
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
    onboarding_choice: (["", "leave_unchanged", "attention_only", "custom"] as const).includes(input.onboarding_choice as never)
      ? input.onboarding_choice as InboxOnboardingChoice
      : "",
    // An unparseable timestamp is treated as "never started". Garbage must not read as consent.
    labelling_started_at: Number.isFinite(Date.parse(String(input.labelling_started_at || "")))
      ? String(input.labelling_started_at)
      : "",
  };
}

/**
 * PATCH semantics for a settings save. Each dashboard card sends only the keys it owns, and
 * `normalizeInboxSettings` fills every absent key from the DEFAULTS — so a partial save has to be
 * merged over stored state first. Without this, saving the reply-automation card would quietly
 * switch a tenant's mailbox organization back off.
 */
export function mergeInboxSettings(stored: InboxSettings, patch: Partial<InboxSettings> = {}): InboxSettings {
  const defined = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  return normalizeInboxSettings({ ...stored, ...defined });
}

/**
 * Categorization is inert unless BOTH facts hold: the user opted in AND pressed start once.
 * Every mailbox-reorganizing decision routes through here, so a half-saved settings row, a
 * restored backup, or a stray `categorization_enabled: true` cannot reorganize anyone's mail.
 */
export function categorizationActive(settings: InboxSettings): boolean {
  return settings.categorization_enabled === true && settings.labelling_started_at.trim().length > 0;
}

/**
 * The categories Iris is allowed to write into a real mailbox, in display order. Always the two
 * managed system labels; the opt-in piles only once categorization is actually active.
 *
 * `mailbox !== true` rows are internal machine state and are filtered out here — that filter is the
 * single choke point keeping slugs like `needs_reply` or `hot_lead` out of a user's label list.
 */
export function mailboxCategories(settings: InboxSettings, categories: InboxCategory[]): InboxCategory[] {
  const managed = MANAGED_SYSTEM_CATEGORIES;
  if (!categorizationActive(settings)) return managed;
  const managedSlugs = new Set<string>(MANAGED_SYSTEM_CATEGORY_SLUGS);
  const optional = categories
    .filter((category) => category.enabled && category.auto_rules?.mailbox === true && !managedSlugs.has(category.slug))
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  return [...managed, ...optional];
}

/** Opt-in piles the user chose to keep visible in the inbox rather than file away. */
export function keepsInInbox(category: InboxCategory): boolean {
  return category.auto_rules?.keep_in_inbox === true;
}

/** Apply an onboarding preset to settings + categories without starting anything. */
export function applyOnboardingPreset(
  choice: Exclude<InboxOnboardingChoice, "">,
  settings: InboxSettings,
  categories: InboxCategory[] = [],
): { settings: InboxSettings; categories: InboxCategory[] } {
  const preset = INBOX_ONBOARDING_PRESETS.find((entry) => entry.choice === choice) || INBOX_ONBOARDING_PRESETS[0];
  const selected = new Set(preset.category_slugs);
  const bySlug = new Map(categories.map((category) => [category.slug, category] as const));
  const merged = OPTIONAL_CATEGORY_PRESETS.map((preseted) => {
    const existing = bySlug.get(preseted.slug);
    return normalizeInboxCategory({ ...(existing || preseted), enabled: selected.has(preseted.slug) }, preseted);
  });
  return {
    settings: normalizeInboxSettings({
      ...settings,
      categorization_enabled: preset.categorization_enabled,
      marketing_strictness: preset.marketing_strictness,
      onboarding_choice: choice,
      // Choosing a shape is never the start action. The user still has to press start.
      labelling_started_at: "",
    }),
    categories: merged,
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
