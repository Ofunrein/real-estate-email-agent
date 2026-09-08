# Rollout, Kill Switch, and Rollback

## Default state

`MODEL_ROUTING_PROFILE` defaults to `legacy`. Merging this branch changes no selected production
model and does not activate candidate routing. Migration `032_model_attempt_telemetry.sql` remains
unapplied.

## Canary ladder

Do not start this ladder until candidate model ids and prices are verified, bounded provider
contract tests pass, production-path fake-adapter coverage exists, and an operational kill switch
is available.

| Stage | Traffic | Minimum observation | Required gate before advancing |
|---|---:|---|---|
| Internal | Synthetic/internal only | 1 hour and full corpus | Sensitive recall = 1.00; 0 adversarial bypasses; 0 loops; provider errors = 0 |
| Canary 1 | 5% | 24 hours and >=100 attempts | Sensitive recall = 1.00; fallback <=0.10; voice p95 <=3000 ms and p99 <=3400 ms; email model p95 <=20000 ms; cost/accepted <=1.00x incumbent; provider error rate no more than 1 percentage point above incumbent |
| Canary 2 | 25% | 48 hours and >=500 attempts | Same gates, with 0 critical reply-quality failures |
| General | 100% | 7 days before declaring stable | Same gates continuously; any miss rolls back immediately |

## Kill switch

The logical kill switch is one value: set `MODEL_ROUTING_PROFILE=legacy`. The authorized on-call
operator owns the change.

Important operational limitation: this value currently comes from process environment, so on
Vercel an environment change normally requires a new deployment to reach running instances. A
"no-deploy" kill switch is therefore **not implemented**, and candidate rollout must remain blocked
until the profile is moved to dynamic configuration or another verified instant-control path.
Current expected rollback time is deployment time, targeted under five minutes.

## Code rollback

Before integration, identify the final routing commits with:

`git log --oneline origin/main..HEAD -- lib/modelRouting.ts lib/modelPricing.ts lib/modelAttemptTelemetry.ts`

Revert those commits in reverse order with `git revert <sha>`. Do not roll back by rewriting
history. Migration `032_model_attempt_telemetry.sql` is additive and safe to leave unapplied; if it
has already been applied, leave the table in place until a separately reviewed cleanup migration.

## Explicitly excluded human follow-up

- Verify real provider model ids and public prices.
- Implement production-path fake-adapter integration coverage before wiring the router.
- Implement a no-deploy dynamic kill switch.
- Apply migration `032_model_attempt_telemetry.sql` only through the normal reviewed migration flow.
- Change production environment/profile only after all canary prerequisites pass.
- If Aria config ever changes, run `npm run aria:provision` deliberately as a separate human action.

None of these actions were performed by this audit.
