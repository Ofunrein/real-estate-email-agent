# Iris Email Stress Workflow

Goal: keep Gmail replies under 60 seconds without Vercel polling or long-running webhook work.

## Runtime Shape

- Gmail Pub/Sub calls `GET/POST /api/webhooks/iris-gmail-push` on `app.lumenosis.com`.
- The webhook only validates and emits `gmail.push.received` to Inngest.
- Inngest function `gmail-push-received` does the Gmail read/classify/label/send work.
- Vercel cron remains disabled. `vercel.json` should keep `"crons": []`.
- Do not add a GitHub Actions schedule that POSTs `/api/cron/iris-email`. That wakes the app every few minutes even when `ENABLE_LEGACY_IRIS_EMAIL_POLLING` is off. Inbound mail is Gmail Pub/Sub only.
- Gmail watches expire by design; `gmail-watch-renewal` renews connected default Gmail accounts.

## Resource Rules

- Keep Vercel webhook work to auth, payload decode, and Inngest enqueue.
- Prefer Gmail History API targeting over unread inbox scans.
- Process only unread INBOX messages from changed Gmail message IDs.
- Fall back to unread scan only when Gmail history is stale or missing.
- Keep Inngest steps small: resolve history target, process messages, advance history marker.
- Run `npm run inngest:sync` after deploying function changes, then `npm run inngest:functions`.

## Stress Test Loop

1. Add or update scenarios in `tests/fixtures/iris-email-stress-scenarios.json`.
2. Run `npm run stress:email`.
3. Failures should become either classifier/rendering fixes or explicit product decisions.
4. Run `npm run proof` to refresh the recorded output at `docs/proof/iris-email-scenarios.md` and commit it. CI fails if that file drifts from current behavior.
5. Run targeted tests, full build, deploy, and `npm run inngest:sync`.
6. Send one live Gmail test and confirm:
   - Vercel log shows `iris_gmail_push_queued`.
   - Inngest shows a `gmail-push-received` run.
   - DB has one inbound and one outbound row.
   - Gmail thread receives the reply in under 60 seconds.

## Cross-Channel Adversarial Suite

`npm run adversarial` scores every channel against the same fixtures that
`tests/ts/adversarialSuite.test.ts` asserts case by case, so `npm test` fails on drift.
`npm run adversarial:proof` refreshes `docs/proof/adversarial-regression.md`.

- Iris email: `tests/fixtures/iris-email-stress-scenarios.json`
- Instagram/Messenger: `tests/fixtures/adversarial-social-scenarios.json`
- Theo SMS: `tests/fixtures/adversarial-theo-scenarios.json`
- Aria voice: structural cases in `tests/ts/adversarialSuite.test.ts` (stubbed deps, no Vapi
  call, no phone call, no DB write). Live `vapi chat` is deliberately not wired in: it would
  invoke the assistant's real tool webhooks against the production database.

`scripts/imessage-e2e-selftest.mjs` runs a bounded live round trip over iMessage. It refuses
to send unless the target chat is provably a self chat (one participant, plus an existing
from-me message from that same handle), caps total sends, and is dry-run unless `--live`.

## Two Rules That Are Easy To Break

- **Human review still writes a real email.** A `needs_human` draft answers everything it can
  answer safely and marks exactly one line with `[Review before sending: ...]`. The handoff is
  internal metadata (labels, `ai_drafts.needs_human`), never the whole visible message. A draft
  whose only content is "the team will review this" fails the suite.
- **Social DMs fail closed.** `lib/socialRelevanceGate.ts` engages on three surfaces only:
  typed text with a real estate inquiry, media the lead uploaded themselves, and reshared posts
  that carry concrete property details in the caption or in cheap media evidence. Low confidence
  is not a reason to reply; an abstain is terminal and never reaches the reply model. Media is
  inspected through a thumbnail or first frame only, and a heuristic envelope summary
  ("Lead shared social content: <url>") never counts as evidence.

## Scenario Families

- Buyer showing requests: direct address, pronoun-only, ordinal references, "tomorrow afternoon".
- Property details: details, photos, links, amenities, availability.
- Financing: payment, down payment, mortgage rate, affordability, lender referral.
- Seller: valuation, sell-before-buy, timeline, occupied property, tenant in place.
- Rental/property management: lease terms, pets, deposits, maintenance, screening.
- Compliance handoff: fair housing, crime/safety/schools as protected-class proxy, legal/contract advice.
- Human review: angry lead, commission negotiation, inspection/waiver, offer strategy.
- Operational: unsubscribe, wrong person, vendor outreach, receipts, security emails.
- Robustness: typos, mixed languages, quoted threads, image-only emails, stale Gmail history.
