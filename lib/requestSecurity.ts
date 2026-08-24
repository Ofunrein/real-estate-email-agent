export type RateLimitPolicy = {
  limit: number;
  windowMs: number;
};

type Bucket = {
  count: number;
  resetAt: number;
};

// Per-instance fallback only. Serverless runs many instances, so this map is a
// best-effort brake, NOT a production rate limit. Shared enforcement lives in
// lib/sharedRateLimit.ts and must be configured for production.
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

// Cross-origin protection for cookie-authenticated mutations. Provider callbacks
// authenticate with their own shared secret / signature and are legitimately
// cross-origin, so they are exempt.
const CROSS_ORIGIN_EXEMPT_PREFIXES = [
  "/api/webhooks/",
  "/api/cron/",
  "/api/inngest",
  "/api/auth/",
];

export function crossOriginExemptPath(pathname: string): boolean {
  return CROSS_ORIGIN_EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function allowedOrigins(): Set<string> {
  const configured = [
    process.env.PUBLIC_BASE_URL,
    process.env.AUTH_URL,
    process.env.NEXTAUTH_URL,
    ...(process.env.ALLOWED_ORIGINS || "").split(","),
  ];
  const origins = new Set<string>();
  for (const value of configured) {
    const trimmed = (value || "").trim();
    if (!trimmed) continue;
    try {
      origins.add(new URL(trimmed).origin.toLowerCase());
    } catch {
      // ignore malformed configuration rather than failing every request
    }
  }
  return origins;
}

/**
 * True when a state-changing request looks like it came from another site.
 * Browsers always attach `Origin` (and modern ones `Sec-Fetch-Site`) to
 * cross-origin form posts and fetches, so this blocks classic CSRF without
 * breaking server-to-server callers that send neither header.
 *
 * The comparison uses the forwarded host headers rather than `request.url`,
 * because behind a proxy the internal URL host is not the host the browser
 * addressed.
 */
export function crossOriginMutation(headers: Headers, requestUrl: string): boolean {
  const fetchSite = (headers.get("sec-fetch-site") || "").toLowerCase();
  if (fetchSite === "same-origin" || fetchSite === "none") return false;
  if (fetchSite === "cross-site") return true;
  // "same-site" still allows a sibling subdomain, so it falls through to the
  // Origin comparison below.

  const origin = (headers.get("origin") || "").trim().toLowerCase();
  if (!origin || origin === "null") return false;

  let originHost = "";
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return true;
  }

  const forwardedHost = (headers.get("x-forwarded-host") || headers.get("host") || "").split(",")[0].trim().toLowerCase();
  if (forwardedHost && originHost === forwardedHost) return false;

  let selfHost = "";
  try {
    selfHost = new URL(requestUrl).host.toLowerCase();
  } catch {
    selfHost = "";
  }
  if (selfHost && originHost === selfHost) return false;

  return !allowedOrigins().has(origin);
}

/**
 * Inngest's out-of-band sync probe is an empty PUT. Vercel strips
 * `Content-Length: 0`, so the generic payload guard otherwise rejects every
 * automatic function sync with 411. Keep the exemption narrow: in-band syncs,
 * chunked requests, and any declared non-empty body still go through the normal
 * payload cap.
 */
export function emptyInngestOutOfBandSync(
  method: string,
  pathname: string,
  headers: Headers,
): boolean {
  if (method.toUpperCase() !== "PUT" || pathname !== "/api/inngest") return false;
  if (headers.get("transfer-encoding")) return false;
  if ((headers.get("x-inngest-sync-kind") || "").trim().toLowerCase() === "in-band") return false;

  const declared = headers.get("content-length")?.trim();
  return declared == null || declared === "" || declared === "0";
}

export type BodySizeVerdict = "ok" | "length-required" | "too-large";

/**
 * Enforces the declared payload cap. A missing Content-Length (or a chunked
 * body) means the cap cannot be enforced in middleware at all, so those
 * requests are rejected with 411 instead of being waved through as size 0.
 */
export function bodySizeVerdict(headers: Headers, pathname: string): BodySizeVerdict {
  if (headers.get("transfer-encoding")) return "length-required";

  const raw = headers.get("content-length");
  if (raw === null || raw.trim() === "") return "length-required";
  if (!/^\d+$/.test(raw.trim())) return "length-required";

  const declared = Number(raw.trim());
  if (!Number.isSafeInteger(declared)) return "length-required";

  return declared > payloadLimitForPath(pathname, headers.get("content-type")) ? "too-large" : "ok";
}

/** Constant-time string comparison usable in the Edge runtime (no node:crypto). */
export function secretsMatch(actual: string, expected: string): boolean {
  if (!expected) return false;
  const a = new TextEncoder().encode(actual);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return diff === 0;
}
