# Runbook: Inngest and background jobs

Every deployment has its own Inngest app id, derived from `CLIENT_ID`
(`lib/tenant.ts`). This matters more than it looks: Inngest keys apps by
`(environment, app id)`, so two deployments sharing an id become **one app**,
and the later sync silently takes over the earlier one's function routing —
client A's inbound email would then execute against client B's database.

```bash
curl -sS -H "Authorization: Bearer $CRON_SECRET" "$PUBLIC_BASE_URL/api/health" \
  | jq '.posture.inngest_app_id'
```

Confirm it is unique per client. If two clients report the same id, that is a
**SEV1** — stop and fix before looking at anything else.

## Symptom: replies are slow

Note the built-in delay first: `gmailPushReceived` sleeps 45s on purpose, to
let a lead's quick follow-up land and be answered in one reply. Anything under
about a minute for email is by design.

Beyond that, check whether jobs are queued or stuck:

```sql
select status, count(*), max(updated_at)
  from reply_jobs
 where client_id = :client_id and created_at > now() - interval '6 hours'
 group by 1;
```

| Status | Meaning |
|---|---|
| `ready_to_send` piling up | Inngest is not draining. Check the dashboard. |
| `send_failed` | Provider rejected. See the channel runbook. |
| `needs_human` | Suppression or a usage cap parked it. Expected; review and release. |
| `superseded` | A newer inbound arrived first. Correct behavior. |

## Symptom: Inngest says functions are not registered

The route returns 503 for every verb when `INNGEST_SIGNING_KEY` is unset in
production — deliberate, so an unsigned deployment cannot serve.

```bash
curl -sS -H "Authorization: Bearer $CRON_SECRET" "$PUBLIC_BASE_URL/api/health" \
  | jq '.posture.secrets_present.inngest_signing_key'
```

Re-register after any domain change:

```bash
npx -y inngest-cli@latest api sync-app --prod "$INNGEST_APP_ID" --url "$PUBLIC_BASE_URL/api/inngest"
```

## Symptom: concurrency limits or the free-tier execution cap

**No function declares a `concurrency`, `rateLimit`, or `throttle` today.** The
only backpressure is application-level (`CADENCE_TASK_BATCH_SIZE`,
`IRIS_PROVIDER_SENDS_PER_MINUTE`). On the free plan the ceilings you meet first
are concurrent steps during a burst and the monthly execution count.

Count steps, not events. `gmailPushReceived` runs 6+ steps per push, so a
50k-execution budget is far fewer than 50k emails.

When a burst is throttling:
1. Confirm it is genuine volume, not a loop (see `usage-and-cost.md`).
2. Short term, lower `CADENCE_TASK_BATCH_SIZE` to spread the load.
3. Sustained, move that client to a paid Inngest plan — that is a billing
   decision, not an engineering one.

## Symptom: a retry ran against the wrong tenant

`messageReplySend` carries `clientId` in the event payload and re-enters the
workspace on every step, so a retry stays with the original tenant.

Other functions re-read `CLIENT_ID` from env at execution time. That is correct
under one-deployment-per-client and would be a bug in a shared deployment.
Cron-triggered functions (`cadencePlan`, `cadenceTaskRun`, `gmailWatchRenewal`)
have no request context by construction and rely on the same property.

If you ever see cross-tenant data from a background job, check the app id
first — that is the mechanism that would allow it.

## Symptom: Vercel function errors or timeouts

Inngest routes cap at `maxDuration = 60`. The webhook itself only queues work;
the long path runs inside Inngest steps, which is why a Vercel timeout usually
means a slow provider call inside a step rather than a slow webhook.

```sql
select route, count(*), avg(duration_ms)::int, max(duration_ms)
  from request_audit_events
 where client_id = :client_id and created_at > now() - interval '6 hours'
 group by 1 order by 4 desc limit 10;
```
