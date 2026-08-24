# Runbook: voice (Aria)

Vapi runs the conversation. Our side is the tool webhook and the end-of-call
report. Source of truth for assistant config is `lib/ariaAssistant.ts` — never
edit in the Vapi dashboard, it will be overwritten on the next provision.

## Symptom: calls connect but the agent says nothing useful

Tool calls are timing out. The internal data budget is 3.5s
(`ARIA_ENRICHMENT_TIMEOUT_MS`) but the Vapi-side tool timeout is 30s, so a hung
query leaves the caller in silence far longer than the agent expects.

```sql
select stage, outcome, duration_ms, error_code, created_at
  from request_audit_events
 where client_id = :client_id and channel = 'voice'
   and created_at > now() - interval '2 hours'
 order by created_at desc limit 40;
```

Sustained `duration_ms` near 3500 means the database is the bottleneck. Check
Neon compute — on the free tier the first query after idle pays a cold start,
which is exactly when a caller is waiting.

## Symptom: `aria_voice_tenant_mismatch` in the logs

A Vapi event whose `assistantId` or `phoneNumberId` is not this deployment's.
The event is rejected with a 404, which is correct — it would otherwise write
another client's call into this client's database.

Causes: an assistant cloned in the Vapi dashboard, a number attached to the
wrong assistant, or two clients sharing one Vapi account. Confirm:

```bash
curl -sS -H "Authorization: Bearer $CRON_SECRET" "$PUBLIC_BASE_URL/api/health" \
  | jq '.posture.channels.voice'
```

Fix the Vapi configuration. Do not relax the check.

Note tool names upsert **org-wide** in Vapi. Two clients in one Vapi
organization will fight over them; `toolReuseKey` scopes reuse by server
origin, but one account per client is still the supported layout.

## Symptom: transfers fail or reach the wrong business

```bash
npm run vapi:audit
```

Reports the live assistant against config-as-code and flags a missing or
placeholder transfer destination as critical. `HUMAN_TRANSFER_NUMBER` is
required at provision time, so a missing one means someone edited the assistant
in the dashboard. Re-provision:

```bash
npm run aria:provision:dry    # read it first
npm run aria:provision
```

## Symptom: the greeting does not disclose recording

`recordingDisclosure()` puts it in every inbound and outbound opener, and a
test asserts it. If it is missing, someone set `ARIA_RECORDING_DISCLOSURE=off`.

That value is only valid if recording is **actually disabled in Vapi**.
Recording while suppressing the disclosure is worse than either alternative.
See `docs/PILOT_GATES.md`.

## Symptom: a fair-housing or lending answer got through

**SEV1.**

1. Pull the transcript: `select transcript, recording_url from voice_calls
   where client_id = :client_id and call_id = :call_id;`
2. If the pattern is reproducible, disable voice for this client (detach the
   number in Vapi) before fixing the prompt.
3. Reproduce: `npm run vapi:evals`
4. Fix in `lib/ariaAssistant.ts`, add the case to the eval set, re-provision.
5. Review every call in the same window — one leak usually means a class of
   prompts, not a single unlucky call.

## Symptom: no end-of-call reports

`serverMessages` is `["end-of-call-report"]`. If reports stop, either the
assistant's `server.url` is wrong or the webhook secret changed.

```sql
select count(*), max(created_at)
  from voice_calls
 where client_id = :client_id and created_at > now() - interval '24 hours';
```

`npm run vapi:audit` prints the live `server.url`. It must match this client's
`PUBLIC_BASE_URL` and carry the current `CHANNEL_WEBHOOK_SECRET`. Rotating that
secret without re-provisioning breaks voice silently — the calls still work,
the records just never arrive.

## Symptom: calls are being placed to opted-out leads

Voice cadence honors the same suppression as SMS: a text STOP stops calls too.
If a call went out anyway, check whether it was cadence or a manual/API
trigger:

```sql
select next_action, sms_consent, call_consent, do_not_contact
  from lead_memory where client_id = :client_id and phone = :phone;
```

Both paths are suppression-gated: cadence via `consentOk`, and the manual
`/api/aria/outbound` trigger via `channelSuppression` (it returns 409 for an
opted-out lead, because it also sends a follow-up SMS). If a call still went
out, the stored row did not reflect the opt-out — work backwards from
`lead_memory` to the STOP event, and treat a gap there as a product bug.
