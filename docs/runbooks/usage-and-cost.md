# Runbook: usage, cost, and storage

```bash
curl -sS -H "Authorization: Bearer $CRON_SECRET" "$PUBLIC_BASE_URL/api/health" \
  | jq '{usage, cost_24h, over_cap}'
```

Caps are per client, rolling 24h, read from the audit trail:

| Env var | Caps |
|---|---|
| `CLIENT_DAILY_AI_COST_USD_CAP` | Model spend in USD |
| `CLIENT_DAILY_SMS_CAP` | Successful SMS sends |
| `CLIENT_DAILY_VOICE_CALL_CAP` | Completed calls |

Unset or `0` means uncapped. Over-cap work is **parked as `needs_human`, not
dropped** — nothing is lost, but nothing goes out either.

Caps **fail open**: if the database cannot be reached the send is allowed
rather than silenced. A monitoring outage must not take a client's agent down.
The verdict is still audited, so a run of `unavailable` is visible.

## Symptom: a cap tripped

Decide first whether the volume is real.

```sql
-- Cost by service, last 24h
select cost_service, round(sum(cost_usd)::numeric, 4) as usd, count(*)
  from request_audit_events
 where client_id = :client_id and created_at > now() - interval '24 hours'
   and cost_usd > 0
 group by 1 order by 2 desc;

-- Concentration: one contact dominating is a loop, not demand
select contact_ref, count(*), round(sum(cost_usd)::numeric, 4) as usd
  from request_audit_events
 where client_id = :client_id and created_at > now() - interval '24 hours'
 group by 1 order by 3 desc limit 10;
```

If one contact dominates, you have a reply loop — usually an autoresponder on
the other end. Suppress that contact and release the parked jobs. **Do not
raise the cap to clear a loop**; that just buys the loop more budget.

If the volume is genuine, raise the cap and tell the client what changed.

## Symptom: cost is drifting up without a spike

```sql
select date_trunc('day', created_at) as day,
       round(sum(cost_usd)::numeric, 2) as usd,
       count(*) filter (where channel = 'email') as email,
       count(*) filter (where channel = 'sms') as sms,
       count(*) filter (where channel = 'voice') as voice
  from request_audit_events
 where client_id = :client_id and created_at > now() - interval '14 days'
 group by 1 order by 1;
```

Cost per conversation rising while conversation count is flat usually means
prompts are growing — more retrieved properties, longer thread context. Check
whether property retrieval started returning more rows.

## Symptom: Neon storage or compute growth

The largest tables are `conversation_events` (every message, both directions),
`request_audit_events` (one row per stage, several per request), and
`media_uploads` (file bytes inline in Postgres).

```sql
select relname, pg_size_pretty(pg_total_relation_size(relid)) as size
  from pg_catalog.pg_statio_user_tables
 order by pg_total_relation_size(relid) desc limit 10;
```

**There is no automatic retention policy.** Nothing prunes any of these. Before
production, agree a retention period per client (see `docs/PILOT_GATES.md`) and
implement it. Until then, storage grows without bound.

Audit rows are the safest thing to prune first — they are operational telemetry,
not client data:

```sql
delete from request_audit_events
 where client_id = :client_id and created_at < now() - interval '90 days';
```

Do **not** prune `conversation_events` without the client's agreement. It is
their conversation history, and it is what the agent reads for context.

On the Neon free tier compute suspends when idle, so the first request after a
quiet period pays a cold start. That shows up as a slow first reply or a voice
tool timing out — see `voice-failures.md`.

## Symptom: media growing fast

`media_uploads` stores bytes in Postgres when Vercel Blob is not configured.
Setting `BLOB_READ_WRITE_TOKEN` moves new uploads to Blob and keeps the
database small. Existing rows are not migrated.

Media reads are client-scoped and require dashboard auth, so an upload id is
not a bearer token — but the retention question is the same as above: decide a
period, or state that it is indefinite.

## Monitoring to set up before production

- Poll `/api/health` on a schedule; alert on `"status": "degraded"`.
- Alert on `over_cap` being non-empty.
- Alert on `email.gmail_watch_healthy: false` (about 24h of warning before
  inbound email stops).
- Watch Vercel function error rate and p95 duration.
- Watch Neon compute hours and storage against the plan.
- Watch Inngest execution count against the plan (steps, not events).
