# Runbook: SMS delivery

## Symptom: a lead says they were messaged after replying STOP

**SEV1.** Stop automated SMS for this client first, investigate second.

```bash
# Kill switch. Takes effect on the next send; in-flight jobs still park.
vercel env rm ENABLE_SMS_AGENT production --yes && vercel --prod
```

Then establish what happened:

```sql
-- Was the opt-out recorded?
select phone, sms_consent, do_not_contact, next_action, updated_at
  from lead_memory
 where client_id = :client_id and phone like '%:last4';

-- What went out after it?
select event_at, direction, event_type, ai_action, status
  from conversation_events
 where client_id = :client_id and phone like '%:last4'
 order by event_at desc limit 20;
```

Three possible causes, in order of likelihood:

1. **A human sent it from the dashboard.** Suppression covers automated sends
   only — a manual reply is a person's accountable decision and is deliberately
   not blocked. Check `ai_action`: manual replies are not `auto_send`.
2. **The opt-out was never recorded.** `smsControlAction` only matches an exact
   keyword: `stop`, `stopall`, `unsubscribe`, `cancel`, `end`, `quit`. "please
   stop texting me" does **not** match. This is a real gap — record it as a
   product bug, honor the opt-out manually, and consider widening the matcher.
3. **Twilio knew and we did not.** If Twilio's own opt-out list blocked earlier
   sends, error 21610 should have recorded it. Confirm the status callback is
   configured (`/api/health` → `posture.channels.sms`), and check for 21610 in
   the audit trail.

Manual suppression:

```sql
update lead_memory
   set do_not_contact = true, sms_consent = 'no', next_action = 'do_not_contact'
 where client_id = :client_id and phone = :phone;
```

---

## Symptom: outbound texts are not arriving

Check the delivery callbacks — a send that Twilio accepted still fails at the
carrier, and without the callback it reads as "sent" in the dashboard.

```sql
select error_code, count(*), max(created_at)
  from request_audit_events
 where client_id = :client_id and channel = 'sms'
   and created_at > now() - interval '24 hours' and error_code <> ''
 group by 1 order by 2 desc;
```

| Code | Meaning | Action |
|---|---|---|
| 30032 | Unregistered A2P traffic | Registration is incomplete. Check the campaign status. This gets worse with volume, not better. |
| 30007 | Carrier spam filter | Message content or unregistered sender. Review recent bodies for link-heavy or promotional-looking text. |
| 30003 | Unreachable handset | Off or out of service. Not actionable. |
| 30006 | Landline / unreachable carrier | Mark the lead's phone as non-SMS. |
| 21610 | Recipient opted out | Expected. The status route records suppression automatically. |
| 21211 | Invalid `To` | Bad data in the lead row. Fix at the source. |

If **no** status rows exist at all, the callback is not configured:

```bash
node scripts/configure-theo-twilio.mjs --dry-run   # confirm the plan
node scripts/configure-theo-twilio.mjs             # apply
```

---

## Symptom: inbound texts are not reaching the agent

```bash
curl -sS -H "Authorization: Bearer $CRON_SECRET" "$PUBLIC_BASE_URL/api/health" \
  | jq '.posture.channels.sms'
```

- `signature_enforced: false` → `TWILIO_AUTH_TOKEN` is unset. **In production
  the webhook returns 503 and rejects everything.** Set the token and redeploy.
- `inbound_numbers: 0` → `TWILIO_FROM` is unset, so the tenant check cannot
  run.
- A `twilio_tenant_mismatch` in the logs means a number is pointed at the wrong
  client's deployment. Check the Twilio console: the number's SMS URL must
  match this client's `PUBLIC_BASE_URL`. **Do not "fix" this by widening the
  allowlist** — that reintroduces exactly the cross-tenant write the check
  exists to stop.

```sql
select created_at, stage, outcome, error_code
  from request_audit_events
 where client_id = :client_id and route = '/api/webhooks/theo-sms'
   and created_at > now() - interval '2 hours'
 order by created_at desc limit 30;
```

`outcome = 'blocked'` with `error_code = 'invalid_signature'` means someone is
posting forged requests, or `TWILIO_WEBHOOK_BASE_URL` does not match the URL
Twilio actually signed (proxy or domain change).

---

## Symptom: sends stopped and jobs say `sms_daily_cap`

The spend circuit breaker tripped. Work is parked, not lost.

```bash
curl -sS -H "Authorization: Bearer $CRON_SECRET" "$PUBLIC_BASE_URL/api/health" | jq '.usage'
```

Decide whether the volume is legitimate. If it is, raise
`CLIENT_DAILY_SMS_CAP`. If it is not, find the loop before raising anything:

```sql
select contact_ref, count(*)
  from request_audit_events
 where client_id = :client_id and channel = 'sms'
   and created_at > now() - interval '24 hours'
 group by 1 order by 2 desc limit 10;
```

One contact with a disproportionate count is a reply loop — usually an
autoresponder on the other end. Suppress that contact before re-enabling.

Parked jobs resume from the dashboard, or:

```sql
select dedupe_key, status, error from reply_jobs
 where client_id = :client_id and status = 'needs_human'
 order by updated_at desc limit 20;
```
