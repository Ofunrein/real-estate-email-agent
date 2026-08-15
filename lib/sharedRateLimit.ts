import type { RateLimitPolicy } from "@/lib/requestSecurity";

/**
 * Shared (cross-instance) rate limiting.
 *
 * The in-memory limiter in lib/requestSecurity.ts only sees one serverless
 * instance, so it cannot bound a distributed attack. This module talks to an
 * Upstash Redis REST endpoint (fetch-only, so it works in the Edge middleware
 * runtime) and is the enforcement layer that counts in production.
 *
 * Configure UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN. When they are
 * absent, `sharedRateLimit` returns null and the caller falls back to the
 * per-instance brake — which is NOT production-safe.
 */

export type SharedRateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

export function sharedRateLimitConfigured(): boolean {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

function windowKey(key: string, policy: RateLimitPolicy, now: number): string {
  return `rl:${Math.floor(now / policy.windowMs)}:${key}`;
}

/**
 * Fixed-window counter: INCR then EXPIRE on first hit. Returns null when the
 * store is unconfigured or unreachable so the caller can degrade instead of
 * failing every request on a Redis outage.
 */
export async function sharedRateLimit(
  key: string,
  policy: RateLimitPolicy,
  now = Date.now(),
): Promise<SharedRateLimitResult | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  const redisKey = windowKey(key, policy, now);
  const resetAt = (Math.floor(now / policy.windowMs) + 1) * policy.windowMs;
  const expireSeconds = Math.max(1, Math.ceil((resetAt - now) / 1000));

  let count: number;
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        ["INCR", redisKey],
        ["EXPIRE", redisKey, String(expireSeconds), "NX"],
      ]),
      cache: "no-store",
      signal: AbortSignal.timeout(1_500),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as Array<{ result?: unknown; error?: string }>;
    const incr = payload?.[0];
    if (!incr || incr.error || typeof incr.result !== "number") return null;
    count = incr.result;
  } catch {
    return null;
  }

  const allowed = count <= policy.limit;
  return {
    allowed,
    limit: policy.limit,
    remaining: Math.max(0, policy.limit - count),
    resetAt,
    retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((resetAt - now) / 1000)),
  };
}
