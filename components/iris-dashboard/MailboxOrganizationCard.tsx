"use client";

import React from "react";

import { previewMailboxLabelPlans, type MailboxLabelPreviewRow } from "@/lib/inboxLabelPlan";
import {
  applyOnboardingPreset,
  categorizationActive,
  DEFAULT_INBOX_SETTINGS,
  INBOX_ONBOARDING_PRESETS,
  keepsInInbox,
  normalizeInboxCategory,
  OPTIONAL_CATEGORY_PRESETS,
  type InboxCategory,
  type InboxOnboardingChoice,
  type InboxSettings,
} from "@/lib/inboxSettings";

/**
 * The whole opt-in surface for mailbox organization, in one card.
 *
 * Two facts, deliberately separate controls: choosing a shape saves a preference, and only the
 * explicit start button lets Iris touch anyone's mail. Everything here is organization — none of
 * these controls can authorize a send, which stays with the reply-automation card above.
 */

const STRICTNESS_OPTIONS: Array<[InboxSettings["marketing_strictness"], string]> = [
  ["off", "Off — never file mail as marketing"],
  ["obvious_sales", "Obvious sales blasts and unsubscribe mail"],
  ["cold_and_unknown", "…plus cold outreach from people you do not know"],
  ["cold_unknown_newsletters", "…plus newsletters and digests"],
  ["not_useful_to_work", "…plus surveys, product updates and event invites"],
];

type RuleField = "sender" | "domain" | "exact_subject";

const RULE_FIELDS: Array<[RuleField, string]> = [
  ["sender", "Exact sender"],
  ["domain", "Domain"],
  ["exact_subject", "Exact subject"],
];

export type MailboxOrganizationThread = {
  id: string;
  from: string;
  subject: string;
};

function Toggle({ label, help, checked, onChange }: { label: string; help: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className={`iris-toggle ${checked ? "is-on" : ""}`}>
      <span><b>{label}</b><em>{help}</em></span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <i aria-hidden="true" />
    </label>
  );
}

export function MailboxOrganizationCard({ threads }: { threads: MailboxOrganizationThread[] }) {
  const [settings, setSettings] = React.useState<InboxSettings>(DEFAULT_INBOX_SETTINGS);
  const [categories, setCategories] = React.useState<InboxCategory[]>(OPTIONAL_CATEGORY_PRESETS);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [showPreview, setShowPreview] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/settings/inbox", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (data.settings) setSettings(data.settings as InboxSettings);
      // Only the opt-in piles are editable here. Internal workflow rows are not a user taxonomy.
      const saved = Array.isArray(data.categories) ? data.categories as InboxCategory[] : [];
      const bySlug = new Map(saved.map((category) => [category.slug, category] as const));
      setCategories(OPTIONAL_CATEGORY_PRESETS.map((preset) => (
        normalizeInboxCategory(bySlug.get(preset.slug) || preset, preset)
      )));
    } catch {
      setMessage("Could not load mailbox organization settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  const active = categorizationActive(settings);
  const chosen = settings.onboarding_choice;

  const pickShape = (choice: Exclude<InboxOnboardingChoice, "">) => {
    const applied = applyOnboardingPreset(choice, settings, categories);
    setSettings(applied.settings);
    setCategories(applied.categories);
    setMessage("");
  };

  // Merged raw, normalized only on save — normalizing per keystroke snaps a half-cleared name
  // field back to its old value and makes renaming impossible.
  const patchCategory = (slug: string, patch: Partial<InboxCategory>) => {
    setCategories((current) => current.map((category) => (
      category.slug === slug ? { ...category, ...patch } : category
    )));
  };

  const setKeepInInbox = (slug: string, keep: boolean) => {
    const category = categories.find((entry) => entry.slug === slug);
    if (!category) return;
    patchCategory(slug, { auto_rules: { ...category.auto_rules, keep_in_inbox: keep } });
  };

  const setRules = (rules: InboxSettings["category_rules"]) => setSettings((current) => ({ ...current, category_rules: rules }));

  const save = async (overrides: Partial<InboxSettings> = {}) => {
    setSaving(true);
    setMessage("");
    // Send only the keys this card owns. The other settings cards do the same, and the server
    // merges each patch over stored state, so two cards cannot undo each other.
    const next: Partial<InboxSettings> = {
      categorization_enabled: settings.categorization_enabled,
      respect_existing_labels: settings.respect_existing_labels,
      archive_after_send: settings.archive_after_send,
      marketing_strictness: settings.marketing_strictness,
      category_rules: settings.category_rules,
      onboarding_choice: settings.onboarding_choice,
      labelling_started_at: settings.labelling_started_at,
      ...overrides,
    };
    try {
      const res = await fetch("/api/settings/inbox", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: next,
          categories: categories.map((category) => normalizeInboxCategory(category, category)),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || `Save failed (${res.status})`);
      if (data.settings) setSettings(data.settings as InboxSettings);
      setMessage(data.gmail_label_sync_error
        ? `Saved, but the mailbox labels did not sync: ${data.gmail_label_sync_error}`
        : "Saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Mailbox organization did not save.");
    } finally {
      setSaving(false);
    }
  };

  // Pure, so it recomputes on every edit with no request and no mailbox call.
  const preview: MailboxLabelPreviewRow[] = React.useMemo(() => (
    previewMailboxLabelPlans(
      threads.slice(0, 25).map((thread) => ({
        id: thread.id,
        subject: thread.subject,
        from: thread.from,
        // Stored thread metadata carries no provider labels, so the preview cannot judge whether a
        // thread is already organized. The live run can, and skips those when the setting is on.
        currentLabels: [],
      })),
      // Preview what the START button would do, not what today's saved state does.
      { ...settings, labelling_started_at: settings.labelling_started_at || new Date().toISOString() },
      categories,
    )
  ), [threads, settings, categories]);
  const previewChanges = preview.filter((row) => row.addLabels.length > 0 || row.removeFromInbox);

  const enabledPiles = categories.filter((category) => category.enabled);

  return (
    <section className="iris-settings-card iris-settings-card-wide">
      <strong>Mailbox organization</strong>
      <span>
        Iris always labels what it replied to (<b>Auto Replied</b>) and what it stopped on (<b>Needs Human</b>).
        Everything below is optional, off until you switch it on, and never touches labels you made yourself.
      </span>

      <div className="iris-workflow-head"><b>Choose a shape</b><em>Saving a choice changes nothing on its own.</em></div>
      <div className="iris-reply-mode-grid iris-onboarding-grid" aria-label="Mailbox organization shape">
        {INBOX_ONBOARDING_PRESETS.map((preset) => (
          <button
            key={preset.choice}
            type="button"
            aria-pressed={chosen === preset.choice}
            className={chosen === preset.choice ? "is-selected" : ""}
            onClick={() => pickShape(preset.choice)}
          >
            <b>{preset.title}{preset.recommended ? " · recommended" : ""}</b>
            <em>{preset.detail}</em>
          </button>
        ))}
      </div>

      {settings.categorization_enabled && (
        <>
          <div className="iris-workflow-head"><b>Piles</b><em>Rename, recolor, reorder, and choose what stays in the inbox.</em></div>
          <div className="iris-workflow-list">
            {categories.map((category) => (
              <div key={category.slug} className="iris-workflow-row iris-pile-row">
                <input
                  type="color"
                  aria-label={`${category.name} color`}
                  value={category.color}
                  onChange={(event) => patchCategory(category.slug, { color: event.target.value })}
                />
                <span>
                  <input
                    type="text"
                    aria-label={`${category.name} label name`}
                    value={category.name}
                    onChange={(event) => patchCategory(category.slug, { name: event.target.value, gmail_label_name: event.target.value })}
                  />
                  <em>{category.description}</em>
                </span>
                <input
                  type="number"
                  aria-label={`${category.name} order`}
                  value={category.sort_order}
                  step={10}
                  onChange={(event) => patchCategory(category.slug, { sort_order: Number(event.target.value) })}
                />
                <select
                  aria-label={`${category.name} placement`}
                  value={keepsInInbox(category) ? "keep" : "move"}
                  onChange={(event) => setKeepInInbox(category.slug, event.target.value === "keep")}
                >
                  <option value="keep">Keep in inbox</option>
                  <option value="move">Move out of inbox</option>
                </select>
                <input
                  type="checkbox"
                  aria-label={`${category.name} enabled`}
                  checked={category.enabled}
                  onChange={(event) => patchCategory(category.slug, { enabled: event.target.checked })}
                />
              </div>
            ))}
          </div>

          <label className="iris-field">
            <b>Bulk and marketing mail</b>
            <select
              value={settings.marketing_strictness}
              onChange={(event) => setSettings((current) => ({ ...current, marketing_strictness: event.target.value as InboxSettings["marketing_strictness"] }))}
            >
              {STRICTNESS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>

          <div className="iris-toggle-grid">
            <Toggle
              label="Respect my existing labels"
              help="Skip threads already filed by you or your own filters"
              checked={settings.respect_existing_labels}
              onChange={(value) => setSettings((current) => ({ ...current, respect_existing_labels: value }))}
            />
            <Toggle
              label="Archive after a reply is sent"
              help="Only after a confirmed send. Never on threads waiting for you"
              checked={settings.archive_after_send}
              onChange={(value) => setSettings((current) => ({ ...current, archive_after_send: value }))}
            />
          </div>

          <div className="iris-workflow-head"><b>Rules</b><em>A rule always wins over the marketing guess. Exact sender beats domain beats subject.</em></div>
          <div className="iris-workflow-list">
            {settings.category_rules.map((rule, index) => (
              <div key={`${rule.category_slug}-${index}`} className="iris-workflow-row iris-rule-row">
                <select
                  aria-label={`Rule ${index + 1} match type`}
                  value={RULE_FIELDS.find(([field]) => rule[field])?.[0] || "sender"}
                  onChange={(event) => {
                    const field = event.target.value as RuleField;
                    const value = rule.sender || rule.domain || rule.exact_subject || "";
                    setRules(settings.category_rules.map((entry, position) => (
                      position === index ? { category_slug: entry.category_slug, [field]: value } : entry
                    )));
                  }}
                >
                  {RULE_FIELDS.map(([field, label]) => <option key={field} value={field}>{label}</option>)}
                </select>
                <input
                  type="text"
                  aria-label={`Rule ${index + 1} value`}
                  value={rule.sender || rule.domain || rule.exact_subject || ""}
                  onChange={(event) => {
                    const field = RULE_FIELDS.find(([name]) => rule[name])?.[0] || "sender";
                    setRules(settings.category_rules.map((entry, position) => (
                      position === index ? { category_slug: entry.category_slug, [field]: event.target.value } : entry
                    )));
                  }}
                />
                <select
                  aria-label={`Rule ${index + 1} pile`}
                  value={rule.category_slug}
                  onChange={(event) => setRules(settings.category_rules.map((entry, position) => (
                    position === index ? { ...entry, category_slug: event.target.value } : entry
                  )))}
                >
                  {enabledPiles.map((category) => <option key={category.slug} value={category.slug}>{category.name}</option>)}
                </select>
                <button type="button" onClick={() => setRules(settings.category_rules.filter((_, position) => position !== index))}>
                  Remove
                </button>
              </div>
            ))}
          </div>
          <div className="iris-settings-actions">
            <button
              type="button"
              disabled={!enabledPiles.length}
              onClick={() => setRules([...settings.category_rules, { category_slug: enabledPiles[0].slug, sender: "" }])}
            >
              Add rule
            </button>
            <button type="button" onClick={() => setShowPreview((current) => !current)}>
              {showPreview ? "Hide preview" : `Preview on ${Math.min(threads.length, 25)} recent threads`}
            </button>
          </div>

          {showPreview && (
            <div className="iris-workflow-list" aria-live="polite">
              <em className="iris-preview-note">
                Dry run. Nothing below has been applied. Judged on sender and subject only, so the
                &ldquo;respect my existing labels&rdquo; skip is not reflected here.
              </em>
              {previewChanges.map((row) => (
                <div key={row.id} className="iris-workflow-row iris-preview-row">
                  <span>
                    <b>{row.subject || "(no subject)"}</b>
                    <em>{row.from}</em>
                  </span>
                  <span>
                    <b>{row.addLabels.join(", ") || "no label"}</b>
                    <em>{row.removeFromInbox ? "moved out of the inbox" : "stays in the inbox"}</em>
                  </span>
                </div>
              ))}
              {!previewChanges.length && <div className="iris-empty">Nothing would be re-filed.</div>}
            </div>
          )}
        </>
      )}

      <div className="iris-settings-actions">
        <button type="button" onClick={() => void save()} disabled={saving || loading}>
          {saving ? "Saving…" : "Save"}
        </button>
        {settings.categorization_enabled && (
          <button
            type="button"
            disabled={saving || loading}
            onClick={() => void save({ labelling_started_at: active ? "" : new Date().toISOString() })}
          >
            {active ? "Stop organizing" : "Start organizing my mail"}
          </button>
        )}
        <em>
          {loading
            ? "Loading…"
            : active
              ? "Organizing is on. New mail is sorted as it arrives."
              : settings.categorization_enabled
                ? "Chosen but not started. Nothing is being sorted yet."
                : "Your inbox organization is untouched."}
        </em>
        {message && <em>{message}</em>}
      </div>
    </section>
  );
}
