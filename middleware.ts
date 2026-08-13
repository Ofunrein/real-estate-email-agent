import { NextRequest, NextResponse } from "next/server";

import {
  API_RATE_LIMIT,
  AUTH_RATE_LIMIT,
  checkRateLimit,
  clientKey,
  payloadLimitForPath,
} from "@/lib/requestSecurity";

function securityHeaders(response: NextResponse) {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), geolocation=(), microphone=()");
  return response;
}

function rateLimitResponse(result: ReturnType<typeof checkRateLimit>) {
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

export function middleware(request: NextRequest) {
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
    const apiLimit = checkRateLimit(`api:${client}:${pathname}`, API_RATE_LIMIT);
    if (!apiLimit.allowed) return rateLimitResponse(apiLimit);
  }

  if (isAuthAttempt) {
    const authLimit = checkRateLimit(`auth:${client}`, AUTH_RATE_LIMIT);
    if (!authLimit.allowed) return rateLimitResponse(authLimit);
  }

  if (isMutation) {
    const declaredSize = Number(request.headers.get("content-length") || 0);
    const maxBytes = payloadLimitForPath(pathname, request.headers.get("content-type"));
    if (!Number.isFinite(declaredSize) || declaredSize < 0 || declaredSize > maxBytes) {
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
