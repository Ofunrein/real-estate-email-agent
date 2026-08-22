import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AUTO_REPLIED_LABEL,
  NEEDS_HUMAN_LABEL,
  hasForeignOrganization,
  matchCategoryRule,
  matchesMarketingStrictness,
  planMailboxLabels,
  previewMailboxLabelPlans,
} from "@/lib/inboxLabelPlan";
import {
  applyOnboardingPreset,
  categorizationActive,
  DEFAULT_INBOX_CATEGORIES,
  DEFAULT_INBOX_SETTINGS,
  INBOX_ONBOARDING_PRESETS,
  mailboxCategories,
  mergeInboxSettings,
  normalizeInboxCategory,
  normalizeInboxSettings,
  OPTIONAL_CATEGORY_PRESETS,
  type InboxCategory,
  type InboxSettings,
} from "@/lib/inboxSettings";

const STARTED_AT = "2026-08-21T09:00:00.000Z";

/** Settings with categorization genuinely live: opted in AND started. */
function activeSettings(overrides: Partial<InboxSettings> = {}): InboxSettings {
  return normalizeInboxSettings({
    ...DEFAULT_INBOX_SETTINGS,
    categorization_enabled: true,
    labelling_started_at: STARTED_AT,
    ...overrides,
  });
}

function preset(slug: string, overrides: Partial<InboxCategory> = {}): InboxCategory {
  const base = OPTIONAL_CATEGORY_PRESETS.find((category) => category.slug === slug);
  assert.ok(base, `unknown preset ${slug}`);
  return normalizeInboxCategory({ ...base, enabled: true, ...overrides }, base);
}

// ---------------------------------------------------------------------------
// Default posture: two labels, nothing else, nothing moved.
// ---------------------------------------------------------------------------

test("the shipped label names are exactly Needs Human and Auto Replied, with no prefix", () => {
  assert.equal(AUTO_REPLIED_LABEL, "Auto Replied");
  assert.equal(NEEDS_HUMAN_LABEL, "Needs Human");
  for (const name of [AUTO_REPLIED_LABEL, NEEDS_HUMAN_LABEL]) {
    assert.ok(!name.includes("/"), `${name} must not be namespaced`);
    assert.equal(name, name.trim());
  }
});

test("by default Iris manages only those two labels and touches nothing else", () => {
  const plan = planMailboxLabels({
    settings: DEFAULT_INBOX_SETTINGS,
    categories: DEFAULT_INBOX_CATEGORIES,
    sendConfirmed: false,
    stoppedForReview: false,
    signals: { existingLabels: ["INBOX", "Clients", "Referrals"] },
  });

  assert.deepEqual(plan.addLabels, []);
  assert.deepEqual(plan.managedLabels.slice().sort(), ["Auto Replied", "Needs Human"]);
  assert.equal(plan.removeFromInbox, false);
  assert.equal(plan.categorySlug, "");
});

test("internal workflow slugs are never eligible for a mailbox", () => {
  const eligible = mailboxCategories(activeSettings(), DEFAULT_INBOX_CATEGORIES);
  const slugs = eligible.map((category) => category.slug);

  assert.deepEqual(slugs, ["auto_replied", "needs_human"]);
  for (const internal of ["needs_reply", "waiting_lead", "nurture", "closed_no_reply", "hot_lead", "showing", "seller_valuation", "financing"]) {
    assert.ok(!slugs.includes(internal), `${internal} leaked into the mailbox set`);
  }
});

test("a user's own organization is never in the managed set, so it can never be removed", () => {
  const plan = planMailboxLabels({
    settings: activeSettings(),
    categories: [preset("bulk_promotions")],
    sendConfirmed: true,
    stoppedForReview: false,
    signals: { existingLabels: ["Clients/VIP"] },
  });

  assert.ok(!plan.managedLabels.includes("Clients/VIP"));
});

// ---------------------------------------------------------------------------
// A label is evidence, never a permission.
// ---------------------------------------------------------------------------

test("Auto Replied appears only after a confirmed send", () => {
  const base = { settings: DEFAULT_INBOX_SETTINGS, categories: DEFAULT_INBOX_CATEGORIES, stoppedForReview: false };

  assert.deepEqual(planMailboxLabels({ ...base, sendConfirmed: true }).addLabels, [AUTO_REPLIED_LABEL]);
  assert.deepEqual(planMailboxLabels({ ...base, sendConfirmed: false }).addLabels, []);
});

test("Needs Human appears only when Iris stopped for review", () => {
  const base = { settings: DEFAULT_INBOX_SETTINGS, categories: DEFAULT_INBOX_CATEGORIES, sendConfirmed: false };

  assert.deepEqual(planMailboxLabels({ ...base, stoppedForReview: true }).addLabels, [NEEDS_HUMAN_LABEL]);
  assert.deepEqual(planMailboxLabels({ ...base, stoppedForReview: false }).addLabels, []);
});

test("no category can hand itself a send permission through auto_rules", () => {
  const smuggled = normalizeInboxCategory({
    slug: "bulk_promotions",
    name: "Bulk Promotions",
    auto_rules: { tier: "topic", mailbox: true, auto_send: "on", keep_in_inbox: false },
  });

  assert.equal(smuggled.auto_rules.auto_send, "off");
  for (const category of [...DEFAULT_INBOX_CATEGORIES, ...OPTIONAL_CATEGORY_PRESETS]) {
    assert.equal(category.auto_rules.auto_send, "off", `${category.slug} must not authorize a send`);
  }
});

test("a caller cannot promote an internal-only category into the mailbox", () => {
  for (const slug of ["hot_lead", "needs_reply", "waiting_lead", "nurture", "closed_no_reply", "showing", "seller_valuation", "financing"]) {
    const smuggled = normalizeInboxCategory(
      { slug, gmail_label_name: "Sneaky", auto_rules: { tier: "topic", mailbox: true } },
      DEFAULT_INBOX_CATEGORIES.find((category) => category.slug === slug),
    );
    assert.equal(smuggled.auto_rules.mailbox, false, `${slug} was promoted into the mailbox`);
  }
  // Its label name is still filtered out of everything Iris may write.
  const promoted = DEFAULT_INBOX_CATEGORIES.map((category) => (
    normalizeInboxCategory({ ...category, auto_rules: { ...category.auto_rules, mailbox: true } }, category)
  ));
  assert.deepEqual(
    mailboxCategories(activeSettings(), promoted).map((category) => category.slug),
    ["auto_replied", "needs_human"],
  );
});

test("a pile the user invented is allowed to be a real label", () => {
  const mine = normalizeInboxCategory({
    slug: "Investor Deals",
    name: "Investor Deals",
    color: "#123456",
    enabled: true,
    auto_rules: { tier: "topic", mailbox: true, keep_in_inbox: true },
  });

  assert.equal(mine.slug, "investor_deals");
  assert.equal(mine.auto_rules.mailbox, true);
  assert.equal(mine.auto_rules.auto_send, "off");
  assert.deepEqual(
    mailboxCategories(activeSettings(), [mine]).map((category) => category.gmail_label_name),
    ["Auto Replied", "Needs Human", "Investor Deals"],
  );
});

// ---------------------------------------------------------------------------
// Opt-in is two independent facts.
// ---------------------------------------------------------------------------

test("categorization stays inert until the user both opts in and presses start", () => {
  assert.equal(categorizationActive(DEFAULT_INBOX_SETTINGS), false);
  assert.equal(categorizationActive(normalizeInboxSettings({ categorization_enabled: true })), false);
  assert.equal(categorizationActive(normalizeInboxSettings({ labelling_started_at: STARTED_AT })), false);
  assert.equal(categorizationActive(activeSettings()), true);
});

test("an opted-in but never started mailbox is left alone, and says so", () => {
  const plan = planMailboxLabels({
    settings: normalizeInboxSettings({ categorization_enabled: true, marketing_strictness: "obvious_sales" }),
    categories: [preset("bulk_promotions")],
    sendConfirmed: false,
    stoppedForReview: false,
    signals: { subject: "Limited time offer", listUnsubscribe: true },
  });

  assert.deepEqual(plan.addLabels, []);
  assert.equal(plan.removeFromInbox, false);
  assert.match(plan.reasons.join(" "), /never started/);
});

test("a garbage start timestamp reads as never started", () => {
  const settings = normalizeInboxSettings({ categorization_enabled: true, labelling_started_at: "yes please" });

  assert.equal(settings.labelling_started_at, "");
  assert.equal(categorizationActive(settings), false);
});

// ---------------------------------------------------------------------------
// Keep in inbox vs move out, archive after send.
// ---------------------------------------------------------------------------

test("a keep-in-inbox pile is labeled without being moved out", () => {
  const plan = planMailboxLabels({
    settings: activeSettings({ category_rules: [{ category_slug: "lead_waiting", domain: "buyer.com" }] }),
    categories: [preset("lead_waiting")],
    sendConfirmed: false,
    stoppedForReview: false,
    signals: { fromEmail: "Sam <sam@buyer.com>" },
  });

  assert.deepEqual(plan.addLabels, ["Lead Waiting"]);
  assert.equal(plan.removeFromInbox, false);
  assert.equal(plan.categorySlug, "lead_waiting");
});

test("a file-away pile is labeled and moved out of the inbox", () => {
  const plan = planMailboxLabels({
    settings: activeSettings({ category_rules: [{ category_slug: "transaction_admin", domain: "title.com" }] }),
    categories: [preset("transaction_admin")],
    sendConfirmed: false,
    stoppedForReview: false,
    signals: { fromEmail: "escrow@title.com" },
  });

  assert.deepEqual(plan.addLabels, ["Transaction Admin"]);
  assert.equal(plan.removeFromInbox, true);
});

test("archive-after-send only fires on a confirmed send", () => {
  const settings = normalizeInboxSettings({ ...DEFAULT_INBOX_SETTINGS, archive_after_send: true });

  assert.equal(planMailboxLabels({ settings, sendConfirmed: true, stoppedForReview: false }).removeFromInbox, true);
  assert.equal(planMailboxLabels({ settings, sendConfirmed: false, stoppedForReview: false }).removeFromInbox, false);
});

test("a thread waiting on a person is never archived, whatever else is configured", () => {
  const plan = planMailboxLabels({
    settings: activeSettings({
      archive_after_send: true,
      category_rules: [{ category_slug: "bulk_promotions", domain: "news.com" }],
    }),
    categories: [preset("bulk_promotions")],
    sendConfirmed: true,
    stoppedForReview: true,
    signals: { fromEmail: "digest@news.com" },
  });

  assert.equal(plan.removeFromInbox, false);
  assert.ok(plan.addLabels.includes(NEEDS_HUMAN_LABEL));
  assert.match(plan.reasons.join(" "), /human still has to look at it/);
});

// ---------------------------------------------------------------------------
// Already-labeled handling.
// ---------------------------------------------------------------------------

test("respect_existing_labels leaves a thread the user already filed alone", () => {
  const plan = planMailboxLabels({
    settings: activeSettings({ category_rules: [{ category_slug: "bulk_promotions", domain: "news.com" }] }),
    categories: [preset("bulk_promotions")],
    sendConfirmed: false,
    stoppedForReview: false,
    signals: { fromEmail: "digest@news.com", existingLabels: ["INBOX", "Newsletters I Like"] },
  });

  assert.deepEqual(plan.addLabels, []);
  assert.equal(plan.removeFromInbox, false);
  assert.match(plan.reasons.join(" "), /already organized by the user/);
});

test("turning respect_existing_labels off lets Iris sort an already-filed thread", () => {
  const plan = planMailboxLabels({
    settings: activeSettings({
      respect_existing_labels: false,
      category_rules: [{ category_slug: "bulk_promotions", domain: "news.com" }],
    }),
    categories: [preset("bulk_promotions")],
    sendConfirmed: false,
    stoppedForReview: false,
    signals: { fromEmail: "digest@news.com", existingLabels: ["Newsletters I Like"] },
  });

  assert.deepEqual(plan.addLabels, ["Bulk Promotions"]);
});

test("provider plumbing labels do not count as the user having organized a thread", () => {
  assert.equal(hasForeignOrganization(["INBOX", "UNREAD", "CATEGORY_PROMOTIONS", "IMPORTANT"], ["Auto Replied"]), false);
  assert.equal(hasForeignOrganization(["INBOX", "Auto Replied"], ["Auto Replied", "Needs Human"]), false);
  assert.equal(hasForeignOrganization(["INBOX", "Clients"], ["Auto Replied", "Needs Human"]), true);
  assert.equal(hasForeignOrganization([" ", ""], []), false);
});

// ---------------------------------------------------------------------------
// Marketing strictness.
// ---------------------------------------------------------------------------

test("marketing strictness off never matches anything", () => {
  assert.equal(matchesMarketingStrictness("off", { subject: "Limited time offer", listUnsubscribe: true }), false);
});

test("each marketing strictness level is a superset of the one below it", () => {
  const newsletter = { subject: "Our monthly newsletter", body: "view in browser" };
  const cold = { subject: "Quick question", body: "circling back about a partnership" };
  const chore = { subject: "Feedback request", body: "take our survey" };

  assert.equal(matchesMarketingStrictness("obvious_sales", { subject: "50% off, act now" }), true);
  assert.equal(matchesMarketingStrictness("obvious_sales", cold), false);
  assert.equal(matchesMarketingStrictness("cold_and_unknown", cold), true);
  assert.equal(matchesMarketingStrictness("cold_and_unknown", newsletter), false);
  assert.equal(matchesMarketingStrictness("cold_unknown_newsletters", newsletter), true);
  assert.equal(matchesMarketingStrictness("cold_unknown_newsletters", chore), false);
  assert.equal(matchesMarketingStrictness("not_useful_to_work", chore), true);
});

test("a known lead is never cold mail at any strictness", () => {
  const signals = { subject: "Quick question", body: "just following up", knownContact: true };

  for (const level of ["cold_and_unknown", "cold_unknown_newsletters", "not_useful_to_work"] as const) {
    assert.equal(matchesMarketingStrictness(level, signals), false, `${level} filed a known lead as marketing`);
  }
});

test("bulk mail is filed into Bulk Promotions once that pile is switched on", () => {
  const plan = planMailboxLabels({
    settings: activeSettings({ marketing_strictness: "obvious_sales" }),
    categories: [preset("bulk_promotions")],
    sendConfirmed: false,
    stoppedForReview: false,
    signals: { fromEmail: "blast@vendor.com", subject: "Book a demo", listUnsubscribe: true },
  });

  assert.deepEqual(plan.addLabels, ["Bulk Promotions"]);
  assert.equal(plan.removeFromInbox, true);
});

test("bulk mail is left where it is when the user did not enable that pile", () => {
  const plan = planMailboxLabels({
    settings: activeSettings({ marketing_strictness: "not_useful_to_work" }),
    categories: [preset("bulk_promotions", { enabled: false })],
    sendConfirmed: false,
    stoppedForReview: false,
    signals: { subject: "Book a demo", listUnsubscribe: true },
  });

  assert.deepEqual(plan.addLabels, []);
  assert.equal(plan.removeFromInbox, false);
});

// ---------------------------------------------------------------------------
// Deterministic rules.
// ---------------------------------------------------------------------------

test("an exact sender rule beats a domain rule, which beats a subject rule", () => {
  const eligible = [preset("lead_waiting"), preset("transaction_admin"), preset("listing_alerts")];
  const settings = activeSettings({
    category_rules: [
      { category_slug: "listing_alerts", exact_subject: "New listings" },
      { category_slug: "transaction_admin", domain: "title.com" },
      { category_slug: "lead_waiting", sender: "escrow@title.com" },
    ],
  });
  const signals = { fromEmail: "Escrow <escrow@title.com>", subject: "New listings" };

  assert.equal(matchCategoryRule(settings, eligible, signals), "lead_waiting");
  assert.equal(matchCategoryRule(settings, eligible, { ...signals, fromEmail: "other@title.com" }), "transaction_admin");
  assert.equal(matchCategoryRule(settings, eligible, { subject: "New listings" }), "listing_alerts");
});

test("a rule pointing at a pile the user has not enabled does nothing", () => {
  const settings = activeSettings({ category_rules: [{ category_slug: "transaction_admin", domain: "title.com" }] });

  assert.equal(matchCategoryRule(settings, [preset("lead_waiting")], { fromEmail: "a@title.com" }), "");
});

test("a rule wins over the marketing heuristic", () => {
  const plan = planMailboxLabels({
    settings: activeSettings({
      marketing_strictness: "cold_unknown_newsletters",
      category_rules: [{ category_slug: "listing_alerts", domain: "portal.com" }],
    }),
    categories: [preset("listing_alerts"), preset("bulk_promotions")],
    sendConfirmed: false,
    stoppedForReview: false,
    signals: { fromEmail: "alerts@portal.com", subject: "Your weekly digest" },
  });

  assert.deepEqual(plan.addLabels, ["Listing Alerts"]);
  assert.equal(plan.categorySlug, "listing_alerts");
});

test("rules cannot target the two managed system labels", () => {
  const plan = planMailboxLabels({
    settings: activeSettings({ category_rules: [{ category_slug: "auto_replied", domain: "buyer.com" }] }),
    categories: [preset("lead_waiting")],
    sendConfirmed: false,
    stoppedForReview: false,
    signals: { fromEmail: "sam@buyer.com" },
  });

  assert.deepEqual(plan.addLabels, []);
});

test("unparseable settings degrade to the untouched-inbox defaults", () => {
  const settings = normalizeInboxSettings({
    marketing_strictness: "delete everything" as never,
    onboarding_choice: "yolo" as never,
    category_rules: [{ category_slug: "" }, { category_slug: "lead_waiting" }],
  });

  assert.equal(settings.marketing_strictness, "off");
  assert.equal(settings.onboarding_choice, "");
  assert.equal(settings.category_rules.length, 1);
});

// ---------------------------------------------------------------------------
// Partial saves.
// ---------------------------------------------------------------------------

test("saving one settings card cannot switch another card's choices back off", () => {
  const stored = activeSettings({ marketing_strictness: "obvious_sales", onboarding_choice: "custom", archive_after_send: true });

  // What the reply-automation card sends: its own three keys and nothing else.
  const merged = mergeInboxSettings(stored, { draft_first: false, auto_send: { ...stored.auto_send, email: true }, channels_enabled: stored.channels_enabled });

  assert.equal(merged.draft_first, false);
  assert.equal(merged.auto_send.email, true);
  assert.equal(categorizationActive(merged), true);
  assert.equal(merged.marketing_strictness, "obvious_sales");
  assert.equal(merged.onboarding_choice, "custom");
  assert.equal(merged.archive_after_send, true);
  assert.equal(merged.labelling_started_at, STARTED_AT);
});

test("an explicit false in a patch still turns a setting off", () => {
  const stored = activeSettings();

  assert.equal(mergeInboxSettings(stored, { categorization_enabled: false }).categorization_enabled, false);
  assert.equal(mergeInboxSettings(stored, { labelling_started_at: "" }).labelling_started_at, "");
  assert.equal(categorizationActive(mergeInboxSettings(stored, { labelling_started_at: "" })), false);
});

test("an undefined key in a patch is not a value and leaves stored state alone", () => {
  const stored = activeSettings({ archive_after_send: true });

  assert.equal(mergeInboxSettings(stored, { archive_after_send: undefined }).archive_after_send, true);
  assert.equal(mergeInboxSettings(stored, {}).archive_after_send, true);
});

// ---------------------------------------------------------------------------
// Onboarding.
// ---------------------------------------------------------------------------

test("the three onboarding choices are offered, with leave-unchanged recommended", () => {
  assert.deepEqual(
    INBOX_ONBOARDING_PRESETS.map((entry) => entry.choice),
    ["leave_unchanged", "attention_only", "custom"],
  );
  assert.deepEqual(
    INBOX_ONBOARDING_PRESETS.filter((entry) => entry.recommended).map((entry) => entry.choice),
    ["leave_unchanged"],
  );
});

test("picking a shape records the choice but never starts anything", () => {
  for (const entry of INBOX_ONBOARDING_PRESETS) {
    const applied = applyOnboardingPreset(entry.choice, DEFAULT_INBOX_SETTINGS);

    assert.equal(applied.settings.onboarding_choice, entry.choice);
    assert.equal(applied.settings.labelling_started_at, "");
    assert.equal(categorizationActive(applied.settings), false, `${entry.choice} started without a start action`);
  }
});

test("the recommended choice enables no piles at all", () => {
  const applied = applyOnboardingPreset("leave_unchanged", DEFAULT_INBOX_SETTINGS);

  assert.equal(applied.settings.categorization_enabled, false);
  assert.deepEqual(applied.categories.filter((category) => category.enabled), []);
});

test("attention-only enables two piles and keeps both in the inbox", () => {
  const applied = applyOnboardingPreset("attention_only", DEFAULT_INBOX_SETTINGS);
  const enabled = applied.categories.filter((category) => category.enabled);

  assert.deepEqual(enabled.map((category) => category.slug), ["lead_waiting", "no_action"]);
  assert.equal(applied.settings.marketing_strictness, "off");
  const started = { ...applied.settings, labelling_started_at: STARTED_AT };
  for (const category of mailboxCategories(started, applied.categories)) {
    const plan = planMailboxLabels({
      settings: { ...started, category_rules: [{ category_slug: category.slug, domain: "x.com" }] },
      categories: applied.categories,
      sendConfirmed: false,
      stoppedForReview: false,
      signals: { fromEmail: "a@x.com" },
    });
    assert.equal(plan.removeFromInbox, false, `${category.slug} moved mail out under attention-only`);
  }
});

test("the customized choice enables every pile and can be re-picked without losing edits", () => {
  const edited = [preset("lead_waiting", { name: "My Hot Ones", color: "#123456", sort_order: 5 })];
  const applied = applyOnboardingPreset("custom", DEFAULT_INBOX_SETTINGS, edited);
  const kept = applied.categories.find((category) => category.slug === "lead_waiting");

  assert.equal(applied.categories.filter((category) => category.enabled).length, OPTIONAL_CATEGORY_PRESETS.length);
  assert.equal(kept?.name, "My Hot Ones");
  assert.equal(kept?.color, "#123456");
  assert.equal(kept?.sort_order, 5);
});

test("a renamed pile is written under its new name and stays managed", () => {
  const renamed = preset("bulk_promotions", { name: "Junk", gmail_label_name: "Junk" });
  const plan = planMailboxLabels({
    settings: activeSettings({ marketing_strictness: "obvious_sales" }),
    categories: [renamed],
    sendConfirmed: false,
    stoppedForReview: false,
    signals: { subject: "Act now", listUnsubscribe: true },
  });

  assert.deepEqual(plan.addLabels, ["Junk"]);
  assert.ok(plan.managedLabels.includes("Junk"));
});

test("display order follows sort_order, with the system labels first", () => {
  const categories = [preset("bulk_promotions", { sort_order: 300 }), preset("lead_waiting", { sort_order: 200 })];

  assert.deepEqual(
    mailboxCategories(activeSettings(), categories).map((category) => category.slug),
    ["auto_replied", "needs_human", "lead_waiting", "bulk_promotions"],
  );
});

// ---------------------------------------------------------------------------
// Dry-run preview.
// ---------------------------------------------------------------------------

test("the dry-run preview reports what would change without implying a send", () => {
  const rows = previewMailboxLabelPlans(
    [
      { id: "1", subject: "Act now", from: "blast@vendor.com", currentLabels: ["INBOX"] },
      { id: "2", subject: "Tour request", from: "sam@buyer.com", currentLabels: ["INBOX", "Clients"] },
    ],
    activeSettings({ marketing_strictness: "obvious_sales" }),
    [preset("bulk_promotions")],
  );

  assert.deepEqual(rows[0].addLabels, ["Bulk Promotions"]);
  assert.equal(rows[0].removeFromInbox, true);
  assert.ok(!rows[0].addLabels.includes(AUTO_REPLIED_LABEL));
  // The second thread is already organized by the user, so the preview shows it untouched.
  assert.deepEqual(rows[1].addLabels, []);
  assert.equal(rows[1].removeFromInbox, false);
  assert.ok(rows.every((row) => row.reasons.length > 0));
});

test("the preview only ever proposes removing labels Iris owns", () => {
  const rows = previewMailboxLabelPlans(
    [{ id: "1", subject: "Hello", from: "sam@buyer.com", currentLabels: ["Auto Replied", "Needs Human", "Clients"] }],
    activeSettings({ respect_existing_labels: false }),
    [preset("lead_waiting")],
  );

  assert.deepEqual(rows[0].removeLabels.slice().sort(), ["Auto Replied", "Needs Human"]);
  assert.ok(!rows[0].removeLabels.includes("Clients"));
});

test("the preview is inert while categorization is off", () => {
  const rows = previewMailboxLabelPlans(
    [{ id: "1", subject: "Act now", from: "blast@vendor.com", currentLabels: ["INBOX"] }],
    DEFAULT_INBOX_SETTINGS,
    OPTIONAL_CATEGORY_PRESETS,
  );

  assert.deepEqual(rows[0].addLabels, []);
  assert.deepEqual(rows[0].removeLabels, []);
  assert.equal(rows[0].removeFromInbox, false);
});
