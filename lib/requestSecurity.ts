export type RateLimitPolicy = {
  limit: number;
  windowMs: number;
};

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

export const API_RATE_LIMIT: RateLimitPolicy = { limit: 120, windowMs: 60_000 };
export const AUTH_RATE_LIMIT: RateLimitPolicy = { limit: 5, windowMs: 15 * 60_000 };

function pruneExpired(now: number) {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  if (buckets.size < MAX_BUCKETS) return;
  const oldest = buckets.keys().next().value as string | undefined;
  if (oldest) buckets.delete(oldest);
}

export function checkRateLimit(key: string, policy: RateLimitPolicy, now = Date.now()) {
  pruneExpired(now);
  const current = buckets.get(key);
  const bucket = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + policy.windowMs }
    : current;

  if (bucket.count >= policy.limit) {
    return {
      allowed: false,
      limit: policy.limit,
      remaining: 0,
      resetAt: bucket.resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  bucket.count += 1;
  buckets.set(key, bucket);
  return {
    allowed: true,
    limit: policy.limit,
    remaining: Math.max(0, policy.limit - bucket.count),
    resetAt: bucket.resetAt,
    retryAfterSeconds: 0,
  };
}

export function clientKey(headers: Headers): string {
  const raw = headers.get("x-vercel-forwarded-for") || headers.get("x-forwarded-for") || headers.get("x-real-ip") || "";
  const candidate = raw.split(",", 1)[0]?.trim() || "unknown";
  return /^[0-9a-f:.]{3,45}$/i.test(candidate) ? candidate : "unknown";
}

export function payloadLimitForPath(pathname: string, contentType: string | null): number {
  const isMediaUpload = contentType?.toLowerCase().includes("multipart/form-data") && (
    pathname === "/api/media/transcribe" ||
    pathname === "/api/media/voice-note" ||
    pathname === "/api/media/voice-clone" ||
    /\/api\/threads\/[^/]+\/upload$/.test(pathname)
  );
  return isMediaUpload ? 15_000_000 : 1_000_000;
}

export function resetRateLimitsForTests() {
  buckets.clear();
}
