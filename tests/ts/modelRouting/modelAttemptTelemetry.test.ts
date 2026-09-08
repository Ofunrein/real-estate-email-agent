import { test } from "node:test";
import assert from "node:assert/strict";
import {
  probeTelemetryTable,
  redactForTelemetry,
  recordModelAttempt,
  type ModelAttemptRecord,
} from "@/lib/modelAttemptTelemetry";

test("redactForTelemetry never returns the raw prompt text", () => {
  const promptText = "lead's real name and phone: 555-0100, address 123 Main St";
  const { promptHash, promptLength } = redactForTelemetry(promptText);
  assert.equal(typeof promptHash, "string");
  assert.ok(promptHash.length > 0);
  assert.ok(!promptHash.includes("555-0100"));
  assert.ok(!promptHash.includes("Main St"));
  assert.equal(promptLength, promptText.length);
});

test("redactForTelemetry is deterministic (same input -> same hash)", () => {
  const a = redactForTelemetry("same text");
  const b = redactForTelemetry("same text");
  assert.equal(a.promptHash, b.promptHash);
});

test("redactForTelemetry produces different hashes for different inputs", () => {
  const a = redactForTelemetry("text one");
  const b = redactForTelemetry("text two");
  assert.notEqual(a.promptHash, b.promptHash);
});

test("telemetry table probe retries after a transient query failure", async () => {
  let calls = 0;
  const query = async () => {
    calls += 1;
    if (calls === 1) throw new Error("temporary connection failure");
    return { rows: [{ column_name: "attempt_id" }] };
  };

  assert.equal(await probeTelemetryTable(query), false);
  assert.equal(await probeTelemetryTable(query), true);
  assert.equal(calls, 2);
});

function baseRecord(overrides: Partial<ModelAttemptRecord> = {}): ModelAttemptRecord {
  return {
    attemptId: "attempt-1",
    correlationId: "thread-1",
    clientId: "test-client",
    channel: "email",
    agent: "iris",
    taskClass: "email-classification",
    routingTier: "routine_low",
    modelId: "claude-haiku-4-5",
    reasoningEffort: "low",
    attemptIndex: 0,
    isFallback: false,
    inputTokens: 100,
    outputTokens: 50,
    outcome: "ok",
    costUsd: 0.001,
    promptText: "real message body that must never be persisted",
    routingReason: "candidate_profile_email-classification",
    humanReviewFlag: false,
    promptVersion: "v1",
    ...overrides,
  };
}

test("recordModelAttempt no-ops (returns false, never throws) when DATABASE_URL is unset", async () => {
  const original = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const wrote = await recordModelAttempt(baseRecord());
    assert.equal(wrote, false);
  } finally {
    if (original !== undefined) process.env.DATABASE_URL = original;
  }
});

test("recordModelAttempt no-ops (never throws) when DATABASE_URL is set but unreachable", async () => {
  const original = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgres://invalid-host-for-test:5432/nope";
  try {
    const wrote = await recordModelAttempt(baseRecord());
    assert.equal(wrote, false);
  } finally {
    if (original !== undefined) process.env.DATABASE_URL = original;
    else delete process.env.DATABASE_URL;
  }
});
