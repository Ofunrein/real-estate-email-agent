import { test } from "node:test";
import assert from "node:assert/strict";

import { redactAuditMetadata, summarizeRequestAuditCosts, type RequestAuditRecord } from "@/lib/requestAudit";

test("redactAuditMetadata: strips secrets and signed URL query strings", () => {
  const redacted = redactAuditMetadata({
    Authorization: "Bearer abc",
    access_token: "token",
    mediaUrl: "https://cdn.example.com/audio.m4a?X-Amz-Signature=secret#frag",
    nested: {
      cookie: "session=abc",
      preview: "Interested in the first property",
    },
  }) as Record<string, unknown>;

  assert.equal(redacted.Authorization, "[redacted]");
  assert.equal(redacted.access_token, "[redacted]");
  assert.equal(redacted.mediaUrl, "https://cdn.example.com/audio.m4a");
  assert.deepEqual(redacted.nested, {
    cookie: "[redacted]",
    preview: "Interested in the first property",
  });
});

test("redactAuditMetadata: truncates long strings and arrays", () => {
  const redacted = redactAuditMetadata({
    messagePreview: "x".repeat(350),
    values: Array.from({ length: 25 }, (_, index) => index),
  }) as Record<string, unknown>;

  assert.equal(String(redacted.messagePreview).length, 303);
  assert.equal((redacted.values as unknown[]).length, 20);
});

function auditRow(overrides: Partial<RequestAuditRecord>): RequestAuditRecord {
  return {
    id: "id",
    requestId: "req",
    route: "/api/test",
    method: "POST",
    channel: "email",
    provider: "anthropic",
    threadRef: "thread",
    contactRef: "contact",
    providerMessageId: "msg",
    stage: "reply_generate",
    outcome: "sent",
    statusCode: 200,
    durationMs: 10,
    errorCode: "",
    errorMessage: "",
    costUsd: 0,
    costService: "",
    costUnits: {},
    metadata: {},
    createdAt: new Date(0).toISOString(),
    ...overrides,
  };
}

test("summarizeRequestAuditCosts: totals billed rows by service", () => {
  const summary = summarizeRequestAuditCosts([
    auditRow({ costUsd: 0.00000123, costService: "claude" }),
    auditRow({ costUsd: 0.00000456, costService: "claude" }),
    auditRow({ costUsd: 0.01, costService: "twilio" }),
    auditRow({ costUsd: 0, costService: "claude" }),
  ]);

  assert.equal(summary.rowsWithCost, 3);
  assert.equal(summary.totalCostUsd, 0.01000579);
  assert.deepEqual(summary.byService, {
    claude: 0.00000579,
    twilio: 0.01,
  });
});
