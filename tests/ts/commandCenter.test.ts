import { test } from "node:test";
import assert from "node:assert/strict";

import {
  aggregateCommandCenter,
  normalizeUsageAttempt,
  type CommandCenterClient,
  type UsageAttempt,
} from "@/lib/commandCenter";

const start = "2026-08-01T00:00:00.000Z";
const end = "2026-08-31T00:00:00.000Z";

const client: CommandCenterClient = {
  id: "acme",
  name: "Acme Realty",
  status: "active",
  planCode: "growth",
  planName: "Growth",
  billingCurrency: "USD",
  monthlyPriceCents: 10_000,
  monthlyAttemptQuota: 100,
  monthlyInputUnitQuota: null,
  monthlyOutputUnitQuota: null,
  monthlySpendQuotaUsd: 25,
  billingPeriodStartedAt: start,
  billingPeriodEndsAt: end,
  activatedAt: start,
};

function attempt(overrides: Partial<UsageAttempt>): UsageAttempt {
  return {
    id: "row-1",
    clientId: "acme",
    occurredAt: "2026-08-15T12:00:00.000Z",
    correlationId: "trace-1",
    attemptId: "attempt-1",
    requestId: "request-1",
    parentAttemptId: "",
    agent: "iris",
    channel: "email",
    operation: "generate",
    provider: "anthropic",
    model: "claude",
    status: "succeeded",
    retryNumber: 0,
    fallbackFromProvider: "",
    latencyMs: 100,
    inputUnits: 10,
    outputUnits: 5,
    cacheReadUnits: 0,
    cacheWriteUnits: 0,
    billableQuantity: 15,
    billableUnit: "tokens",
    costUsd: 2,
    metadata: {},
    ...overrides,
  };
}

test("command-center aggregation calculates actual totals, quotas, margins, breakdowns, and traces", () => {
  const result = aggregateCommandCenter({
    clients: [client],
    attempts: [
      attempt({ id: "row-1", attemptId: "attempt-1", latencyMs: 100, costUsd: 2 }),
      attempt({
        id: "row-2",
        attemptId: "attempt-2",
        status: "failed",
        retryNumber: 1,
        latencyMs: 200,
        costUsd: 3,
      }),
      attempt({
        id: "row-3",
        attemptId: "attempt-3",
        correlationId: "trace-2",
        provider: "openai",
        model: "gpt",
        fallbackFromProvider: "anthropic",
        latencyMs: 300,
        costUsd: 5,
      }),
    ],
    range: { start, end, window: "30d" },
  });

  assert.deepEqual(result.totals, {
    attempts: 3,
    successful: 2,
    failed: 1,
    retries: 1,
    fallbacks: 1,
    successRate: 66.67,
    costUsd: 10,
    allocatedRevenueUsd: 100,
    allocatedMarginUsd: 90,
    marginPct: 90,
    p50LatencyMs: 200,
    p95LatencyMs: 300,
  });
  assert.equal(result.tenants[0].quota.attempts.used, 3);
  assert.equal(result.tenants[0].quota.attempts.limit, 100);
  assert.equal(result.tenants[0].quota.attempts.percent, 3);
  assert.equal(result.breakdowns.provider.find((row) => row.key === "anthropic")?.attempts, 2);
  assert.equal(result.traces[0].correlationId, "trace-1");
  assert.equal(result.traces[0].attemptCount, 2);
  assert.equal(result.traces[0].hasRetry, true);
  assert.equal(result.traces[0].hasError, true);
});

test("command-center aggregation keeps unknown pricing and empty telemetry honest", () => {
  const result = aggregateCommandCenter({
    clients: [{ ...client, monthlyPriceCents: null, monthlyAttemptQuota: null, monthlySpendQuotaUsd: null }],
    attempts: [],
    range: { start, end, window: "30d" },
  });

  assert.equal(result.emptyReason, "No usage attempts recorded in this period.");
  assert.equal(result.totals.allocatedRevenueUsd, null);
  assert.equal(result.totals.allocatedMarginUsd, null);
  assert.equal(result.tenants[0].quota.attempts.limit, null);
  assert.equal(result.tenants[0].quota.attempts.percent, null);
});

test("usage attempt normalization strips unsafe metadata and rejects missing correlation", () => {
  const normalized = normalizeUsageAttempt({
    clientId: "acme",
    correlationId: "trace-1",
    attemptId: "attempt-1",
    operation: "generate",
    provider: "anthropic",
    model: "claude",
    status: "succeeded",
    costUsd: 0.001,
    metadata: {
      region: "us",
      finish_reason: "stop",
      prompt: "raw prompt",
      message_body: "lead content",
      authorization: "Bearer abc",
    },
  });

  assert.deepEqual(normalized.metadata, { region: "us", finish_reason: "stop" });
  assert.throws(
    () => normalizeUsageAttempt({
      clientId: "acme",
      correlationId: "",
      attemptId: "attempt-1",
      operation: "generate",
      status: "failed",
    }),
    /correlationId is required/,
  );
});
