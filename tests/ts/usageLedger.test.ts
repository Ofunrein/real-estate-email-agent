import { test } from "node:test";
import assert from "node:assert/strict";

import { recordUsageAttempt } from "@/lib/usageLedger";

test("malformed attempts are dropped, never thrown into the agent path", async () => {
  await assert.doesNotReject(async () => {
    const written = await recordUsageAttempt({
      clientId: "acme",
      correlationId: "",
      attemptId: "",
      operation: "",
      status: "",
    });
    assert.equal(written, false);
  });
});

test("ledger write is a no-op without a database instead of failing the caller", async () => {
  const previous = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const written = await recordUsageAttempt({
      clientId: "acme",
      correlationId: "corr-1",
      attemptId: "attempt-1",
      operation: "generate",
      status: "succeeded",
    });
    assert.equal(written, false);
  } finally {
    if (previous != null) process.env.DATABASE_URL = previous;
  }
});
