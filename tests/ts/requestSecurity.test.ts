import { test } from "node:test";
import assert from "node:assert/strict";

import {
  checkRateLimit,
  clientKey,
  payloadLimitForPath,
  resetRateLimitsForTests,
} from "@/lib/requestSecurity";

test("auth routes allow at most five attempts per fifteen minutes", () => {
  resetRateLimitsForTests();
  const now = 1_000_000;

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    assert.equal(checkRateLimit("auth:203.0.113.10", { limit: 5, windowMs: 15 * 60_000 }, now).allowed, true);
  }

  const blocked = checkRateLimit("auth:203.0.113.10", { limit: 5, windowMs: 15 * 60_000 }, now);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 900);
});

test("rate limits are isolated by client and reset after their window", () => {
  resetRateLimitsForTests();
  const policy = { limit: 1, windowMs: 60_000 };

  assert.equal(checkRateLimit("api:a", policy, 0).allowed, true);
  assert.equal(checkRateLimit("api:a", policy, 1).allowed, false);
  assert.equal(checkRateLimit("api:b", policy, 1).allowed, true);
  assert.equal(checkRateLimit("api:a", policy, 60_001).allowed, true);
});

test("client key uses the first forwarded address and never trusts arbitrary text", () => {
  assert.equal(clientKey(new Headers({ "x-forwarded-for": "203.0.113.4, 10.0.0.1" })), "203.0.113.4");
  assert.equal(clientKey(new Headers({ "x-forwarded-for": "bad value !" })), "unknown");
});

test("payload limits stay small by default and permit bounded media uploads", () => {
  assert.equal(payloadLimitForPath("/api/contacts", "application/json"), 1_000_000);
  assert.equal(payloadLimitForPath("/api/media/transcribe", "multipart/form-data"), 15_000_000);
  assert.equal(payloadLimitForPath("/api/threads/ref/upload", "multipart/form-data"), 15_000_000);
});
