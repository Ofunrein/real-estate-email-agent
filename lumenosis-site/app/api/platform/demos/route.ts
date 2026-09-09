import { NextResponse } from "next/server";
import { listDemoRows, toDemoSummary } from "@/lib/demo-admin-service";
import { platformApiConfigured, verifyPlatformRequest } from "@/lib/platform-auth";
import { sql, tursoConfigured } from "@/lib/turso";

/**
 * Signed server-to-server demo list for the platform-admin app.
 *
 * Platform-admin role enforcement lives in the primary app; this route
 * independently authenticates every request with its own HMAC verification and
 * grants nothing on the basis of the caller's claims.
 *
 * Additive: /api/admin/* and /admin/demos stay unchanged and operational.
 */

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
}

export async function GET(request: Request) {
  if (!platformApiConfigured())
    return NextResponse.json(
      { error: "Platform API is not configured" },
      { status: 503, headers: NO_STORE },
    );

  const url = new URL(request.url);
  const auth = verifyPlatformRequest({
    method: "GET",
    path: url.pathname,
    body: "",
    headers: request.headers,
    allowedMethods: ["GET"],
  });
  // Failure reasons are deliberately not returned or logged.
  if (!auth.ok) return unauthorized();

  if (!tursoConfigured())
    return NextResponse.json(
      { error: "Demo store is not configured" },
      { status: 503, headers: NO_STORE },
    );

  try {
    const rows = await listDemoRows(sql);
    return NextResponse.json({ demos: rows.map(toDemoSummary) }, { headers: NO_STORE });
  } catch {
    return NextResponse.json(
      { error: "Demo store unavailable" },
      { status: 502, headers: NO_STORE },
    );
  }
}
