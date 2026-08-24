# Runbooks

One file per failure mode. Each starts with the symptom you will actually
observe, not the cause.

Every runbook assumes you have loaded the affected client's env:

```bash
set -a && source clients/<client-id>.env && set +a
```

And that your first move is always the same:

```bash
curl -sS -H "Authorization: Bearer $CRON_SECRET" "$PUBLIC_BASE_URL/api/health" | jq
```

| Symptom | Runbook |
|---|---|
| Texts not arriving; delivery errors; opt-out complaints | [sms-delivery.md](sms-delivery.md) |
| Email replies stopped; Gmail push silent; OAuth expired | [email-delivery.md](email-delivery.md) |
| Calls failing, silent, or not transferring | [voice-failures.md](voice-failures.md) |
| Replies delayed; jobs stuck; Inngest backed up | [inngest-and-jobs.md](inngest-and-jobs.md) |
| Cost spike; cap tripped; storage growth | [usage-and-cost.md](usage-and-cost.md) |

## Severity

**SEV1 — stop and page.** A lead received a message after opting out. One
client's data appeared in another client's dashboard. The agent gave lending or
fair-housing advice.

**SEV2 — same business day.** A channel is down. Sends are failing. A cap is
tripped and real work is parked.

**SEV3 — next working day.** Elevated error rate, degraded health, cost drift.

## The two questions to answer before touching anything

1. **Which client?** Every deployment is separate. Confirm the `CLIENT_ID` in
   the health output before you change an env var.
2. **Did anything go out?** Check `request_audit_events` for `outcome = 'sent'`
   in the window. A failed send is an incident; a delivered wrong message is a
   different, worse incident.

```sql
select created_at, channel, outcome, error_code, contact_ref
  from request_audit_events
 where client_id = :client_id
   and created_at > now() - interval '2 hours'
 order by created_at desc
 limit 50;
```
