import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const method = request.method.toUpperCase();
  const isMutation = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
  const isLoadTest = Boolean(request.headers.get("x-iris-load-test") || request.headers.get("x-load-test"));
  if (isMutation && isLoadTest) {
    return NextResponse.json(
      { ok: false, error: "Load-test requests cannot call mutating/provider endpoints." },
      { status: 423 },
    );
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
