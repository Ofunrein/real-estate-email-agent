import { test } from "node:test";
import assert from "node:assert/strict";

import { redactAuditMetadata } from "@/lib/requestAudit";

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
