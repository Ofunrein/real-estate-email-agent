import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MODEL_PRICING,
  attemptCostUsd,
  costPerAcceptedResult,
  costBand,
  newCandidateEligibility,
  getModelPrice,
} from "@/lib/modelPricing";

test("attemptCostUsd matches hand-computed fixture for claude-haiku-4-5", () => {
  // 1000 input tokens @ $0.80/M + 500 output tokens @ $4.00/M
  // = (1000*0.8 + 500*4) / 1e6 = (800 + 2000) / 1e6 = 0.0028
  const cost = attemptCostUsd("claude-haiku-4-5", { inputTokens: 1000, outputTokens: 500 });
  assert.equal(cost, 0.0028);
});

test("attemptCostUsd matches hand-computed fixture for claude-sonnet-4-6", () => {
  // 2000 input @ $3/M + 1000 output @ $15/M = (6000 + 15000)/1e6 = 0.021
  const cost = attemptCostUsd("claude-sonnet-4-6", { inputTokens: 2000, outputTokens: 1000 });
  assert.equal(cost, 0.021);
});

test("attemptCostUsd includes cached input and reasoning tokens", () => {
  const price = getModelPrice("claude-sonnet-5-medium")!;
  const usage = { inputTokens: 1000, outputTokens: 500, cachedInputTokens: 2000, reasoningTokens: 300 };
  const expected =
    (usage.inputTokens * price.inputPerMillion +
      usage.cachedInputTokens * price.cachedInputPerMillion +
      usage.reasoningTokens * (price.reasoningPerMillion ?? price.outputPerMillion) +
      usage.outputTokens * price.outputPerMillion) /
    1_000_000;
  assert.equal(attemptCostUsd("claude-sonnet-5-medium", usage), expected);
});

test("costPerAcceptedResult sums ALL attempts (retries + fallback hops), not just the winner", () => {
  // Accepted result #1 required: 1 failed haiku attempt + 1 successful sonnet fallback attempt.
  const attemptsPerAcceptedResult = [
    [
      { modelId: "claude-haiku-4-5", usage: { inputTokens: 1000, outputTokens: 100 } }, // failed, still costs money
      { modelId: "claude-sonnet-4-6", usage: { inputTokens: 1000, outputTokens: 500 } }, // succeeded
    ],
  ];
  const expected =
    attemptCostUsd("claude-haiku-4-5", { inputTokens: 1000, outputTokens: 100 }) +
    attemptCostUsd("claude-sonnet-4-6", { inputTokens: 1000, outputTokens: 500 });
  assert.equal(costPerAcceptedResult(attemptsPerAcceptedResult), expected);
});

test("costPerAcceptedResult divides by ACCEPTED outputs, never by total attempt count", () => {
  const attemptsPerAcceptedResult = [
    [{ modelId: "claude-haiku-4-5", usage: { inputTokens: 100, outputTokens: 100 } }],
    [
      { modelId: "claude-haiku-4-5", usage: { inputTokens: 100, outputTokens: 100 } },
      { modelId: "claude-haiku-4-5", usage: { inputTokens: 100, outputTokens: 100 } },
      { modelId: "claude-haiku-4-5", usage: { inputTokens: 100, outputTokens: 100 } },
    ],
  ];
  // 2 accepted results; total attempts = 4. Cost must divide by 2, not 4.
  const perAttempt = attemptCostUsd("claude-haiku-4-5", { inputTokens: 100, outputTokens: 100 });
  const expected = (perAttempt * 4) / 2;
  assert.equal(costPerAcceptedResult(attemptsPerAcceptedResult), expected);
});

test("costBand reports low/mid/high at +-15% token counts and mid equals unscaled cost", () => {
  const attempts = [[{ modelId: "claude-sonnet-4-6", usage: { inputTokens: 1000, outputTokens: 1000 } }]];
  const band = costBand(attempts, 0.15);
  assert.equal(band.mid, costPerAcceptedResult(attempts));
  assert.ok(band.low < band.mid);
  assert.ok(band.high > band.mid);
});

test("newCandidateEligibility refuses unverified prices for NEW candidate traffic", () => {
  assert.equal(newCandidateEligibility("claude-haiku-4-5"), "unverified_price");
  assert.equal(newCandidateEligibility("claude-sonnet-5-medium"), "unverified_price");
  assert.equal(newCandidateEligibility("gpt-5.6-luna"), "unknown_model");
});

test("every entry in MODEL_PRICING carries a non-empty provenance note", () => {
  for (const [modelId, entry] of Object.entries(MODEL_PRICING)) {
    assert.ok(entry.note && entry.note.length > 10, `missing provenance note for ${modelId}`);
    assert.equal(entry.modelId, modelId);
  }
});
