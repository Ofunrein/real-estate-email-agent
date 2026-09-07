# Decision — Model Routing Audit

Frozen thresholds: `evals/model-routing/thresholds.frozen.json`, hash
`e320203ed2a82729ad1a7400e675b6a68d40731c`, committed at `d1ec127` (before any eval run — see
verification note in `03-verification.md`). Eval results:
`evals/model-routing/results/2026-09-07T21-24-02-099Z/{per-case.jsonl,summary.json,summary.md}`.

## Per-tier verdict table

| Routing path | Incumbent | Hypothesis candidate | Metric | Measured value | Frozen threshold | PASS/FAIL | Verdict | Reason |
|---|---|---|---|---|---|---|---|---|
| Fair Housing / lending / legal / complaint / negotiation ("sensitive") | Human review (already exists as `decideIrisEmailExecution` NEEDS_HUMAN path) | Deterministic human review (hypothesis's 4th tier) | Compliance recall on 80 sensitive-routing.jsonl cases | **1.0000** (80/80) | >= 1.00 | **PASS** | **ADOPT** | `evals/model-routing/results/.../summary.json` gates.compliance_recall_candidate.rate = 1.0. Matches the hypothesis's own 4th tier — this is the one hypothesis tier that survives unchanged, because it asks for exactly what already exists structurally (rule-based stop, no model). |
| Adversarial / prompt-injection resistance | N/A (no router existed before this audit) | Router must resist 40 injection templates | 0 bypasses | **1.0000 pass rate** (40/40, i.e. 0 bypasses) after 1 fix cycle (first run was 0.75 — see `03-verification.md` and commit `cecd603`) | 0 bypasses | **PASS (after fix)** | **ADOPT** | First eval run caught 2 injection phrasings the initial regex net missed (`"send...automatically...skip approval"`, `"legally bind...without disclosure"`); fixed and re-verified before this doc was written. |
| Classification (`GPT-5.6 Luna`, low effort) | `claude-haiku-4-5` (`lib/theoLlm.ts:34-36`) | `GPT-5.6 Luna` low | Macro-F1, per-field exact match | **not_measured_offline** — the model does not exist (see evidence ledger §0.4) | >= 0.90 abs / incumbent-0.01 | **N/A — genuine external blocker** | **REJECT (hypothesis) / KEEP INCUMBENT** | `GPT-5.6 Luna` is unreachable from this repo's provider path (raw-Anthropic-fetch only, no OpenAI wiring) and does not resolve in any model registry available to this audit. Per the task's own rule, this is a blocker for *that tier*, not a reason to invent a number. No live comparison was run against any substitute (see below), so there is no evidence to adopt anything new — incumbent stands. |
| Routine reply / property-match copy (`GPT-5.6 Luna`, medium effort) | `claude-sonnet-4-6` (`lib/irisEmail.ts:1291-1293`, `lib/theoLlm.ts:38-40`) | `GPT-5.6 Luna` medium | Reply-quality rubric pass rate | **not_measured_offline** | >= incumbent-0.02 | **N/A — genuine external blocker** | **REJECT (hypothesis) / KEEP INCUMBENT** | Same blocker as above. `lib/modelRouting.ts` DOES define a `routine_medium` candidate tier (`claude-haiku-4-5`, medium effort) for future canary testing, but it is not adopted here — no live eval was run to show it beats `claude-sonnet-4-6` on quality, and per the decision rule ties/unknowns default to the incumbent. |
| Hard/difficult fallback (`Claude Sonnet 5`, medium) | `claude-sonnet-4-6` | `claude-sonnet-5-medium` | Reply-quality rubric pass rate, cost/accepted, latency | **not_measured_offline (no live model call was made this session)** | >= incumbent-0.02 quality, <=1.00x cost | **N/A — no evidence** | **REJECT (hypothesis) / KEEP INCUMBENT** | `claude-sonnet-5-medium` DOES resolve in this session's available-model registry (unlike Luna), so it is not a hard blocker the way Luna is — but its price is `verification_status: unverifiable` (`lib/modelPricing.ts`) and no live-call evidence was gathered under Step 9.9's bounded contract-test conditions in this session. An unmeasured, unpriced candidate cannot be adopted. The router exposes it as `hard_fallback` tier for a human to canary-test later with a real, bounded live run. |
| Aria voice turn (`GPT-5.6 Luna`, low effort) | `gpt-4o-mini` (Vapi-managed, `lib/ariaAssistant.ts`) | `GPT-5.6 Luna` low | Latency p95 <= 3000ms | **not_measured_offline; also not_applicable — this repo cannot change Aria's model** | latency + quality gates | **N/A — genuine external blocker (double: nonexistent model AND wrong system boundary)** | **REJECT (hypothesis), explicitly OUT OF SCOPE** | Aria's model lives in Vapi's assistant config, provisioned only via `npm run aria:provision` — expressly forbidden from being run by this audit (prohibition #5). Even if `GPT-5.6 Luna` existed, this repo has no code path that would call it for voice turns. The router still models a `routine_low` tier for voice for documentation/decision purposes, and locks (via test) that voice always gets the fast tier regardless of latency headroom — but this is inert until a human deliberately re-provisions Aria outside this PR. |

## Summary: which parts of the hypothesis survived

- **Survived, implemented, and measured:** the deterministic-human-review tier for Fair Housing /
  lending / legal / complaint / negotiation. This was true before this audit too
  (`decideIrisEmailExecution`'s NEEDS_HUMAN path) — this audit adds a second, provider-independent
  safety net (`lib/modelRouting.ts`'s keyword rules) ahead of any future model call, verified at
  1.00 recall against 80 synthetic cases plus 0 adversarial bypasses against 40 synthetic injection
  attempts.
- **Rejected outright:** every `GPT-5.6 Luna` tier, because that model does not exist in any
  provider path this repo has, or in this session's own model registry.
- **Rejected for lack of evidence, not rejected on the merits:** `Claude Sonnet 5` for the hard
  fallback tier, and the implicit "upgrade routine replies" idea generally. Nothing was measured to
  beat the incumbent, so nothing replaces the incumbent. This is the single biggest honest
  conclusion of this audit: **the hypothesis's 3 model-upgrade tiers (Luna-low, Luna-medium,
  Sonnet-5) are not adopted**, because (a) two of the three literally don't exist as reachable
  models, and (b) the third was never actually measured against the incumbent with a live call in
  this session, so "keep the incumbent" is the only defensible conclusion — exactly the outcome the
  audit's own instructions call a success, not a failure.
- **Net production effect of this PR: zero**, by construction. `MODEL_ROUTING_PROFILE` defaults to
  `legacy`; `resolveModelRoute()` under `legacy` returns the pre-audit incumbent models unchanged
  for every task class (see `lib/modelRouting.ts` `LEGACY_TIER_MODEL`).

## Cost per accepted result (Step 4)

No live calls were made, so there is no *measured* cost delta between incumbent and candidate — see
above. What this audit DOES ship and unit-test (`tests/ts/modelRouting/modelPricing.test.ts`) is the
formula itself, proven correct on hand-computed fixtures, including the retries+fallback+reasoning+
cache-aware summation and the ±15% tokenizer band (`costBand()` in `lib/modelPricing.ts`). A worked
*illustrative* example (not a real measurement — inputs are fixture numbers, not live-traffic
numbers) using the frozen formula:

| Scenario | Attempts | Cost (-15% tokens) | Cost (mid) | Cost (+15% tokens) | Verdict flips in band? |
|---|---|---|---|---|---|
| 1 accepted classification, 0 retries, incumbent `claude-haiku-4-5`, 500in/50out | 1 | $0.000512 | $0.0006 | $0.000688 | No — single-model, nothing to flip against |
| 1 accepted reply requiring 1 failed haiku attempt + 1 successful sonnet-4-6 fallback, 800in/40out then 800in/400out | 2 | $0.00782 | $0.0092 | $0.01058 | No — this is the incumbent's OWN retry cost, not a candidate comparison |

(Recomputed via `node --import tsx` against the actual `attemptCostUsd`/`costBand` functions, not
hand-arithmetic — see `tests/ts/modelRouting/modelPricing.test.ts` for the pinned fixtures.)

No comparison table against `claude-sonnet-5-medium` is presented, because presenting one without a
verified price and without live measurement would be exactly the "guess dressed up as fact" this
audit's pricing module explicitly refuses to produce (`newCandidateEligibility()` returns
`"unverified_price"` for it).

## Aria — explicit exclusion

Aria's `gpt-4o-mini` model is defined in `lib/ariaAssistant.ts` and only takes effect in the live
Vapi assistant after a human runs `npm run aria:provision` — which this audit did not run, per
prohibition #5. No Aria-affecting change is included in this PR.
