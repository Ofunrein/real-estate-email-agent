/**
 * SINGLE source of truth for per-model USD pricing. No price literal may exist anywhere else in
 * the codebase — `lib/irisEmail.ts` and `lib/theoTelemetry.ts` previously each hardcoded their own
 * copy of the same two prices (see docs/audits/2026-09-model-routing/00-evidence-ledger.md §0.5);
 * both now import from here.
 *
 * `verified_at`/`source_url` are honest, not decorative: if a price was not confirmed against a
 * live public pricing page during this audit, `verified_at` is `null` and `source_url` is `null`.
 * An unverified price is a signal to a human, not a guess dressed up as fact.
 */

export type ModelPriceEntry = {
  modelId: string;
  /** USD per million input tokens. */
  inputPerMillion: number;
  /** USD per million output tokens. */
  outputPerMillion: number;
  /** USD per million cached-input tokens (prompt cache reads). */
  cachedInputPerMillion: number;
  /**
   * USD per million reasoning tokens. `null` means the model does not bill reasoning tokens
   * separately (reasoning tokens are billed as ordinary output tokens instead).
   */
  reasoningPerMillion: number | null;
  /** ISO date this price was confirmed against `sourceUrl`, or null if unverified. */
  verifiedAt: string | null;
  /** Public pricing page the price was confirmed against, or null if unverified. */
  sourceUrl: string | null;
  /** Free-text provenance note — always present, even when verifiedAt is null. */
  note: string;
};

/**
 * Registry. Adding a model here does NOT make it routable — `resolveModelRoute` in
 * `lib/modelRouting.ts` refuses to route to any model absent from this table (Step 4.1's rule:
 * "the router refuses to route to it" when pricing is missing entirely). Models with a non-null
 * `verifiedAt` are additionally eligible for *new* candidate traffic; models with `verifiedAt: null`
 * may only be used for already-incumbent traffic (never for a newly-adopted candidate tier), since
 * an unverified price is a blocker for expanding usage, not for keeping status quo running.
 */
export const MODEL_PRICING: Record<string, ModelPriceEntry> = {
  "claude-haiku-4-5": {
    modelId: "claude-haiku-4-5",
    inputPerMillion: 0.8,
    outputPerMillion: 4.0,
    cachedInputPerMillion: 0.08,
    reasoningPerMillion: null,
    verifiedAt: null,
    sourceUrl: null,
    note:
      "Carried forward from repo incumbent (lib/theoLlm.ts classifyModel() default, previously " +
      "duplicated in lib/irisEmail.ts CLAUDE_PRICING_PER_MILLION and lib/theoTelemetry.ts " +
      "CLAUDE_PRICING). Not independently re-verified against a live public API pricing page during " +
      "this audit — Anthropic's public pricing page (fetched 2026-09-07) lists consumer subscription " +
      "tiers only, not a per-model API $/Mtok table naming this exact model id. Cached-input price is " +
      "an estimate (10% of input) consistent with typical prompt-cache discount ratios, not sourced.",
  },
  "claude-sonnet-4-6": {
    modelId: "claude-sonnet-4-6",
    inputPerMillion: 3.0,
    outputPerMillion: 15.0,
    cachedInputPerMillion: 0.3,
    reasoningPerMillion: null,
    verifiedAt: null,
    sourceUrl: null,
    note:
      "Carried forward from repo incumbent (lib/irisEmail.ts irisEmailClaudeModel() default / " +
      "lib/theoLlm.ts respondModel() default). Same unverified status as claude-haiku-4-5 above.",
  },
  "claude-sonnet-5-medium": {
    modelId: "claude-sonnet-5-medium",
    inputPerMillion: 3.0,
    outputPerMillion: 15.0,
    cachedInputPerMillion: 0.3,
    reasoningPerMillion: 15.0,
    verifiedAt: null,
    sourceUrl: null,
    note:
      "Candidate model from this audit's hypothesis. verification_status: UNVERIFIABLE — no public " +
      "pricing page names this exact model id as of 2026-09-07 (see evidence ledger §0.4). Price " +
      "shown is a same-family placeholder (mirrors claude-sonnet-4-6) for cost-formula testing only " +
      "and MUST NOT be treated as a real quote. Per this module's own rule, this model is NOT " +
      "eligible to receive newly-adopted candidate traffic until a human verifies a real price.",
  },
};

export type NewCandidateEligibility = "eligible" | "unverified_price" | "unknown_model";

/** Whether a model may receive NEWLY adopted candidate traffic (stricter than "has an entry"). */
export function newCandidateEligibility(modelId: string): NewCandidateEligibility {
  const entry = MODEL_PRICING[modelId];
  if (!entry) return "unknown_model";
  if (entry.verifiedAt === null) return "unverified_price";
  return "eligible";
}

export function getModelPrice(modelId: string): ModelPriceEntry | null {
  return MODEL_PRICING[modelId] ?? null;
}

const LEGACY_UNKNOWN_MODEL_PRICE: ModelPriceEntry = {
  modelId: "legacy-unknown-model",
  inputPerMillion: 3,
  outputPerMillion: 15,
  cachedInputPerMillion: 0.3,
  reasoningPerMillion: null,
  verifiedAt: null,
  sourceUrl: null,
  note:
    "Compatibility fallback for pre-router env-overridden models. New router-driven traffic must " +
    "use attemptCostUsd, which rejects unknown model ids.",
};

/** Compatibility pricing for legacy call sites that historically accepted arbitrary env models. */
export function getLegacyModelPrice(modelId: string): ModelPriceEntry {
  return MODEL_PRICING[modelId] ?? LEGACY_UNKNOWN_MODEL_PRICE;
}

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
};

/**
 * Cost for ONE attempt (not "per accepted result" — callers sum across all attempts, including
 * failed/retried/fallback ones, before dividing by accepted-output count; see
 * tests/ts/modelRouting/modelPricing.test.ts for the fixtures that
 * pin this down).
 */
function costWithPrice(price: ModelPriceEntry, usage: TokenUsage): number {
  const input = usage.inputTokens * price.inputPerMillion;
  const cached = (usage.cachedInputTokens ?? 0) * price.cachedInputPerMillion;
  const reasoningRate = price.reasoningPerMillion ?? price.outputPerMillion;
  const reasoning = (usage.reasoningTokens ?? 0) * reasoningRate;
  const output = usage.outputTokens * price.outputPerMillion;
  return (input + cached + reasoning + output) / 1_000_000;
}

export function attemptCostUsd(modelId: string, usage: TokenUsage): number {
  const price = MODEL_PRICING[modelId];
  if (!price) {
    throw new Error(`attemptCostUsd: unknown model "${modelId}" has no pricing entry`);
  }
  return costWithPrice(price, usage);
}

/**
 * Preserves the pre-audit fallback for existing env-overridden Iris/Theo model ids. Router-driven
 * and eval code must use strict attemptCostUsd instead.
 */
export function legacyAttemptCostUsd(modelId: string, usage: TokenUsage): number {
  return costWithPrice(getLegacyModelPrice(modelId), usage);
}

export type Attempt = {
  modelId: string;
  usage: TokenUsage;
};

/**
 * True "cost per accepted result": sum the cost of EVERY attempt (failed, retried, fallback hops)
 * that led to one accepted output, then divide by the count of accepted outputs. Never divide total
 * cost by total call count — that silently hides retry/fallback cost.
 */
export function costPerAcceptedResult(attemptsPerAcceptedResult: Attempt[][]): number {
  if (attemptsPerAcceptedResult.length === 0) return 0;
  let totalCost = 0;
  for (const attempts of attemptsPerAcceptedResult) {
    for (const attempt of attempts) {
      totalCost += attemptCostUsd(attempt.modelId, attempt.usage);
    }
  }
  return totalCost / attemptsPerAcceptedResult.length;
}

/**
 * Applies a symmetric percentage band to token counts (Step 4.3's tokenizer-sensitivity check) and
 * returns [low, high] cost bounds so callers can report whether an adopt/reject verdict flips
 * inside the band.
 */
export function costBand(attemptsPerAcceptedResult: Attempt[][], bandPct = 0.15): { low: number; mid: number; high: number } {
  const scale = (factor: number) =>
    costPerAcceptedResult(
      attemptsPerAcceptedResult.map((attempts) =>
        attempts.map((a) => ({
          modelId: a.modelId,
          usage: {
            inputTokens: Math.round(a.usage.inputTokens * factor),
            outputTokens: Math.round(a.usage.outputTokens * factor),
            cachedInputTokens: a.usage.cachedInputTokens ? Math.round(a.usage.cachedInputTokens * factor) : undefined,
            reasoningTokens: a.usage.reasoningTokens ? Math.round(a.usage.reasoningTokens * factor) : undefined,
          },
        }))
      )
    );
  return {
    low: scale(1 - bandPct),
    mid: scale(1),
    high: scale(1 + bandPct),
  };
}
