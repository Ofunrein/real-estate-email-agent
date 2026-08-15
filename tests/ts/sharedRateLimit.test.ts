import { test } from "node:test";
import assert from "node:assert/strict";

import { sharedRateLimit, sharedRateLimitConfigured } from "@/lib/sharedRateLimit";

const POLICY = { limit: 2, windowMs: 60_000 };

function withUpstash(counts: Map<string, number>, fetchImpl?: typeof fetch) {
  const previousUrl = process.env.UPSTASH_REDIS_REST_URL;
  const previousToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const previousFetch = globalThis.fetch;

  process.env.UPSTASH_REDIS_REST_URL = "https://upstash.test";
  process.env.UPSTASH_REDIS_REST_TOKEN = "token";
  globalThis.fetch = fetchImpl ?? (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const commands = JSON.parse(String(init?.body || "[]")) as string[][];
    const key = commands[0][1];
    const next = (counts.get(key) || 0) + 1;
    counts.set(key, next);
    return new Response(JSON.stringify([{ result: next }, { result: 1 }]), { status: 200 });
  }) as typeof fetch;

  return () => {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = previousUrl;
    if (previousToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = previousToken;
  };
}

test("without a shared store the limiter reports unconfigured and returns null", async () => {
  const previousUrl = process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_URL;
  try {
    assert.equal(sharedRateLimitConfigured(), false);
    assert.equal(await sharedRateLimit("api:1.2.3.4:/api/leads", POLICY), null);
  } finally {
    if (previousUrl !== undefined) process.env.UPSTASH_REDIS_REST_URL = previousUrl;
  }
});

test("the shared counter blocks once the policy limit is exceeded", async () => {
  const restore = withUpstash(new Map());
  try {
    const first = await sharedRateLimit("api:1.2.3.4:/api/leads", POLICY, 0);
    const second = await sharedRateLimit("api:1.2.3.4:/api/leads", POLICY, 0);
    const third = await sharedRateLimit("api:1.2.3.4:/api/leads", POLICY, 0);

    assert.equal(first?.allowed, true);
    assert.equal(second?.allowed, true);
    assert.equal(third?.allowed, false);
    assert.equal(third?.retryAfterSeconds, 60);
  } finally {
    restore();
  }
});

test("counters are shared across callers but isolated per key and window", async () => {
  const counts = new Map<string, number>();
  const restore = withUpstash(counts);
  try {
    await sharedRateLimit("api:a", POLICY, 0);
    await sharedRateLimit("api:a", POLICY, 0);
    assert.equal((await sharedRateLimit("api:a", POLICY, 0))?.allowed, false);
    assert.equal((await sharedRateLimit("api:b", POLICY, 0))?.allowed, true);
    // Next window is a different key, so the caller is allowed again.
    assert.equal((await sharedRateLimit("api:a", POLICY, POLICY.windowMs))?.allowed, true);
  } finally {
    restore();
  }
});

test("a store outage degrades to null instead of failing the request", async () => {
  const restore = withUpstash(new Map(), (async () => new Response("boom", { status: 500 })) as typeof fetch);
  try {
    assert.equal(await sharedRateLimit("api:a", POLICY, 0), null);
  } finally {
    restore();
  }
});
