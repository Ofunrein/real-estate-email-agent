# Iris Email Stress Workflow

Goal: keep Gmail replies under 60 seconds without Vercel polling or long-running webhook work.

## Runtime Shape

- Gmail Pub/Sub calls `GET/POST /api/webhooks/iris-gmail-push` on `app.lumenosis.com`.
- The webhook only validates and emits `gmail.push.received` to Inngest.
- Inngest function `gmail-push-received` does the Gmail read/classify/label/send work.
- Vercel cron remains disabled. `vercel.json` should keep `"crons": []`.
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
4. Run targeted tests, full build, deploy, and `npm run inngest:sync`.
5. Send one live Gmail test and confirm:
   - Vercel log shows `iris_gmail_push_queued`.
   - Inngest shows a `gmail-push-received` run.
   - DB has one inbound and one outbound row.
   - Gmail thread receives the reply in under 60 seconds.

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
