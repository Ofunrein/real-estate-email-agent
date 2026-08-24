# Operator checklist: onboarding one client

Work top to bottom. Every step is either a command you run or a decision you
own. The provisioning script refuses to proceed while a `[HUMAN]` step is
outstanding, so you cannot skip one by accident.

Run every command with that client's env loaded:

```bash
set -a && source clients/<client-id>.env && set +a
```

---

## 1. Identity

- [ ] Pick a `CLIENT_ID` slug: lowercase, hyphens, permanent. It is the tenant
      key on every row and cannot be renamed later without a data migration.
- [ ] `cp clients/template.env clients/<client-id>.env`
- [ ] Set `CLIENT_ID`, `CLIENT_NAME`, `TEAM_NAME`.
- [ ] Set `WORKSPACE_EMAIL_MAP` and `AUTH_ALLOWED_EMAILS` to the client's own
      operator email. **Do not skip.** Unset, `WORKSPACE_EMAIL_MAP` falls back
      to a hardcoded personal address that would then own the dashboard.

## 2. Infrastructure `[HUMAN — billable]`

- [ ] Create the Neon project. `npm run setup:neon` reuses a project of the
      same name if one exists, so a second run is safe.
- [ ] Create the Vercel project; set `VERCEL_PROJECT_NAME`.
- [ ] Decide the domain/subdomain; set `PUBLIC_BASE_URL`. Add DNS yourself.
- [ ] Generate fresh per-client secrets — never copy another client's:
      `AUTH_SECRET`, `CHANNEL_WEBHOOK_SECRET`, `CRON_SECRET`.
- [ ] Create the client's Inngest environment; set `INNGEST_SIGNING_KEY` and
      `INNGEST_EVENT_KEY`.
- [ ] Set a per-client `ANTHROPIC_API_KEY` so AI spend is attributable.

## 3. Validate before touching anything

```bash
node scripts/provision-client.mjs --client <client-id>
```

- [ ] `env_check.ok` is `true`.
- [ ] `collisions` is empty. **A collision means you copied a value from
      another client.** Two Vercel projects sharing one `DATABASE_URL` looks
      completely healthy at runtime and puts both clients' leads in one set of
      tables.
- [ ] `blocking_human_inputs` is empty.

## 4. Database

```bash
npm run migrate:status     # what is pending
npm run migrate            # apply (NEW databases only — see the warning below)
```

- [ ] Ledger reports every migration applied.
- [ ] The `clients` row exists (the migrator seeds it; ~45 foreign keys need it).

> **Existing database with no ledger — run `npm run migrate:baseline` instead.**
> The original deployment has all migrations applied but predates the
> `schema_migrations` table, so a plain apply re-runs everything. The DDL is
> safe to re-run; migration 011 is not. It flips `draft_first=false` and every
> `auto_send_*` to true on any row where all seven are off — which is exactly
> what an operator who paused the agent looks like. Baselining records the
> files as applied without executing them. `migrate` refuses to run in this
> situation rather than guessing, but check `migrate:status` first either way.

## 5. Deploy `[HUMAN — outward-facing]`

- [ ] Push env vars to the Vercel project.
- [ ] Deploy. Confirm the deployment URL matches `PUBLIC_BASE_URL`.

## 6. Channels

### Email (Iris)
- [ ] Connect the client's Gmail through the dashboard OAuth flow.
- [ ] `EMAIL_ACCOUNT_CLIENT_ID=<client-id> npm run setup:gmail-push`
- [ ] Create the Pub/Sub topic and subscription it prints.
- [ ] Leave `IRIS_EMAIL_LIVE` and `IRIS_EMAIL_SEND_REPLIES` **unset** until
      after the shadow-mode period in `docs/PILOT_GATES.md`.

### SMS (Theo) `[HUMAN — billable]`
- [ ] Buy a dedicated Twilio number. One per client, never shared.
- [ ] Create a Messaging Service; set `TWILIO_MESSAGING_SERVICE_SID`.
- [ ] **Start A2P 10DLC brand + campaign registration now.** It is reviewed and
      takes days. Unregistered traffic gets carrier-filtered (30032/30007) as
      soon as volume rises.
- [ ] `node scripts/configure-theo-twilio.mjs --dry-run`, read it, then run it
      for real. It sets the inbound webhook, the delivery status callback, and
      removes RCS senders (**destructive, no undo**).
- [ ] Confirm `TWILIO_AUTH_TOKEN` is set. Without it, production refuses
      inbound SMS rather than accepting unsigned requests.

### Voice (Aria) `[HUMAN — billable]`
- [ ] `npm run aria:provision:dry`, read the output (secrets are redacted).
- [ ] `npm run aria:provision`; set the printed `VAPI_ASSISTANT_ID`.
- [ ] Attach a Vapi number; set `VAPI_PHONE_NUMBER_ID`.
- [ ] Set `HUMAN_TRANSFER_NUMBER`. A wrong value routes the client's callers to
      another business.
- [ ] Confirm the greeting discloses recording. See `docs/PILOT_GATES.md`
      before turning voice on outside Texas.

## 7. Usage caps

- [ ] Set `CLIENT_DAILY_AI_COST_USD_CAP`, `CLIENT_DAILY_SMS_CAP`,
      `CLIENT_DAILY_VOICE_CALL_CAP` to this client's contract. Unset means
      uncapped. Over-cap work is parked for review, not dropped.

## 8. Verify

```bash
node scripts/provision-client.mjs --client <client-id> --validate
curl -sS -H "Authorization: Bearer $CRON_SECRET" "$PUBLIC_BASE_URL/api/health" | jq
```

- [ ] All validation checks pass. A `401` on `/api/data` is a **pass** — it
      proves the route deployed and refuses anonymous callers.
- [ ] `/api/health` reports `"status": "healthy"`.
- [ ] `posture.inngest_app_id` is unique to this client.
- [ ] `posture.channels.sms.signature_enforced` is `true` if SMS is on.

## 9. Live smoke test `[HUMAN — contacts real numbers]`

Use your own phone. Never a client's lead list.

- [ ] Text the client's number; a reply arrives.
- [ ] Reply `STOP`. Confirm suppression, then confirm the **next** inbound gets
      no automated reply. This is the check that used to fail.
- [ ] Reply `START`; confirm the agent resumes.
- [ ] Call the number; confirm the greeting names the right brand and discloses
      recording.
- [ ] Send an email to the connected mailbox; confirm it appears in the inbox.

## 10. Handover

- [ ] Client operator can log in and sees only their own data.
- [ ] Client knows how to take over a thread.
- [ ] `docs/runbooks/` linked in the client's support channel.
- [ ] Calendar reminder: A2P registration status, weekly until approved.

---

## Rollback

```bash
node scripts/provision-client.mjs --client <client-id> --rollback
```

Prints what it will undo. It never proposes deleting a Neon project, a Vercel
project, a phone number, or a Vapi number — anything you paid for is removed by
a human or not at all.
