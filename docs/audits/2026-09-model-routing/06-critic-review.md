# Critic-only review — feature/admin-command-center vs origin/main

Scope: code inspection of the actual diff (`git diff origin/main...HEAD`) plus targeted existing
tests re-run (`tests/ts/commandCenter*.test.ts`, `usageLedger`, `productAnalytics`,
`visitorAnalytics` — 20/20 pass). No edits, no full suite, no DB mutation, no deploy.
Worktree: /Users/martinofunrein/Downloads/atlas/.worktrees/rea-admin-command-center (HEAD 5b3c29a).

10 findings, severity-ordered.

## 1. CRITICAL — Preview auth bypass grants unauthenticated cross-tenant access to the whole ledger
file: lib/authGuard.ts:34-41 (with auth.ts:26-30, app/api/command-center/route.ts:16-17)
`requireCommandCenterViewer()` short-circuits on `localAuthBypassEnabled()`, which is true for any
`VERCEL_ENV=preview` deployment with `ALLOW_PREVIEW_AUTH_BYPASS=1`, and then synthesizes a viewer
from `Object.keys(configuredWorkspaces())[0]` — no session, no email check.
Exploit path: anyone who knows a preview URL calls `GET /api/command-center` with no cookie. If the
first key in `WORKSPACE_EMAIL_MAP` is the operator entry (`role: "platform_admin"` — exactly the
shape in tests/ts/commandCenterAuth.test.ts:10), `authorizeCommandCenterScope` returns
`allTenants: true` and the response contains every active tenant's plan price, spend, margin,
correlation ids and per-attempt traces. Previously this route family exposed no cost/tenant data, so
the bypass is newly load-bearing. Auth is not fail-closed for the new surface.
proposed test (tests/ts/commandCenterAuthBypass.test.ts): with `VERCEL_ENV=preview`,
`ALLOW_PREVIEW_AUTH_BYPASS=1`, and a `WORKSPACE_EMAIL_MAP` whose first entry is
`role: "platform_admin"`, assert `requireCommandCenterViewer()` returns `null` (or a viewer with
`role === "tenant_user"` and `allTenants === false`), i.e. bypass never yields platform-admin scope.

## 2. CRITICAL — AI spend cap now reads a ledger that the email agent never writes (cap silently fails open)
file: lib/usageCaps.ts:77-86 (source switched from `request_audit_events` to `usage_cost_ledger`);
only writer is lib/usageLedger.ts:24 called from lib/agentCostAudit.ts:53, reached exclusively by the
Theo SMS/WhatsApp/social webhooks. Iris email cost is still written only to `request_audit_events`
(lib/irisEmail.ts:1391-1405), and Aria/Inngest paths likewise.
Failure path: an Iris runaway loop or inbound email flood accrues unbounded Anthropic spend while
`usageInLastDay("ai")` keeps returning ~0, so `checkUsageCap("ai")` (consumed at
lib/inngest/functions/messageReplySend.ts:92) never trips. The migration converts a working circuit
breaker into a decorative one — the exact failure the module header claims to prevent.
proposed test (tests/ts/usageCapsLedgerCoverage.test.ts): static coverage assertion — for every
module that computes a Claude cost (`legacyAttemptCostUsd` / `claudeCostUsd` /
`claudeTokenCostUsd` callers), assert the same module (or its audit helper) also calls
`recordUsageAttempt`; fail listing `lib/irisEmail.ts`. Pair with a unit test that feeds an
`ai` cap of 1.00 and an Iris-only cost path and asserts `checkUsageCap("ai").allowed === false`.

## 3. HIGH — Ledger attemptId collides within one request, so `on conflict do nothing` deletes real cost
file: lib/agentCostAudit.ts:55 (`attemptId: ${correlationId}:${index}:${label}:${service}`) with
db/migrations/031_admin_command_center.sql:41 (`unique (client_id, attempt_id)`) and
lib/usageLedger.ts:66.
Failure path: `writeTheoMetricAuditEvents` is called twice per SMS request with the same
`audit.requestId` (app/api/webhooks/theo-sms/route.ts:740 and :781; same in theo-whatsapp:402/431,
theo-social-router:335/358). `index` restarts at 0 for the second batch, so any metric pair sharing
`label`+`service` across the two batches (e.g. two `claude` calls emitted under the same label, or
repeated `apify_zillow_lookup`) produces an identical attempt_id. The insert is swallowed,
`recordUsageAttempt` returns false silently, and both the command-center spend total and the AI cap
under-count. Retries of the same Inngest step compound this.
proposed test (tests/ts/agentCostAuditAttemptId.test.ts): stub `recordUsageAttempt`, invoke
`writeTheoMetricAuditEvents` twice with the same `requestId` and two metric arrays that share a
`label`/`service`, and assert the set of captured `attemptId`s has size equal to the total metric
count (no duplicates).

## 4. HIGH — Non-LLM metrics are booked as "failed", corrupting success rate, error rate and quota UX
file: lib/agentCostAudit.ts:62 (`status: metric.status === "ok" ? "succeeded" : "failed"`) vs the
statuses actually produced in lib/theoData.ts:123 (`"found"` / `"no_data"`), :134 (`"failed"`),
:314 (`"lookup photo"`), :345 (`"timeout"`), and lib/commandCenter.ts:197-199 where only
`succeeded|success|sent|completed|ok` count as success.
Failure path: a completely healthy SMS turn emits `found`/`no_data` enrichment metrics; every one is
persisted as `failed`. The admin UI then reports a depressed "Success rate" and inflated
"Errors" per tenant (components/command-center/CommandCenterView.tsx:139, 369) and marks traces
`hasError: true` (lib/commandCenter.ts:309). An operator paging on this dashboard chases phantom
incidents and cannot see real ones.
proposed test (tests/ts/agentCostAuditStatus.test.ts): for metrics with status `found`, `no_data`,
`ok` assert the recorded ledger status is in the success set, and only `failed`/`timeout` map to a
failure status; then assert `aggregateCommandCenter` reports `successRate === 100` for an all-healthy
turn.

## 5. HIGH — 10 000-row read cap silently truncates spend, margin and quota totals
file: lib/commandCenterStore.ts:152-165 (`order by occurred_at desc limit 10000`), consumed by
lib/commandCenter.ts:336-374 which reports the truncated set as the period total.
Failure path: with multiple active tenants and per-turn attempt fan-out (several ledger rows per
message), a 30-day platform-admin window exceeds 10 000 rows routinely. The API returns
`totals.costUsd`, `allocatedMarginUsd` and `quota.*` computed from only the newest 10 000 rows, with
no truncation flag and no UI caveat — an understated spend and an overstated margin presented as
fact. This is a cost-accounting honesty defect, not just a perf limit.
proposed test (tests/ts/commandCenterTruncation.test.ts): assert the snapshot type exposes a
`truncated` boolean and that `readCommandCenterSnapshot` sets it when the row count equals the limit
(inject a fake query result of `limit` rows); assert `aggregateCommandCenter` propagates a non-empty
`emptyReason`/caveat when truncated.

## 6. MEDIUM-HIGH — Append-only guarantee is row-trigger only; TRUNCATE and privileges are unprotected
file: db/migrations/031_admin_command_center.sql:70-82.
`create trigger ... before update or delete ... for each row` does not fire on `TRUNCATE`, and the
migration issues no `revoke update, delete, truncate on usage_cost_ledger` for the application role.
Failure path: the app's own DATABASE_URL role can `TRUNCATE usage_cost_ledger` (or drop the trigger,
which is `drop trigger if exists` on line 79 by design) and erase the billing evidence the
command-center and the AI cap now depend on — while tests/ts/commandCenterMigration.test.ts:14-15
attest the ledger is immutable. The claim is stronger than the enforcement.
proposed test (extend tests/ts/commandCenterMigration.test.ts): assert the migration text contains a
`before truncate ... for each statement` trigger on `usage_cost_ledger` and an explicit
`revoke update, delete, truncate on usage_cost_ledger from` grant statement.

## 7. MEDIUM-HIGH — PostHog `$exception` path forwards raw `$exception_*` payloads, bypassing the allowlist
file: components/analytics/ProductAnalyticsProvider.tsx:29-40.
`beforeSend` deliberately re-attaches every property whose key starts with `$exception_` before
merging the sanitized set. `$exception_message` / `$exception_stack` / `$exception_list` are
attacker- and data-controlled: a client render error thrown from inbox code can embed a lead email,
phone, address or message body in the message string, and it ships to PostHog verbatim. The
allowlist in lib/productAnalytics.ts:20-48 (and the FORBIDDEN_KEY regex on line 48) is applied to
key names only, so it never inspects these values.
proposed test (tests/ts/productAnalyticsException.test.ts): call the exported `beforeSend`-equivalent
with `{ event: "$exception", properties: { $exception_message: "lead jane@x.com 512-555-0100 wants
123 Oak St" } }` and assert the returned properties contain no `@`, no digit run of length >= 7, and
no street token — i.e. exception values are redacted, not passed through.

## 8. MEDIUM — "Platform-wide" totals silently exclude paused/onboarding/cancelled tenants
file: lib/commandCenterStore.ts:136-140 (`where ($1::text is null and status = 'active')`) surfaced
as "Platform-wide tenant health and usage." in
components/command-center/CommandCenterView.tsx:157 and as the headline spend/margin on lines 137-142.
Failure path: a tenant paused mid-period keeps generating provider cost (webhooks and Inngest jobs
are not gated on `clients.status`), but its rows are excluded from the admin's all-tenant view. The
operator reads a spend figure lower than the real invoice and a margin higher than reality, with no
"excluded tenants" disclosure.
proposed test (tests/ts/commandCenterScope.test.ts): given clients `active` and `paused` both with
attempts, assert the all-tenant snapshot either includes the paused tenant's cost in
`totals.costUsd` or exposes an explicit `excludedTenantCount`/caveat field that the view can render.

## 9. MEDIUM — Spend/attempt quota percentages compare a windowed number against a monthly limit
file: lib/commandCenter.ts:350-356 (`quota(attempts.length, client.monthlyAttemptQuota)`,
`quota(totals.costUsd, client.monthlySpendQuotaUsd)`) and lib/commandCenter.ts:250-256, rendered as
"Attempt quota"/"Quota" and driving the 80 % watch list in
components/command-center/CommandCenterView.tsx:137-148, 368.
Failure path: the numerator is scoped to the selected window (24h/7d/30d), the denominator is a
monthly quota. On the default 7-day window a tenant at 100 % of its monthly quota displays roughly
23 %, and the >=80 % "Quota watch" counter stays at 0 — the dashboard hides quota exhaustion instead
of flagging it. Selecting "24 hours" makes the same tenant look ~30x safer than on "30 days".
proposed test (tests/ts/commandCenterQuota.test.ts): one client with `monthlyAttemptQuota: 100` and
100 attempts inside a `24h` range — assert `quota.attempts.percent === 100` (billing-period-scoped)
or that the metric is returned as `null`/labelled window-scoped rather than silently mis-scaled;
assert the value is invariant across `24h`/`7d`/`30d` for the same billing period.

## 10. LOW-MEDIUM — Deep-link trace lookup resolves against a truncated, post-sliced trace list
file: app/api/command-center/route.ts:35-38 (`snapshot.traces.find(...)`) against
lib/commandCenter.ts:313 (`.slice(0, 100)`) and the 10 000-row read cap above.
Failure path: `?trace=<correlationId>` for any correlation outside the newest 100 traces returns
`selectedTrace: null` and the UI renders "not found" for a trace that exists in the ledger. During
an incident review the operator concludes the attempt was never recorded, which is the opposite of
the truth — misleading admin UX on the one screen used for forensics.
proposed test (tests/ts/commandCenterTraceLookup.test.ts): build 150 traces, request the 120th
correlation id, and assert the response distinguishes "outside returned page" from "absent" (e.g.
`selectedTrace` resolved by a targeted store lookup, or an explicit `traceOutOfPage: true`).

Not a defect (checked, survived inspection): `authorizeCommandCenterScope` tenant containment for
`tenant_user` (lib/commandCenterAuth.ts:19-22); honest-null revenue/margin when any plan price is
missing (lib/commandCenter.ts:226-231); tenant+correlation trace keying
(lib/commandCenter.ts:285-289); ledger metadata allowlist (lib/commandCenter.ts:127-133); migration
numbering 031/032 additive and `if not exists` throughout; HMAC-only analytics distinct id
(lib/analyticsIdentity.ts:4-9); `private, no-store` on all command-center responses.
