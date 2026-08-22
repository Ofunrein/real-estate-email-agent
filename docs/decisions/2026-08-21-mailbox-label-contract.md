# Decision: Iris writes two mailbox labels by default, and organizing is opt-in

**Date:** 2026-08-21
**Owner:** Martin Ofunrein
**Status:** Adopted

## Decision
Iris manages exactly two user-facing mailbox labels out of the box: `Auto Replied` and
`Needs Human`. Plain title case, no `Iris/` prefix, no third label. Every other form of mailbox
organization is opt-in, off by default, and inert until the user explicitly starts it.

`lib/inboxLabelPlan.ts` is the single place that decides what reaches a mailbox. It is pure and
provider-neutral — it returns label NAMES plus `removeFromInbox`, so the Gmail path and a future
Outlook path apply the same plan through their own APIs, and the same plan renders as a dry-run
preview without touching an account.

## Why
Three separate failures pushed this:

1. **Internal state was leaking into people's mailboxes.** `needs_reply`, `waiting_lead`,
   `hot_lead`, `closed_no_reply` and friends are workflow state that `inferCategorySlug` and the
   review-resolution logic derive thread status from. They were also being written as Gmail labels,
   so an agent's private bookkeeping showed up as a taxonomy in a realtor's inbox.
2. **Raw machine tokens were reaching the mailbox.** `AUTO_REPLIED` and `NEEDS_HUMAN` — the literal
   internal enum strings — were passed to `applyLabels`.
3. **Nobody asked.** A mail assistant that re-files an inbox it was not invited to re-file is worse
   than one that does nothing. The user's own labels and filters are their work, not ours.

## The contract

- **A label is evidence, never a permission.** Nothing in the label plan returns "may send".
  `Auto Replied` requires a confirmed, authorized, already-delivered send. `Needs Human` requires
  that Iris stopped for review. Sending stays gated solely by `decideIrisEmailExecution`'s Tier A
  allowlist.
- **Two independent facts before any reorganization.** `categorization_enabled` AND a
  `labelling_started_at` timestamp. `categorizationActive()` is the only check, so a half-saved row,
  a restored backup, or a stray `true` cannot start filing someone's mail.
- **`auto_rules.mailbox` is the decoupling primitive.** A category can reach a mailbox only when
  that flag is true. `normalizeInboxCategory` re-derives it and refuses to set it for the
  internal-only slugs, so an API caller cannot promote workflow state into a label.
- **Only what Iris owns may be removed.** `managedLabels` never contains a label the user made.
  `INBOX` joins the managed set only when the plan actually asked to file the thread.
- **A duplicate does not mint a label.** "Already handled" is not evidence a reply went out on this
  pass, so it preserves an existing `Auto Replied` rather than asserting a new one.
- **A thread waiting on a person is never archived**, whatever else is configured.

## Onboarding
One exclusive choice, then one explicit start:

| Choice | Effect |
| --- | --- |
| Leave my inbox organization alone (recommended) | Nothing enabled. The two system labels still apply. |
| Only flag what needs a person | Two piles, both kept in the inbox. Nothing moved out. |
| Sort my mail into desk piles | All piles enabled, editable, keep-vs-file per pile. |

Picking a shape is a preference, not consent. `applyOnboardingPreset` always clears
`labelling_started_at`.

## Actions
- [x] `lib/inboxLabelPlan.ts` — the plan, the marketing bar, rule precedence, the dry-run preview.
- [x] `lib/inboxSettings.ts` — opt-in settings, onboarding presets, `mailbox`/`auto_send` hardening,
      `mergeInboxSettings` so a partial save cannot switch another card's choices off.
- [x] `db/migrations/028_inbox_categorization_optin.sql` — all new columns default to untouched.
- [x] Reads probe `tableColumns()` so an unmigrated database degrades to "do not touch the inbox".
- [x] Every mailbox write is audited with its reasons (`stage: "mailbox_label"`).
- [x] Removed the `Iris/` fallback from the label sync and from both settings UIs.
- [x] `tests/ts/inboxLabelPlan.test.ts` — 42 tests covering the contract above.

## Rollback
Set `categorization_enabled = false` for the tenant, or clear `labelling_started_at`. Either alone
makes categorization inert on the next poll; the two system labels are unaffected. Migration 028 is
additive and safe to leave in place.
