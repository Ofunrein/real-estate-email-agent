import {
  categorizationActive,
  keepsInInbox,
  mailboxCategories,
  MANAGED_SYSTEM_CATEGORIES,
  type InboxCategory,
  type InboxSettings,
} from "@/lib/inboxSettings";

/**
 * The ONLY place that decides what Iris writes into a real mailbox.
 *
 * Provider-neutral on purpose: it returns label NAMES and two booleans, so the Gmail path and the
 * Outlook path apply the same plan through their own APIs. Pure — no I/O, no clock, no provider
 * types — so every rule below is directly testable and the same plan can be rendered as a dry-run
 * preview without touching an account.
 *
 * Two invariants this module exists to enforce:
 *   1. A label is EVIDENCE, never a permission. Nothing here returns "may send". Sending is decided
 *      solely by decideIrisEmailExecution's Tier A allowlist in lib/irisEmail.ts.
 *   2. Internal machine state never reaches a mailbox. Only categories flagged
 *      `auto_rules.mailbox === true` are eligible, and only the two managed system labels are
 *      eligible by default.
 */

export const AUTO_REPLIED_LABEL = MANAGED_SYSTEM_CATEGORIES
  .find((category) => category.slug === "auto_replied")!.gmail_label_name;
export const NEEDS_HUMAN_LABEL = MANAGED_SYSTEM_CATEGORIES
  .find((category) => category.slug === "needs_human")!.gmail_label_name;

/** Everything the plan is allowed to look at. Deliberately not the whole message. */
export type MailboxSignals = {
  fromEmail?: string;
  subject?: string;
  body?: string;
  /** A `List-Unsubscribe` header was present. */
  listUnsubscribe?: boolean;
  /** `Precedence: bulk`, or an equivalent bulk marker. */
  bulk?: boolean;
  /** The sender is an existing lead/contact for this tenant. */
  knownContact?: boolean;
  /** Labels/categories already on the thread, whoever put them there. */
  existingLabels?: string[];
};

export type MailboxLabelPlan = {
  /** Exact label names to add. Subset of `managedLabels`. */
  addLabels: string[];
  /**
   * Label names Iris owns and may therefore REMOVE when they are not in `addLabels`. Anything
   * outside this list is the user's own organization and is never touched.
   */
  managedLabels: string[];
  /** Remove from the inbox (Gmail: drop INBOX; Outlook: move out of the inbox folder). */
  removeFromInbox: boolean;
  /** The opt-in pile this thread was sorted into, or "" when nothing was sorted. */
  categorySlug: string;
  /** Human-readable audit trail. Rendered in the dry-run preview and written to the audit log. */
  reasons: string[];
};

export type MailboxLabelPlanInput = {
  settings: InboxSettings;
  /** Configured categories for the tenant. Internal-only rows are filtered out by the plan. */
  categories?: InboxCategory[];
  /**
   * TRUE only when an authorized reply was actually and successfully delivered. A queued send, a
   * saved draft, a duplicate skip, or a send that threw are all FALSE.
   */
  sendConfirmed: boolean;
  /** TRUE only when Iris stopped and handed the thread to a human. */
  stoppedForReview: boolean;
  signals?: MailboxSignals;
};

/** Escalating bulk-mail bar. Each level is a superset of the one before it. */
const MARKETING_LEVELS: Record<InboxSettings["marketing_strictness"], number> = {
  off: 0,
  obvious_sales: 1,
  cold_and_unknown: 2,
  cold_unknown_newsletters: 3,
  not_useful_to_work: 4,
};

const OBVIOUS_SALES = /\b(unsubscribe|book a demo|schedule a demo|free trial|limited time|act now|special offer|% off|discount code|webinar|sponsored)\b/i;
const NEWSLETTER = /\b(newsletter|digest|weekly round-?up|monthly round-?up|view in browser|manage preferences|email preferences)\b/i;
const COLD_OUTREACH = /\b(quick question|checking in|following up|circling back|touching base|partnership|integrat(?:e|ion)|lead gen|cold email|saas|platform demo)\b/i;
const NOT_USEFUL = /\b(survey|feedback request|product update|release notes|community update|event invite|conference|meetup|job alert)\b/i;

/**
 * Is this bulk/marketing mail at the configured strictness? Off is off: it never matches, so
 * turning categorization on does not silently start filing a realtor's referral mail.
 */
export function matchesMarketingStrictness(
  strictness: InboxSettings["marketing_strictness"],
  signals: MailboxSignals = {},
): boolean {
  const level = MARKETING_LEVELS[strictness] ?? 0;
  if (level === 0) return false;
  const text = `${signals.subject || ""}\n${signals.body || ""}`;
  const bulkHeader = signals.listUnsubscribe === true || signals.bulk === true;
  if (level >= 1 && (bulkHeader || OBVIOUS_SALES.test(text))) return true;
  // "Cold" means we have no relationship with the sender. A known lead is never cold, at any level.
  if (level >= 2 && signals.knownContact !== true && COLD_OUTREACH.test(text)) return true;
  if (level >= 3 && NEWSLETTER.test(text)) return true;
  if (level >= 4 && signals.knownContact !== true && NOT_USEFUL.test(text)) return true;
  return false;
}

function normalizedEmail(value: string): string {
  const match = /<([^>]+)>/.exec(value);
  return (match ? match[1] : value).trim().toLowerCase();
}

function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1) : "";
}

/**
 * Deterministic rules win over the marketing heuristic, and the most specific rule wins: an exact
 * sender beats a domain, which beats an exact subject. A rule can only ever pick a pile.
 */
export function matchCategoryRule(
  settings: InboxSettings,
  eligible: InboxCategory[],
  signals: MailboxSignals = {},
): string {
  const slugs = new Set(eligible.map((category) => category.slug));
  const sender = normalizedEmail(signals.fromEmail || "");
  const domain = domainOf(sender);
  const subject = (signals.subject || "").trim().toLowerCase();
  const usable = settings.category_rules.filter((rule) => slugs.has(rule.category_slug));
  const bySender = usable.find((rule) => rule.sender && normalizedEmail(rule.sender) === sender && sender.length > 0);
  if (bySender) return bySender.category_slug;
  const byDomain = usable.find((rule) => rule.domain && rule.domain.trim().toLowerCase().replace(/^@/, "") === domain && domain.length > 0);
  if (byDomain) return byDomain.category_slug;
  const bySubject = usable.find((rule) => rule.exact_subject && rule.exact_subject.trim().toLowerCase() === subject && subject.length > 0);
  if (bySubject) return bySubject.category_slug;
  return "";
}

/**
 * Does the thread already carry organization that is not ours? Iris-managed names are excluded, so
 * its own previous run never counts as "the user organized this".
 */
export function hasForeignOrganization(existingLabels: string[], managedLabels: string[]): boolean {
  const managed = new Set(managedLabels.map((name) => name.toLowerCase()));
  // Gmail system labels are plumbing, not the user's filing. INBOX/UNREAD/SENT and the
  // CATEGORY_* smart-inbox buckets are on essentially every thread and would disable
  // categorization outright if they counted as user intent.
  return existingLabels.some((raw) => {
    const name = String(raw || "").trim();
    if (!name) return false;
    if (managed.has(name.toLowerCase())) return false;
    if (/^(INBOX|UNREAD|STARRED|SENT|DRAFT|SPAM|TRASH|IMPORTANT|CHAT)$/.test(name)) return false;
    if (/^CATEGORY_[A-Z]+$/.test(name)) return false;
    return true;
  });
}

export function planMailboxLabels(input: MailboxLabelPlanInput): MailboxLabelPlan {
  const { settings, sendConfirmed, stoppedForReview } = input;
  const signals = input.signals || {};
  const eligible = mailboxCategories(settings, input.categories || []);
  const managedLabels = [...new Set(eligible.map((category) => category.gmail_label_name).filter(Boolean))];
  const reasons: string[] = [];

  // System labels record what Iris DID. Both are conditioned on a fact, never on a classification.
  const addLabels: string[] = [];
  if (sendConfirmed) {
    addLabels.push(AUTO_REPLIED_LABEL);
    reasons.push("auto_replied: reply send confirmed");
  }
  if (stoppedForReview) {
    addLabels.push(NEEDS_HUMAN_LABEL);
    reasons.push("needs_human: stopped for human review");
  }

  let categorySlug = "";
  let removeFromInbox = false;

  if (!categorizationActive(settings)) {
    reasons.push(settings.categorization_enabled
      ? "categorization opted in but never started, so nothing was sorted"
      : "categorization off, existing organization untouched");
  } else if (settings.respect_existing_labels && hasForeignOrganization(signals.existingLabels || [], managedLabels)) {
    reasons.push("thread already organized by the user, left alone");
  } else {
    const optional = eligible.filter((category) => !MANAGED_SYSTEM_CATEGORIES.some((system) => system.slug === category.slug));
    const ruled = matchCategoryRule(settings, optional, signals);
    if (ruled) {
      categorySlug = ruled;
      reasons.push(`rule matched category ${ruled}`);
    } else if (matchesMarketingStrictness(settings.marketing_strictness, signals)) {
      const bulk = optional.find((category) => category.slug === "bulk_promotions");
      if (bulk) {
        categorySlug = bulk.slug;
        reasons.push(`bulk mail at strictness ${settings.marketing_strictness}`);
      }
    }
    const chosen = optional.find((category) => category.slug === categorySlug);
    if (chosen) {
      addLabels.push(chosen.gmail_label_name);
      if (!keepsInInbox(chosen)) {
        removeFromInbox = true;
        reasons.push(`${chosen.slug} is filed out of the inbox`);
      } else {
        reasons.push(`${chosen.slug} stays in the inbox`);
      }
    }
  }

  // Archive-after-send is a separate opt-in and only ever fires on a CONFIRMED send. It cannot
  // archive a thread Iris merely drafted for, and it cannot archive one it stopped on.
  if (settings.archive_after_send && sendConfirmed && !stoppedForReview) {
    removeFromInbox = true;
    reasons.push("archive_after_send: filed after a confirmed send");
  }
  // A thread waiting on a person must stay visible whatever else is configured.
  if (stoppedForReview && removeFromInbox) {
    removeFromInbox = false;
    reasons.push("kept in the inbox because a human still has to look at it");
  }

  return {
    addLabels: [...new Set(addLabels.filter(Boolean))],
    managedLabels,
    removeFromInbox,
    categorySlug,
    reasons,
  };
}

export type MailboxLabelPreviewItem = {
  id: string;
  subject: string;
  from: string;
  currentLabels: string[];
};

export type MailboxLabelPreviewRow = MailboxLabelPreviewItem & {
  addLabels: string[];
  removeLabels: string[];
  removeFromInbox: boolean;
  categorySlug: string;
  reasons: string[];
};

/**
 * Dry-run preview: what WOULD change, computed from stored thread metadata only. No provider call,
 * so it is safe to render on every settings keystroke and safe to run against a live mailbox.
 */
export function previewMailboxLabelPlans(
  items: MailboxLabelPreviewItem[],
  settings: InboxSettings,
  categories: InboxCategory[] = [],
): MailboxLabelPreviewRow[] {
  return items.map((item) => {
    const plan = planMailboxLabels({
      settings,
      categories,
      // A preview must not imply a send happened. It shows the ORGANIZATION effect only.
      sendConfirmed: false,
      stoppedForReview: false,
      signals: {
        fromEmail: item.from,
        subject: item.subject,
        existingLabels: item.currentLabels,
      },
    });
    const added = new Set(plan.addLabels);
    return {
      ...item,
      addLabels: plan.addLabels,
      removeLabels: plan.managedLabels.filter((name) => !added.has(name) && item.currentLabels.includes(name)),
      removeFromInbox: plan.removeFromInbox,
      categorySlug: plan.categorySlug,
      reasons: plan.reasons,
    };
  });
}
