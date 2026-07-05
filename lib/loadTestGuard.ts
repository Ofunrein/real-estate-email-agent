import { NextRequest, NextResponse } from "next/server";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isLoadTestRequest(request: Pick<NextRequest, "headers" | "method">): boolean {
  return Boolean(request.headers.get("x-iris-load-test") || request.headers.get("x-load-test"));
}

export function blockLoadTestMutation(request: Pick<NextRequest, "headers" | "method">): NextResponse | null {
  if (!MUTATING_METHODS.has(String(request.method || "").toUpperCase())) return null;
  if (!isLoadTestRequest(request)) return null;
  return NextResponse.json(
    { ok: false, error: "Load-test requests are blocked from mutating/provider routes." },
    { status: 423 },
  );
}

export function providerDryRunEnabled(): boolean {
  return ["1", "true", "yes", "on"].includes(String(process.env.IRIS_PROVIDER_DRY_RUN || "").toLowerCase());
}
