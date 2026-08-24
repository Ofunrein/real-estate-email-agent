# Runbook: email delivery (Iris)

Live Iris is TypeScript on Vercel + Inngest. `deprecated/agent.py` is not the
runtime — do not read it to debug this.

```
Gmail → Pub/Sub → /api/webhooks/iris-gmail-push → inngest "gmail.push.received"
      → gmailPushReceived → classify → reply → send
```

## Symptom: no replies at all, no errors

Most often this is intentional. Both gates must be true:

```bash
curl -sS -H "Authorization: Bearer $CRON_SECRET" "$PUBLIC_BASE_URL/api/health" \
  | jq '.posture.channels.email'
```

`live: false` or `sends_replies: false` means Iris is processing and drafting
but never sending — the correct state during shadow mode. Turn on only after
the pilot gate.

## Symptom: inbound email stopped arriving

The Gmail watch expires every 7 days; Inngest renews it daily. If renewal is
failing you get roughly one day of warning.

```bash
curl -sS -H "Authorization: Bearer $CRON_SECRET" "$PUBLIC_BASE_URL/api/health" | jq '.email'
```

- `gmail_watch_healthy: false` → under 24h remaining. Re-register now:
  `EMAIL_ACCOUNT_CLIENT_ID=<client-id> npm run setup:gmail-push`
- `connected: false` → OAuth is broken. See below.
- `reason: "no_connected_mailbox"` → nobody completed the dashboard OAuth flow.

Then confirm Google is actually delivering:

```sql
select created_at, stage, outcome, error_code
  from request_audit_events
 where client_id = :client_id and route = '/api/webhooks/iris-gmail-push'
   and created_at > now() - interval '6 hours'
 order by created_at desc limit 20;
```

No rows means the push never arrived — the problem is in Pub/Sub, not here.
Check the subscription's push endpoint matches this client's `PUBLIC_BASE_URL`
and carries the right `?token=`.

`outcome = 'blocked'`, `error_code = 'unauthorized_pubsub_push'`: the token in
the subscription does not match `GMAIL_PUBSUB_TOKEN`. Note the route **ACKs**
unauthorized pushes on purpose — returning 4xx makes Pub/Sub retry forever — so
this fails silently unless you look here.

## Symptom: OAuth expired

```sql
select email, status, last_error, updated_at
  from email_accounts
 where client_id = :client_id and provider = 'gmail';
```

`status = 'error'` with an auth-related `last_error`: the client revoked access,
changed their password, or the refresh token was invalidated. There is no
automated recovery — the client must reconnect through the dashboard. Tell them
what they will see, then confirm `status = 'connected'` and re-run
`setup:gmail-push`, because the watch does not survive a reconnect.

## Symptom: `gmail_mailbox_tenant_mismatch` in the logs

A push about a mailbox this deployment did not connect. Either a watch was
registered against the wrong deployment, or two clients' Pub/Sub subscriptions
point at the same endpoint. The event is skipped, which is correct — it would
otherwise drive this client's Gmail session from another client's notification.

Fix the subscription, not the check.

## Symptom: replies are wrong, or go to unrelated mail

Iris classifies before replying and parks non-real-estate mail as
`needs_human`. If it is replying to things it should not:

```sql
select gmail_message_id, status, ai_action, summary
  from conversation_events
 where client_id = :client_id and channel = 'email' and direction = 'inbound'
   and created_at > now() - interval '24 hours'
 order by created_at desc limit 30;
```

Immediate mitigation is to unset `IRIS_EMAIL_SEND_REPLIES` and redeploy —
drafting continues, sending stops. Then reproduce against the classifier with
`npm run stress:email` before changing prompt logic.

## Symptom: the same message is answered twice

Sends are idempotency-keyed on the reply job, and `hasNewerInboundForThread`
supersedes stale drafts. A genuine duplicate means two reply jobs with
different dedupe keys for one message:

```sql
select dedupe_key, thread_ref, status, created_at
  from reply_jobs
 where client_id = :client_id and thread_ref = :thread_ref
 order by created_at desc;
```

Note `gmailPushReceived` deliberately runs a recovery sweep of parked
`needs_human` messages on every push. That is dedup-guarded, but it is the
first place to look for an unexpected second reply.
