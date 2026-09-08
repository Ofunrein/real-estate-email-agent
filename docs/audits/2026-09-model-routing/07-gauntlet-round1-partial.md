# Gauntlet review pass — PR #7 / feature/admin-command-center (Round 1, INCOMPLETE)

HEAD: 5b3c29ad33cb8a6ba36e3ece0fffc9947b5e18d6
Branch: feature/admin-command-center
Worktree: /Users/martinofunrein/Downloads/atlas/.worktrees/rea-admin-command-center

## Status: stopped at runtime budget during Round 1 repair. No commit, no push.

## Baseline gates (all executed, all green at HEAD 5b3c29a)
- TypeScript tests (`npm test`): PASS — 952 tests.
- Python tests (`npm run test:py`): PASS — 96 tests.
- Lint/typecheck (`npm run lint`, tsc): PASS, exit 0.
- Secret scan (`npm run security:scan`): PASS — 817 tracked files.
- Production build (`npm run build`): PASS, exit 0.
- `git diff --check origin/main...HEAD`: clean.
- Model-routing eval gate: wired into CI at .github/workflows/build-check.yml
  (`npm run eval:routing -- --offline`); NOT re-executed this pass.

Raw logs: /tmp/gauntlet-r1/{ts-tests,py-tests,lint,secret-scan,build,diffcheck}.txt

## Gate review performed (read-level verification, no defects found)
- Tenant isolation: app/api/command-center/route.ts:16-30 requires viewer then
  authorizeCommandCenterScope; lib/commandCenterAuth.ts:19-22 returns 403 on any requested
  tenant != viewer.workspaceId; store query lib/commandCenterStore.ts:136-139 binds tenant.
- Correlation-ID collisions: lib/commandCenter.ts:285-289 keys traces on
  `clientId\0correlationId`, so cross-tenant correlation reuse cannot merge traces.
- Platform-admin scope explicit: lib/workspace.ts:34 defaults role to `tenant_user`;
  platform_admin only via configured map.
- Append-only ledger: db/migrations/031:79-82 BEFORE UPDATE OR DELETE trigger raising 55000;
  writer lib/usageLedger.ts:24-38,95-103 swallows all failures and returns false (never a control path).
- Empty-state honesty: lib/commandCenter.ts:226-231 returns null (not 0) revenue/margin when
  plan price is unknown; UI renders "Not configured".
- PostHog privacy: lib/productAnalytics.ts:20-48 allowlist + forbidden-key regex;
  safeAnalyticsException replaces the error with `application_error`;
  provider disables autocapture/replay, masks all text/inputs.
- Internal/test/bot traffic: lib/visitorAnalytics.ts:63-65 sets counts_toward_kpi while
  is_internal/is_test/is_bot remain on the event (auditable, excluded from KPI).
- API fail-closed: route 503 with a generic message; internals only to captureServerException.
- Migration order: 031/032 additive, `if not exists` throughout; runner sorts by filename and
  checksums applied files.

## Defect candidates

### D1 — ledger attempt_id collision across batches — NOT CONFIRMED
Hypothesis: agentCostAudit builds attemptId from `${correlationId}:${index}:${label}:${service}`
and both the enrichment and reply calls in one webhook share `audit.requestId`, so index reuse
could silently drop rows via `on conflict (client_id, attempt_id) do nothing`.
Verification result: labels are disjoint between the two batches
(theo_enrichment_budget / apify_zillow_lookup vs theo_classify / theo_reply), so no collision is
reachable today. Filed as latent fragility only — no fix made.

### D2 — dishonest failure aggregation in the usage ledger — VERIFIED, NOT YET FIXED
File: lib/agentCostAudit.ts:62 (and audit outcome/errorCode at :44,:46).
`status: metric.status === "ok" ? "succeeded" : "failed"`.
TheoMetric.status is three-valued, not boolean: lib/theoLlm.ts:199 emits `"ok"`, while
lib/theoData.ts:123 and lib/publicPropertyData.ts:213 emit `"found" | "no_data"`, and both emit
`"failed"` only on a thrown call.
Failure path: every successful enrichment/public-record lookup that simply returned no rows is
written to usage_cost_ledger as `failed`. lib/commandCenter.ts:197-198,222-223,349 then inflates
`failed`, deflates `successRate`, and inflates per-tenant `errorRate` and the trend `errors`
series. This breaks the "provider/model attempts, retries, fallbacks, latency, errors, costs
aggregate honestly" gate — the ledger is append-only, so the distortion is permanent.
Intended minimal fix: map only {failed,error,timeout,rejected} to `failed`, everything else to
`succeeded`, with the same mapping applied to the request-audit outcome/errorCode.
State: edit was drafted and then reverted because the runtime budget expired before affected tests
(tests/ts/commandCenter.test.ts, usageLedger.test.ts, theoAgent.test.ts) and the full gate set could
be re-run. Nothing unverified was left in the tree.

## Untracked evidence — preserved, not deleted, not committed
evals/model-routing/results/2026-09-08T05-00-25-310Z/{summary.md,summary.json,per-case.jsonl}
Repository conventions DO track eval result directories (evals/model-routing/results/
2026-09-07T21-24-02-099Z/* is tracked at HEAD), so this directory is a legitimate commit
candidate — deliberately left uncommitted because this pass produced no verified code change to
accompany it and committing evidence alone would misrepresent a completed review.

## Also pre-existing and uncommitted (not authored this pass)
app/globals.css — `.command-center-internal-toggle` 44px hit-target rules, already modified in the
working tree at session start. Left as found.

## Blocker
Runtime budget exhausted mid-Round-1 repair. Round 2 and 3 not run. To finish: reapply the D2
mapping in lib/agentCostAudit.ts, run the affected tests plus the full gate set, then commit D2 and
the eval evidence together and push.
