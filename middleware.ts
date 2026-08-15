import { NextRequest, NextResponse } from "next/server";

import {
  API_RATE_LIMIT,
  AUTH_RATE_LIMIT,
  bodySizeVerdict,
  checkRateLimit,
  clientKey,
  crossOriginExemptPath,
  crossOriginMutation,
  type RateLimitPolicy,
} from "@/lib/requestSecurity";
import { sharedRateLimit } from "@/lib/sharedRateLimit";

function securityHeaders(response: NextResponse) {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), geolocation=(), microphone=()");
  return response;
}

type LimitResult = { limit: number; remaining: number; resetAt: number; retryAfterSeconds: number };

function rateLimitResponse(result: LimitResult) {
  return securityHeaders(NextResponse.json(
    { ok: false, error: "Too many requests. Try again later." },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(result.retryAfterSeconds),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
      },
    },
  ));
}

// Shared store first — the only limit that holds across serverless instances.
// The per-instance map is a fallback for when the store is unconfigured or down.
async function enforceLimit(key: string, policy: RateLimitPolicy) {
  const shared = await sharedRateLimit(key, policy);
  if (shared) return shared;
  return checkRateLimit(key, policy);
}

export async function middleware(request: NextRequest) {
  const method = request.method.toUpperCase();
  const pathname = request.nextUrl.pathname;
  const isMutation = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
  const isApi = pathname.startsWith("/api/");
  const isAuthAttempt = isMutation && (
    pathname.startsWith("/api/auth/") ||
    pathname === "/login" ||
    pathname === "/reset-password"
  );
  const client = clientKey(request.headers);

  if (isApi) {
    const apiLimit = await enforceLimit(`api:${client}:${pathname}`, API_RATE_LIMIT);
    if (!apiLimit.allowed) return rateLimitResponse(apiLimit);
  }

  if (isAuthAttempt) {
    const authLimit = await enforceLimit(`auth:${client}`, AUTH_RATE_LIMIT);
    if (!authLimit.allowed) return rateLimitResponse(authLimit);
  }

  if (isMutation && !crossOriginExemptPath(pathname) && crossOriginMutation(request.headers, request.url)) {
    return securityHeaders(NextResponse.json(
      { ok: false, error: "Cross-origin request rejected." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    ));
  }

  if (isMutation) {
    const verdict = bodySizeVerdict(request.headers, pathname);
    if (verdict === "length-required") {
      return securityHeaders(NextResponse.json(
        { ok: false, error: "A valid Content-Length is required; chunked bodies are not accepted." },
        { status: 411, headers: { "Cache-Control": "no-store" } },
      ));
    }
    if (verdict === "too-large") {
      return securityHeaders(NextResponse.json(
        { ok: false, error: "Request payload is too large." },
        { status: 413, headers: { "Cache-Control": "no-store" } },
      ));
    }
  }

  const isLoadTest = Boolean(request.headers.get("x-iris-load-test") || request.headers.get("x-load-test"));
  if (isMutation && isLoadTest) {
    return securityHeaders(NextResponse.json(
      { ok: false, error: "Load-test requests cannot call mutating/provider endpoints." },
      { status: 423 },
    ));
  }

  const response = securityHeaders(NextResponse.next());
  response.headers.set("Cache-Control", isAuthAttempt ? "no-store" : response.headers.get("Cache-Control") || "private");
  return response;
}

export const config = {
  matcher: ["/api/:path*", "/login", "/reset-password"],
};
