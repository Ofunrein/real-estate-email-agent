import { test } from "node:test";
import assert from "node:assert/strict";

import {
  bodySizeVerdict,
  checkRateLimit,
  clientKey,
  crossOriginExemptPath,
  crossOriginMutation,
  payloadLimitForPath,
  resetRateLimitsForTests,
  secretsMatch,
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

test("cross-origin mutations are rejected and same-origin ones pass", () => {
  const url = "https://app.lumenosis.com/api/threads/abc/reply";

  assert.equal(crossOriginMutation(new Headers({ origin: "https://evil.example" }), url), true);
  assert.equal(crossOriginMutation(new Headers({ "sec-fetch-site": "cross-site" }), url), true);
  assert.equal(crossOriginMutation(new Headers({ origin: "https://app.lumenosis.com" }), url), false);
  assert.equal(crossOriginMutation(new Headers({ "sec-fetch-site": "same-origin" }), url), false);
  // Non-browser callers send neither header and must keep working.
  assert.equal(crossOriginMutation(new Headers(), url), false);
  // A sibling subdomain is "same-site" but is still a different origin.
  assert.equal(
    crossOriginMutation(new Headers({ "sec-fetch-site": "same-site", origin: "https://evil.lumenosis.com" }), url),
    true,
  );
});

test("the forwarded host decides same-origin, not the internal proxy URL", () => {
  // Behind a proxy, request.url carries the internal host while Origin carries
  // the public one; the request is still same-origin.
  const headers = new Headers({ origin: "https://app.lumenosis.com", "x-forwarded-host": "app.lumenosis.com" });
  assert.equal(crossOriginMutation(headers, "http://internal-1.vercel.internal/api/leads"), false);

  const spoofed = new Headers({ origin: "https://evil.example", "x-forwarded-host": "app.lumenosis.com" });
  assert.equal(crossOriginMutation(spoofed, "http://internal-1.vercel.internal/api/leads"), true);

  const malformed = new Headers({ origin: "not-a-url", host: "app.lumenosis.com" });
  assert.equal(crossOriginMutation(malformed, "https://app.lumenosis.com/api/leads"), true);
});

test("configured origins are allowed even when the host differs", () => {
  const previous = process.env.ALLOWED_ORIGINS;
  process.env.ALLOWED_ORIGINS = "https://dash.lumenosis.com";
  try {
    assert.equal(
      crossOriginMutation(new Headers({ origin: "https://dash.lumenosis.com" }), "https://app.lumenosis.com/api/leads"),
      false,
    );
  } finally {
    if (previous === undefined) delete process.env.ALLOWED_ORIGINS;
    else process.env.ALLOWED_ORIGINS = previous;
  }
});

test("provider callbacks are exempt from the cross-origin check", () => {
  assert.equal(crossOriginExemptPath("/api/webhooks/theo-sms"), true);
  assert.equal(crossOriginExemptPath("/api/cron/iris-email"), true);
  assert.equal(crossOriginExemptPath("/api/inngest"), true);
  assert.equal(crossOriginExemptPath("/api/auth/callback/google"), true);
  assert.equal(crossOriginExemptPath("/api/threads/abc/reply"), false);
});

test("a chunked or missing Content-Length cannot slip past the payload cap", () => {
  assert.equal(bodySizeVerdict(new Headers({ "content-length": "500" }), "/api/leads"), "ok");
  assert.equal(bodySizeVerdict(new Headers({ "content-length": "2000000" }), "/api/leads"), "too-large");
  // The old check read `Number(null || 0)` and let unbounded chunked bodies through.
  assert.equal(bodySizeVerdict(new Headers({ "transfer-encoding": "chunked" }), "/api/leads"), "length-required");
  assert.equal(bodySizeVerdict(new Headers(), "/api/leads"), "length-required");
  assert.equal(bodySizeVerdict(new Headers({ "content-length": "not-a-number" }), "/api/leads"), "length-required");
  assert.equal(bodySizeVerdict(new Headers({ "content-length": "-5" }), "/api/leads"), "length-required");
  assert.equal(
    bodySizeVerdict(new Headers({ "content-length": "9000000", "content-type": "multipart/form-data" }), "/api/media/transcribe"),
    "ok",
  );
});

test("secret comparison rejects mismatches and empty expectations", () => {
  assert.equal(secretsMatch("abc", "abc"), true);
  assert.equal(secretsMatch("abc", "abd"), false);
  assert.equal(secretsMatch("abc", "abcd"), false);
  assert.equal(secretsMatch("", ""), false);
});
