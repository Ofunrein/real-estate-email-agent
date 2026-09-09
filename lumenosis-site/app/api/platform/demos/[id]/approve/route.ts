import { NextResponse } from "next/server";
import { approveDemoRoom } from "@/lib/demo-admin-service";
import { platformApiConfigured, verifyPlatformRequest } from "@/lib/platform-auth";
import { sql, tursoConfigured } from "@/lib/turso";

/**
 * Signed server-to-server approve. Idempotent: a replayed approve of an
 * already-approved room returns 200, never a duplicate state change.
 */

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!platformApiConfigured())
    return NextResponse.json(
      { error: "Platform API is not configured" },
      { status: 503, headers: NO_STORE },
    );

  const url = new URL(request.url);
  const body = await request.text();
  const auth = verifyPlatformRequest({
    method: "POST",
    path: url.pathname,
    body,
    headers: request.headers,
    allowedMethods: ["POST"],
  });
  if (!auth.ok)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });

  if (body.length > 2048)
    return NextResponse.json({ error: "Invalid request" }, { status: 400, headers: NO_STORE });

  const { id } = await context.params;
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id))
    return NextResponse.json({ error: "Invalid request" }, { status: 400, headers: NO_STORE });

  if (!tursoConfigured())
    return NextResponse.json(
      { error: "Demo store is not configured" },
      { status: 503, headers: NO_STORE },
    );

  try {
    const result = await approveDemoRoom(id, sql);
    if (!result.ok)
      return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
    return NextResponse.json({ ok: true, approved: true }, { headers: NO_STORE });
  } catch {
    return NextResponse.json(
      { error: "Demo store unavailable" },
      { status: 502, headers: NO_STORE },
    );
  }
}
