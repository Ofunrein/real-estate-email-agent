# Evidence Ledger — Model Routing Audit (2026-09)

Every claim below carries a `path:line` citation or an exact command + output. This ledger corrects
several assumptions in the originating task prompt against what is actually in the repository today.

## 0.1 Governance

- `CLAUDE.md` (repo root) describes Iris/Theo/Aria/Olivia architecture — confirmed accurate at a high
  level, but the repo has grown substantially beyond what it documents (see "Drift from CLAUDE.md" below).
- Atlas workspace rule: `projects/` is Ofunrein-only; this repo's remote is
  `https://github.com/Ofunrein/real-estate-email-agent.git` (see 0.2) — compliant.
- `docs/decisions/2026-07-15-deprecate-agent-py.md` exists; `deprecated/agent.py` was NOT read or
  modified per prohibition #9.
- `graphify-out/graph.json` was not present/used; discovery proceeded via `Grep`/`Glob`/`Read` directly
  (cheaper for this repo size; graphify not required to exist).

## 0.2 Git / remotes / submodules

- `git rev-parse --show-toplevel` → `/Users/martinofunrein/Downloads/atlas/projects/real-estate-email-agent`
- `git remote -v` → `origin https://github.com/Ofunrein/real-estate-email-agent.git` (fetch+push)
- **PROD_MAIN_SHA_BEFORE = `3bd232f3e6530fa3ceb2c65aee5deccea31c9aec`** (from `git rev-parse origin/main`,
  captured before any branch work). Re-verified identical in Step 9.13/12.3.
- `git ls-remote --heads origin` confirms default branch `main` and that `main` head matches
  PROD_MAIN_SHA_BEFORE exactly.
- `gh repo view --json nameWithOwner,defaultBranchRef` → `{"defaultBranchRef":{"name":"main"},"nameWithOwner":"Ofunrein/real-estate-email-agent"}`.
  `gh auth status` confirms an authenticated `Ofunrein` account — compliant with the Ofunrein-only rule.
- `.gitmodules` declares one submodule, `lumenosis-site` (unrelated to this audit; untouched).
  `git -C /Users/martinofunrein/Downloads/atlas submodule status | grep real-estate` returned nothing —
  **this repo is NOT itself a submodule of the Atlas root repo**, so there is no parent gitlink to avoid
  updating (contrary to the prompt's caution, which was correctly conditional: "if it is").
- Working tree was clean (`git status --porcelain` empty) before branching.
- Branch created and verified: `git checkout -b audit/model-routing-evidence-20260907`;
  `git rev-parse --abbrev-ref HEAD` → `audit/model-routing-evidence-20260907`.

## 0.3 Drift from CLAUDE.md (material — changes audit scope)

`CLAUDE.md` describes a leaner product than what exists. Confirmed via `git log --oneline -30` and
`package.json`: the repo now includes Stripe billing (`stripe` dep, `package.json:84`), per-client
provisioning (`scripts/provision-client.mjs`, `npm run provision:client`), tenant/usage guards
(`tests/ts/crossTenantIsolation.test.ts`), an existing adversarial eval suite
(`scripts/adversarial-suite.mjs`, `npm run adversarial`, `npm run adversarial:proof`), an existing Vapi
adversarial-eval script (`scripts/vapi-adversarial-evals.mjs`, `npm run vapi:evals`), and existing
stress/proof artifacts (`scripts/stress-iris-email.mjs`, `docs/proof/*.md`, `docs/proof/*.json`). This
audit's eval harness is additive to, not a replacement for, those existing suites.

## 0.4 Live runtime model call sites — exhaustive inventory

**Critical finding: there is no OpenAI, no `@ai-sdk`/Vercel AI Gateway usage anywhere in this repo's
dependencies or code.** `package.json` dependencies (`package.json:59-84`) contain no `openai`,
`@anthropic-ai/sdk`, or `ai`/`@ai-sdk/*` packages. Model calls are made via **raw `fetch()` directly to
`https://api.anthropic.com/v1/messages`**. There is no centralized model registry — model ids are
literals/env-vars scattered across two files, and pricing tables are **duplicated** (see 0.5).

| # | File:line | Channel/Agent | Task class | Model literal / var | Default | Env override(s) | Temp/max_tokens | Human-review path | Customer-facing |
|---|-----------|----------------|-----------|----------------------|---------|------------------|------------------|--------------------|------------------|
| 1 | `lib/theoLlm.ts:34-36` | Theo (SMS/RCS/WhatsApp) | classification | `classifyModel()` | `claude-haiku-4-5` | `THEO_CLASSIFY_MODEL`, `CLAUDE_CLASSIFY` | maxTokens=400 (`lib/theoLlm.ts:250`) | none in router itself; downstream Theo logic decides handoff | yes (drives reply) |
| 2 | `lib/theoLlm.ts:38-40` | Theo | reply generation | `respondModel()` | `claude-sonnet-4-6` | `THEO_RESPOND_MODEL`, `CLAUDE_RESPOND` | maxTokens=700 (`lib/theoLlm.ts:357`) | none | yes |
| 3 | `lib/theoLlm.ts:162-206` | Theo | shared Anthropic call helper | `anthropicMessage(model, ...)` | n/a (takes model param) | n/a | caller-supplied | n/a | n/a |
| 4 | `lib/irisEmail.ts:1291-1293` | Iris (email) | reply generation | `irisEmailClaudeModel()` | `claude-sonnet-4-6` | `IRIS_EMAIL_RESPOND_MODEL`, `CLAUDE_RESPOND` | see `lib/irisEmail.ts:1372-1393` | n/a | yes |
| 5 | `lib/irisEmail.ts:1373` | Iris | reply generation | raw fetch to `api.anthropic.com/v1/messages` | — | — | — | — | yes |
| 6 | `lib/ariaAssistant.ts` (documented in `CLAUDE.md`) | Aria (voice) | voice turn | `gpt-4o-mini` | Vapi-managed | **not settable from this repo** — Aria's model is chosen inside the Vapi assistant config pushed by `npm run aria:provision`, which this audit is expressly forbidden from running (prohibition #5) | n/a | SMS fallback on tool-call timeout (documented) | yes |
| 7 | `lib/irisEmail.ts:714-778` | Iris | **classification-derived routing decision** (`decideIrisEmailExecution`) | n/a — deterministic rule engine, not a model call | n/a | n/a | n/a | **this IS the human-review/send-gate logic** | gates sending, not a model itself |

**Answer to the prompt's explicit questions:**
- Is there a centralized model registry today? **No.** Model ids are two functions
  (`classifyModel()`/`respondModel()` in `theoLlm.ts`, `irisEmailClaudeModel()` in `irisEmail.ts`), each
  reading its own env-var names, with no shared source of truth.
- Is Aria's model chosen by this repo or by Vapi's assistant config? **By Vapi's assistant config**
  (`lib/ariaAssistant.ts` is pushed via `aria:provision`; the repo does not call a model directly for
  voice turns). This audit's router cannot and does not change Aria's model — see Decision doc, Aria tier.

**Hypothesis-model verification (required before building anything):**
- `GPT-5.6 Luna` — **does not resolve to any model identifier reachable from this repo's provider path
  (raw Anthropic fetch only; no OpenAI/gateway wiring exists) and does not appear in this session's own
  available-subagent-model registry**, which lists `gpt-5.6-sol-medium` and `gpt-5.6-terra-medium` but
  no `-luna` variant. **This is a genuine external blocker for the "Luna" tiers of the hypothesis** —
  recorded per Step 8, routed to the nearest verifiable comparison instead (see Decision doc).
- `Claude Sonnet 5` — resolves to `claude-sonnet-5-medium` in the session's available-subagent-model
  registry, and is structurally consistent with this repo's existing raw-Anthropic-fetch call pattern
  (same provider, same endpoint shape). Used as the sole live-model candidate in this audit's Decision
  doc.
- Neither `claude-haiku-4-5`, `claude-sonnet-4-6` (repo's current incumbents), nor `claude-sonnet-5`
  appear on Anthropic's public consumer pricing page (`https://www.anthropic.com/pricing`, fetched
  2026-09-07 — that page lists consumer subscription tiers only, not a per-model API $/Mtok table, and
  does not name these specific model ids). **No independently-verifiable public price source exists for
  any of the three model ids in play.** This is recorded honestly in `lib/modelPricing.ts` as
  `verified_at: null, source_url: null, note: "carried forward from repo incumbent, not independently
  re-verified against a public API pricing page"` for the two incumbents, and
  `verification_status: "unverifiable"` for the candidate — per Step 4.1's own rule, an unverified price
  is a blocker for *routing new traffic* to that model, not a reason to silently invent a number.

## 0.5 Pricing / telemetry / caps today

- Pricing is duplicated in two places with **identical numbers but no shared source**:
  `lib/irisEmail.ts:1299-1302` (`CLAUDE_PRICING_PER_MILLION`) and `lib/theoTelemetry.ts:10-13`
  (`CLAUDE_PRICING`). Both hardcode `claude-haiku-4-5: {input:0.80, output:4.00}` and
  `claude-sonnet-4-6: {input:3.00, output:15.00}` per-million-token USD.
- Cost is computed per successful call only (`claudeTokenCostUsd`/`claudeCostUsd`), not per attempt —
  retries/timeouts/schema-rejects are not separately costed anywhere found.
- `lib/theoTelemetry.ts:30-36` accumulates an in-memory `sessionCostUsd` — not persisted, not per-tenant,
  resets on process restart. No budget guard/circuit breaker found for model spend specifically (tenant
  usage guards exist per `tests/ts/crossTenantIsolation.test.ts` but govern tenant-level usage, not
  model-attempt cost).
- No `request_audit_costs`-style existing telemetry column set was found to already capture per-attempt
  model telemetry with the full field list this audit requires (retries, fallback hop, reasoning tokens,
  cache tokens) — `db/migrations/022_request_audit_costs.sql` exists but is a distinct, narrower cost
  ledger; this audit adds a new additive migration rather than overloading it.

## 0.6 Tests / CI / migrations

- `package.json` scripts (verbatim): `lint` = `tsc --project tsconfig.lint.json --pretty false`;
  `test` = `node --import tsx --test "tests/ts/**/*.test.ts"`; `test:py` = `node scripts/run-python-tests.mjs`;
  `build` = `next build` (with `prebuild` running `security:scan` + `lint` first).
  Single-file form confirmed available: `node --import tsx --test tests/ts/<file>.test.ts`.
- TS test suite: **~90 files** under `tests/ts/` (`ls tests/ts | wc -l`), covering everything from
  `ariaAssistant.test.ts` to `inboxLabelPlan.test.ts` to `crossTenantIsolation.test.ts`. This is far more
  than "two suites" — the audit's Step 9 must run against the real, large suite.
- Python tests: 17 files under `tests/*.py`, run via `scripts/run-python-tests.mjs` (which selects the
  project interpreter per `05196b9`/`0ba60d3` commits).
- `db/migrations/` contains **31 files**, highest-numbered `030_client_onboarding.sql` (not
  `029_contact_suppression.sql` as CLAUDE.md states — the repo has moved on; `029_contact_suppression.sql`
  is the second-highest). After command-center integration, this migration is `032_model_attempt_telemetry.sql`.
- `lib/inboxData.ts:15-29` defines `AgentInboxData` with keys: `leads, events, voiceCalls, properties,
  metrics, threads, threadCategories, inboxCategories, inboxSettings, drafts, emailCapabilities,
  threadReadStates, channelAccounts, propertyHealth`. `direction` enum confirmed
  `"inbound" | "outbound"` at `lib/inboxData.ts:127`. `channel` field confirmed present at
  `lib/sheetSchema.ts:75`.
- `lib/irisEmail.ts:714-778` (`decideIrisEmailExecution`) confirmed as the **sole send/label-authorizing
  function**: it returns `canReply` (true only on the Tier-A allowlist branch at line 771-778) and
  `labels` (`["AUTO_REPLIED"]` or `["NEEDS_HUMAN"]` or `[]`). No model call happens inside it — it is a
  deterministic rule engine over an already-produced classification. This audit's router must never be
  called by, or override, this function.

## Correction recorded during implementation (Step 5)

`lib/dataSource.ts:22-38` (`readLeads`, `readEvents`, `readProperties`) is a narrow **read-only**
accessor over the AgentInboxData-shaped tables. It has no generic write path and is not the
pattern this repo actually uses for telemetry/cost writes: the closest existing analog,
`lib/requestAudit.ts:6-27`, owns its own `pg.Pool` gated by a local `databaseEnabled()` check and
does **not** route through `lib/dataSource.ts`. `lib/modelAttemptTelemetry.ts` (this audit) follows
that same established, already-shipped convention rather than forcing a new write path through a
module that was never designed for it. Reality wins per this task's own instruction.

## Frozen thresholds

`evals/model-routing/thresholds.frozen.json` committed at commit following `0c710f6`, BEFORE any eval
run. `git hash-object evals/model-routing/thresholds.frozen.json` = `e320203ed2a82729ad1a7400e675b6a68d40731c`.
This hash is repeated in the PR body per the completion contract.

## 0.7 No prohibited reads performed

No `conversation_events`, `lead_memory`, or mailbox content was queried. No `.env*` file was read for
secret values (`.env.example` was referenced only for variable **names**, never values). No customer
message was sent. `deprecated/agent.py` was not opened.
